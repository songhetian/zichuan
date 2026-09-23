"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { guardPermission, hasPermission } from "@/lib/permissions";
import { createNotifications, dedupeNotifications, NotificationItem } from "@/lib/notification";
import { parseCcRules, CcRule } from "@/lib/cc-rules";
import { pushNotificationLive } from "@/lib/socket-pusher";
import {
  upgradePayloadSchema,
  executeScrapOnApproval,
  scrapPayloadSchema,
  returnPayloadSchema,
  executeReturnOnApproval,
  replacePayloadSchema,
  repairPayloadSchema,
  departPayloadSchema,
  executeDepartOnApproval,
} from "@/lib/approval-execute";

// ============================================================
// 审批引擎（M4）：提交 / 待办 / 详情 / 流转
// 规则：
//   - 申请单绑定「流程版本」，不是业务类型（在途单不受改配置影响）
//   - 逐节点流转：全部通过 → APPROVED；任一驳回 → REJECTED（终态）
//   - 提交时解析全部节点审批人，任一解析不到即拒绝提交
//   - ANY（或签）任一通过即推进；ALL（会签）全部通过才推进
// ============================================================

const submitSchema = z.object({
  title: z.string().min(1, "申请标题不能为空"),
  payload: z.record(z.unknown()),
  forEmployeeId: z.number().int().positive().optional(),
});

const actSchema = z.object({
  taskId: z.number().int().positive({
    message: "审批任务参数无效",
  }),
  comment: z.string().max(500, "备注内容过长").optional(),
});

const REQUEST_NO_PREFIX = "AP";

/** 终审通过后由系统自动执行业务动作的类型（退回/报废）；其余为资产管理员手动执行 */
const AUTO_EXECUTE_BUSINESS_TYPES = new Set(["ASSET_SCRAP", "ASSET_RETURN"]);

/** 终审通过后进入「交接单对账」流程的业务类型：生成待对账单，对账无误后再回收设备 */
const HANDOVER_BUSINESS_TYPES = new Set(["ASSET_DEPART"]);

/** 生成下一单号：AP-YYYYMM-NNNN（参考 employee-no.ts，取同月最大序号 +1） */
async function nextRequestNo(): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `${REQUEST_NO_PREFIX}-${ym}-`;
  const last = await prisma.approvalRequest.findFirst({
    where: { requestNo: { startsWith: prefix } },
    orderBy: { requestNo: "desc" },
    select: { requestNo: true },
  });
  const seq = last ? Number(last.requestNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

interface NodeRef {
  nodeKey: string;
  assigneeType: string;
  assigneeRole: string | null;
  assigneeUserId: number | null;
}

/** 组织导航所需的最小发起人结构（审批人/抄送解析共用） */
interface OrgNavInitiator {
  id?: number;
  employee?: {
    department?: { manager?: { account?: { id: number } | null } | null } | null;
    manager?: { account?: { id: number } | null } | null;
  } | null;
}

/** 按组织类型解析账号 id（部门主管 / 直属主管），解析不到返回 null */
function resolveOrgAccountId(
  type: "DEPT_MANAGER" | "EMP_MANAGER",
  initiator: OrgNavInitiator | null | undefined
): number | null {
  if (type === "DEPT_MANAGER") {
    return initiator?.employee?.department?.manager?.account?.id ?? null;
  }
  return initiator?.employee?.manager?.account?.id ?? null;
}

/**
 * 解析某节点的全部审批人（提交/流转共用）：
 *   - DEPT_MANAGER：申请人所在部门主管（员工档案 → 部门.manager → 账号）
 *   - EMP_MANAGER：申请人直属主管（员工.manager → 账号）
 *   - ROLE：按角色 key 找启用中的全部账号
 *   - USER：指定账号
 *   - INITIATOR：发起人本人
 */
async function resolveNodeAssignees(
  node: NodeRef,
  initiator: {
    employee: {
      department: { manager: { account: { id: number } | null } | null } | null;
      manager: { account: { id: number } | null } | null;
    } | null;
    id: number;
  } | null
): Promise<number[]> {
  switch (node.assigneeType) {
    case "DEPT_MANAGER":
    case "EMP_MANAGER": {
      const id = resolveOrgAccountId(node.assigneeType, initiator);
      return id ? [id] : [];
    }
    case "ROLE": {
      if (!node.assigneeRole) return [];
      const admins = await prisma.admin.findMany({
        where: { role: { key: node.assigneeRole }, isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      return admins.map((a) => a.id);
    }
    case "USER":
      return node.assigneeUserId ? [node.assigneeUserId] : [];
    case "INITIATOR":
      return initiator?.id ? [initiator.id] : [];
    default:
      return [];
  }
}

/** 当前用户的员工档案（含部门主管/直属主管账号），审批人解析依赖 */
async function getInitiatorWithOrg(adminId: number) {
  return prisma.admin.findUnique({
    where: { id: adminId },
    include: {
      employee: {
        include: {
          department: { include: { manager: { include: { account: true } } } },
          manager: { include: { account: true } },
        },
      },
    },
  });
}

type InitiatorWithOrg = Awaited<ReturnType<typeof getInitiatorWithOrg>>;

/** 主管代申：按被代申员工组织解析审批链（首节点=该员工部门主管），返回与 getInitiatorWithOrg 兼容的结构 */
async function getEmployeeAsInitiator(employeeId: number) {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      account: { select: { id: true } },
      department: { include: { manager: { include: { account: true } } } },
      manager: { include: { account: true } },
    },
  });
  return { id: emp?.account?.id ?? null, employee: emp };
}

/** 主管代申数据范围：被代申员工须在本人主管部门内（或具备账号管理权不受限） */
async function canManageForEmployee(
  user: { id: number },
  employee: { departmentId: number | null }
): Promise<boolean> {
  if (await hasPermission(user, "system.account.manage")) return true;
  if (!(await hasPermission(user, "dept.data.view"))) return false;
  const admin = await prisma.admin.findUnique({
    where: { id: user.id },
    include: { employee: { select: { managedDepartments: { select: { id: true } } } } },
  });
  const managed = admin?.employee?.managedDepartments?.map((d) => d.id) ?? [];
  return employee.departmentId != null && managed.includes(employee.departmentId);
}

/**
 * M6：解析某节点的抄送账号（只读知会，不参与审批）。
 * 两套逻辑：
 *   - ccRules 为有效数组（M8，spec §5.1）：按规则并集去重解析
 *   - 否则回退旧 ccType + ccUserIds（历史数据）
 */
async function resolveNodeCc(
  node: { ccType: string; ccUserIds: Prisma.JsonValue; ccRules?: Prisma.JsonValue },
  initiator: InitiatorWithOrg
): Promise<number[]> {
  const rules = parseCcRules(node.ccRules);
  if (rules !== null) return resolveCcRules(rules, initiator);

  switch (node.ccType) {
    case "NONE":
      return [];
    case "INITIATOR":
      return initiator?.id ? [initiator.id] : [];
    case "DEPT_MANAGER":
    case "EMP_MANAGER": {
      const id = resolveOrgAccountId(node.ccType, initiator);
      return id ? [id] : [];
    }
    case "SPECIFIC": {
      let ids: unknown = node.ccUserIds;
      if (typeof ids === "string") {
        try {
          ids = JSON.parse(ids);
        } catch {
          return [];
        }
      }
      return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === "number") : [];
    }
    default:
      return [];
  }
}

/** M8：按抄送规则集解析账号（并集，调用方 dedupeNotifications 再按接收人去重） */
async function resolveCcRules(
  rules: CcRule[],
  initiator: InitiatorWithOrg
): Promise<number[]> {
  const out = new Set<number>();
  for (const rule of rules) {
    switch (rule.type) {
      case "INITIATOR":
        if (initiator?.id) out.add(initiator.id);
        break;
      case "DEPT_MANAGER":
      case "EMP_MANAGER": {
        const id = resolveOrgAccountId(rule.type, initiator);
        if (id) out.add(id);
        break;
      }
      case "ROLE": {
        const admins = await prisma.admin.findMany({
          where: { role: { key: rule.roleKey }, isActive: true },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        for (const a of admins) out.add(a.id);
        break;
      }
      case "USER":
        for (const id of rule.userIds) out.add(id);
        break;
    }
  }
  return Array.from(out);
}

// ---- M6 通知文案（节点进入：审批人待办 + 抄送；节点完成：发起人结果）----

/** 节点进入通知：审批人待办 */
function todoNotifications(
  assignees: number[],
  requestId: number,
  requestNo: string,
  title: string
): NotificationItem[] {
  return assignees.map((adminId) => ({
    adminId,
    requestId,
    type: "APPROVAL_TODO",
    title: "新的审批待办",
    content: `【${requestNo}】${title}`,
  }));
}

/** 节点进入通知：抄送知会 */
function ccNotifications(
  ccIds: number[],
  requestId: number,
  requestNo: string,
  title: string
): NotificationItem[] {
  return ccIds.map((adminId) => ({
    adminId,
    requestId,
    type: "APPROVAL_CC",
    title: "审批抄送",
    content: `【${requestNo}】${title}（知会）`,
  }));
}

/** 节点完成通知：发起人收到最终结果 */
function resultNotification(
  adminId: number,
  requestId: number,
  requestNo: string,
  title: string,
  passed: boolean
): NotificationItem {
  return {
    adminId,
    requestId,
    type: "APPROVAL_RESULT",
    title: passed ? "审批通过" : "审批驳回",
    content: passed ? `【${requestNo}】${title} 已全部通过` : `【${requestNo}】${title} 已被驳回`,
  };
}

/** 事务提交后逐条实时推送（无在线连接时静默跳过） */
function pushItems(items: NotificationItem[], requestId: number): void {
  for (const n of items) {
    pushNotificationLive(n.adminId, {
      requestId,
      title: n.title,
      content: n.content ?? null,
      createdAt: new Date().toISOString(),
    });
  }
}

// ============================================================
// 提交申请
// ============================================================

export async function submitApprovalRequest(input: {
  title: string;
  businessType?: "ASSET_UPGRADE" | "ASSET_SCRAP" | "ASSET_RETURN" | "ASSET_REPLACE" | "ASSET_REPAIR" | "ASSET_DEPART";
  payload: Record<string, unknown>;
  forEmployeeId?: number; // 主管代申：被代申员工的 id（缺省=本人发起）
}): Promise<
  ActionResult<{ id: number; requestNo: string; status: string; currentNodeKey: string }>
> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "approval.submit", "没有提交审批的权限");
  if (denied) return denied;

  const validated = submitSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }
  const businessType = input.businessType ?? "ASSET_UPGRADE";

  // M5：按业务类型做申请内容结构校验
  const payloadParsed =
    businessType === "ASSET_SCRAP"
      ? scrapPayloadSchema.safeParse(validated.data.payload)
      : businessType === "ASSET_RETURN"
        ? returnPayloadSchema.safeParse(validated.data.payload)
        : businessType === "ASSET_REPLACE"
          ? replacePayloadSchema.safeParse(validated.data.payload)
          : businessType === "ASSET_REPAIR"
          ? repairPayloadSchema.safeParse(validated.data.payload)
          : businessType === "ASSET_DEPART"
            ? departPayloadSchema.safeParse(validated.data.payload)
            : upgradePayloadSchema.safeParse(validated.data.payload);
  if (!payloadParsed.success) {
    return { success: false, error: payloadParsed.error.errors[0]?.message ?? "申请内容格式错误" };
  }
  // payload 存入 Json 列前做纯 JSON 化（丢弃 undefined 等非 JSON 值）
  const payloadJson = JSON.parse(JSON.stringify(validated.data.payload)) as Prisma.InputJsonValue;

  // 1. 取该业务类型的生效版本（同类型同时只有一个 PUBLISHED，取最新发布）
  const def = await prisma.workflowDefinition.findFirst({
    where: { businessType, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    include: { nodes: { orderBy: { sortOrder: "asc" } } },
  });
  if (!def) return { success: false, error: "暂无生效的审批流程，请联系管理员发布" };
  if (def.nodes.length === 0) return { success: false, error: "审批流程未配置审批节点" };

  // 2. 解析全部节点审批人：任一解析不到即拒绝提交
  //    forEmployeeId → 主管代申，按被代申员工的部门主管解析首节点
  const forEmployeeId = validated.data.forEmployeeId;
  const initiator: InitiatorWithOrg = forEmployeeId
    ? ((await getEmployeeAsInitiator(forEmployeeId)) as unknown as InitiatorWithOrg)
    : await getInitiatorWithOrg(user.id);
  const resolutions: { nodeKey: string; assignees: number[] }[] = [];
  for (let i = 0; i < def.nodes.length; i++) {
    const node = def.nodes[i];
    const assignees = await resolveNodeAssignees(node, initiator);
    if (assignees.length === 0) {
      return {
        success: false,
        error: `第 ${i + 1} 节点（${node.name}）无法解析审批人`,
      };
    }
    resolutions.push({ nodeKey: node.nodeKey, assignees });
  }

  // 3. 业务校验（M5）：资产存在、未被预占、归属校验；升级另校验旧配件存在
  const isDepart = businessType === "ASSET_DEPART";
  let asset: Awaited<ReturnType<typeof prisma.asset.findUnique>> | null = null;
  if (isDepart) {
    // 离职：校验离职员工存在（回收其名下全部设备，不做单台预占）
    const targetEmployeeId = (payloadParsed.data as { targetEmployeeId: number }).targetEmployeeId;
    const targetEmp = await prisma.employee.findUnique({ where: { id: targetEmployeeId } });
    if (!targetEmp) return { success: false, error: "离职员工不存在" };
  } else {
    const assetId = (payloadParsed.data as { assetId: number }).assetId;
    asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return { success: false, error: "设备不存在" };
    if (asset.status === "RESERVED") {
      return { success: false, error: "该设备已被其他申请预占" };
    }
    // 归属校验（权限矩阵 §6：普通员工仅能对本人名下设备发起；资产管理员可代发起；主管可为本部门员工代申）
    if (forEmployeeId) {
      // 主管代申：被代申员工须在本人主管部门内（或账号管理权不受限）
      if (!asset.employeeId || asset.employeeId !== forEmployeeId) {
        return { success: false, error: "只能对该员工名下的设备代发申请" };
      }
      const targetEmp = await prisma.employee.findUnique({ where: { id: forEmployeeId } });
      if (!targetEmp) return { success: false, error: "被代申员工不存在" };
      if (!(await canManageForEmployee(user, targetEmp))) {
        return { success: false, error: "无权为该员工代发申请（仅限本部门）" };
      }
    } else if (!(await hasPermission(user, "asset.manage"))) {
      const me = await prisma.admin.findUnique({
        where: { id: user.id },
        select: { employeeId: true },
      });
      if (!me?.employeeId || asset.employeeId !== me.employeeId) {
        const reason =
          businessType === "ASSET_SCRAP"
            ? "只能对本人名下的设备发起报废申请"
            : businessType === "ASSET_RETURN"
              ? "只能对本人名下的设备发起退回申请"
              : "只能对本人名下的设备发起配件变更申请";
        return { success: false, error: reason };
      }
    }
    if (businessType === "ASSET_UPGRADE") {
      const categoryId = (
        payloadParsed.data as unknown as { componentCategoryId: number }
      ).componentCategoryId;
      const comps = await prisma.assetComponent.findMany({
        where: { assetId: asset.id },
        include: { model: { select: { categoryId: true } } },
      });
      if (!comps.some((c) => c.model.categoryId === categoryId)) {
        return { success: false, error: "该设备不存在该配件类别" };
      }
    }
  }
  // 进预占/流转前，非离职分支必须在上面校验过 asset；此处收窄供后续 reserve 使用
  if (!asset && !isDepart) return { success: false, error: "设备不存在" };

  // 4. 生成单号 + 建单 + 首节点待办 + SUBMIT 日志 + 预占资产
  const requestNo = await nextRequestNo();
  const firstNode = def.nodes[0];
  const firstAssignees = resolutions[0].assignees;

  let req:
    | {
        id: number;
        requestNo: string;
        status: string;
        currentNode: { nodeKey: string } | null;
      }
    | undefined;
  let submitNotifs: NotificationItem[] = [];
  try {
    req = await prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.create({
        data: {
          requestNo,
          definitionId: def.id,
          businessType: def.businessType,
          title: validated.data.title,
          payload: payloadJson,
          status: "PENDING",
          currentNodeId: firstNode.id,
          initiatorId: user.id,
          submittedAt: new Date(),
          tasks: {
            create: firstAssignees.map((assigneeId) => ({
              nodeId: firstNode.id,
              nodeKey: firstNode.nodeKey,
              assigneeId,
              status: "PENDING",
            })),
          },
          logs: {
            create: {
              actorId: user.id,
              action: "SUBMIT",
              fromNodeKey: null,
              toNodeKey: firstNode.nodeKey,
            },
          },
        },
        select: { id: true, requestNo: true, status: true, currentNode: { select: { nodeKey: true } } },
      });

      // M6：通知落库 —— 首节点进入：审批人待办 + 节点抄送（与审批数据同事务）
      const firstCcIds = await resolveNodeCc(firstNode, initiator);
      submitNotifs = dedupeNotifications([
        ...todoNotifications(firstAssignees, request.id, requestNo, validated.data.title),
        ...ccNotifications(firstCcIds, request.id, requestNo, validated.data.title),
      ]);
      await createNotifications(tx, submitNotifs);

      // M5：预占资产（原子条件：仅当未被其他申请预占才成功，否则整单回滚）。离职不针对单台设备，跳过
      if (isDepart) {
        return request;
      }
      const reserve = await tx.asset.updateMany({
        where: { id: asset!.id, status: { not: "RESERVED" } },
        data: {
          status: "RESERVED",
          reservedByRequestId: request.id,
          reservedFromStatus: asset!.status,
        },
      });
      if (reserve.count === 0) {
        throw new Error("ASSET_RESERVED");
      }

      return request;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ASSET_RESERVED") {
      return { success: false, error: "该设备已被其他申请预占" };
    }
    throw e;
  }

  // M6：事务提交后实时推送（无在线连接时静默跳过）
  pushItems(submitNotifs, req.id);

  return {
    success: true,
    data: {
      id: req.id,
      requestNo: req.requestNo,
      status: req.status,
      currentNodeKey: req.currentNode?.nodeKey ?? "",
    },
  };
}

// ============================================================
// 我的待办 / 我的申请 / 申请单详情
// ============================================================

export async function getMyTodoTasks(): Promise<
  ActionResult<
    {
      id: number;
      requestId: number;
      requestNo: string;
      title: string;
      nodeName: string;
      status: string;
      createdAt: Date;
    }[]
  >
> {
  const user = await requireAuth();

  const tasks = await prisma.approvalTask.findMany({
    where: { assigneeId: user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { request: { select: { requestNo: true, title: true } }, node: { select: { name: true } } },
  });

  return {
    success: true,
    data: tasks.map((t) => ({
      id: t.id,
      requestId: t.requestId,
      requestNo: t.request.requestNo,
      title: t.request.title,
      nodeName: t.node.name,
      status: t.status,
      createdAt: t.createdAt,
    })),
  };
}

/** 我的申请（spec §3/§6）：当前用户发起的历史申请单列表，含流转状态 */
export async function getMySubmittedRequests(
  businessType?: "ASSET_UPGRADE" | "ASSET_SCRAP" | "ASSET_RETURN" | "ASSET_REPLACE" | "ASSET_REPAIR" | "ASSET_DEPART"
): Promise<
  ActionResult<
    {
      id: number;
      requestNo: string;
      title: string;
      status: string;
      businessType: string;
      currentNodeName: string | null;
      submittedAt: Date;
      finishedAt: Date | null;
    }[]
  >
> {
  const user = await requireAuth();

  const requests = await prisma.approvalRequest.findMany({
    where: { initiatorId: user.id, ...(businessType ? { businessType } : {}) },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    include: { currentNode: { select: { name: true } } },
  });

  return {
    success: true,
    data: requests.map((r) => ({
      id: r.id,
      requestNo: r.requestNo,
      title: r.title,
      status: r.status,
      businessType: r.businessType,
      currentNodeName: r.currentNode?.name ?? null,
      submittedAt: r.submittedAt,
      finishedAt: r.finishedAt,
    })),
  };
}

export async function getApprovalRequestById(
  requestId: number
): Promise<
  ActionResult<{
    id: number;
    requestNo: string;
    title: string;
    status: string;
    version: number;
    initiatorName: string;
    currentNodeName: string | null;
    payload: unknown;
    submittedAt: Date;
    finishedAt: Date | null;
    logs: {
      action: string;
      comment: string | null;
      fromNodeKey: string | null;
      toNodeKey: string | null;
      createdAt: Date;
    }[];
  }>
> {
  const user = await requireAuth();
  // 数据范围过滤（IDOR 防护）：拥有审批详情权限者可见全部，
  // 否则仅可见与自己相关的申请单（发起人 / 目标员工 / 审批参与人）。
  const canViewAll = await hasPermission(user, "approval.detail.view");

  const req = await prisma.approvalRequest.findFirst({
    where: {
      id: requestId,
      ...(canViewAll
        ? {}
        : {
            OR: [
              { initiatorId: user.id },
              { targetEmployeeId: user.id },
              { tasks: { some: { assigneeId: user.id } } },
            ],
          }),
    },
    include: {
      definition: { select: { version: true } },
      initiator: { include: { employee: { select: { name: true } } } },
      currentNode: { select: { name: true } },
      logs: { orderBy: { createdAt: "asc" } },
    },
  });
  // 数据范围外统一返回"不存在"，避免泄露申请单是否存在（安全最佳实践）
  if (!req) return { success: false, error: "申请单不存在" };

  return {
    success: true,
    data: {
      id: req.id,
      requestNo: req.requestNo,
      title: req.title,
      status: req.status,
      version: req.definition.version,
      initiatorName: req.initiator.employee?.name ?? req.initiator.displayName ?? req.initiator.username,
      currentNodeName: req.currentNode?.name ?? null,
      payload: req.payload,
      submittedAt: req.submittedAt,
      finishedAt: req.finishedAt,
      logs: req.logs.map((l) => ({
        action: l.action,
        comment: l.comment,
        fromNodeKey: l.fromNodeKey,
        toNodeKey: l.toNodeKey,
        createdAt: l.createdAt,
      })),
    },
  };
}

// ============================================================
// 流转：通过 / 驳回
// ============================================================

interface LoadedTask {
  task: {
    id: number;
    status: string;
    nodeKey: string;
    comment: string | null;
  };
  request: {
    id: number;
    status: string;
    initiatorId: number;
    definitionId: number;
    businessType: string;
    payload: Prisma.JsonValue;
    requestNo: string;
    title: string;
  };
  node: {
    id: number;
    sortOrder: number;
    multiMode: string;
    assigneeRole: string | null;
  };
  nodes: {
    id: number;
    nodeKey: string;
    name: string;
    sortOrder: number;
    assigneeType: string;
    assigneeRole: string | null;
    assigneeUserId: number | null;
    ccType: string;
    ccUserIds: Prisma.JsonValue;
    ccRules: Prisma.JsonValue;
  }[];
}

/** 加载待办及申请单/流程节点并校验可操作（归属人、状态） */
async function loadActingTask(
  taskId: number,
  userId: number
): Promise<{ data: LoadedTask | null; error: ActionResult<never> | null }> {
  const task = await prisma.approvalTask.findUnique({
    where: { id: taskId },
    include: {
      node: true,
      request: {
        include: {
          definition: {
            include: { nodes: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
    },
  });
  if (!task) return { data: null, error: { success: false, error: "待办不存在" } };
  if (task.assigneeId !== userId) {
    return { data: null, error: { success: false, error: "无权限处理该待办" } };
  }
  if (task.status !== "PENDING") {
    return { data: null, error: { success: false, error: "该待办已处理" } };
  }
  if (task.request.status !== "PENDING") {
    return { data: null, error: { success: false, error: "申请单已结束" } };
  }
  return {
    data: {
      task: { id: task.id, status: task.status, nodeKey: task.nodeKey, comment: task.comment },
      request: {
        id: task.request.id,
        status: task.request.status,
        initiatorId: task.request.initiatorId,
        definitionId: task.request.definitionId,
        businessType: task.request.businessType,
        payload: task.request.payload,
        requestNo: task.request.requestNo,
        title: task.request.title,
      },
      node: { id: task.nodeId, sortOrder: task.node.sortOrder, multiMode: task.node.multiMode, assigneeRole: task.node.assigneeRole },
      nodes: task.request.definition.nodes.map((n) => ({
        id: n.id,
        nodeKey: n.nodeKey,
        name: n.name,
        sortOrder: n.sortOrder,
        assigneeType: n.assigneeType,
        assigneeRole: n.assigneeRole,
        assigneeUserId: n.assigneeUserId,
        ccType: n.ccType,
        ccUserIds: n.ccUserIds,
        ccRules: n.ccRules,
      })),
    },
    error: null,
  };
}

/**
 * 审批通过后系统自动执行升级配件（M5）。
 * 与 approveTask 同一事务内调用；任何失败抛异常，由调用方记 EXECUTE_FAILED（资产保持预占待人工介入）。
 * 实现见 src/lib/approval-execute.ts（业务与引擎分离）。
 */
export async function approveTask(input: {
  taskId: number;
  comment?: string;
}): Promise<ActionResult<{ ok: true }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "approval.approve", "没有审批权限");
  if (denied) return denied;

  const validated = actSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { data, error } = await loadActingTask(validated.data.taskId, user.id);
  if (error) return error;
  if (!data) return { success: false, error: "待办不存在" };

  const { task, request, node, nodes } = data;
  const nextNode = nodes.find((n) => n.sortOrder > node.sortOrder) ?? null;

  // 流转到下一节点前先解析其审批人；解析不到则整单不推进（配置问题需先修复）
  let nextAssignees: number[] = [];
  const initiator = await getInitiatorWithOrg(request.initiatorId);
  if (nextNode) {
    nextAssignees = await resolveNodeAssignees(nextNode, initiator);
    if (nextAssignees.length === 0) {
      return {
        success: false,
        error: `下一节点（${nextNode.name}）无法解析审批人`,
      };
    }
  }

  // M6：通知（事务内落库，事务后推送）
  let flowNotifs: NotificationItem[] = [];
  let finalNotifs: NotificationItem[] = [];

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    // 原子抢占任务：仅当仍是 PENDING 才可批为 APPROVED；命中数≠1 说明已被并发/重复处理，直接终止（不写任何重复数据）
    const claim = await tx.approvalTask.updateMany({
      where: { id: task.id, status: "PENDING" },
      data: { status: "APPROVED", comment: validated.data.comment ?? null, actedAt: now },
    });
    if (claim.count !== 1) return;

    // 节点通过判定：ANY 任一通过即过；ALL 需全部 PENDING 均已处理
    const remaining = await tx.approvalTask.count({
      where: { requestId: request.id, nodeId: node.id, status: "PENDING" },
    });
    const nodePassed = node.multiMode === "ALL" ? remaining === 0 : true;

    if (nodePassed) {
      // 同节点其余待办（或签场景）跳过
      await tx.approvalTask.updateMany({
        where: { requestId: request.id, nodeId: node.id, status: "PENDING" },
        data: { status: "SKIPPED" },
      });

      if (nextNode) {
        await tx.approvalTask.createMany({
          data: nextAssignees.map((assigneeId) => ({
            requestId: request.id,
            nodeId: nextNode.id,
            nodeKey: nextNode.nodeKey,
            assigneeId,
            status: "PENDING",
          })),
        });
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { currentNodeId: nextNode.id },
        });
        await tx.approvalLog.create({
          data: {
            requestId: request.id,
            actorId: user.id,
            action: "APPROVE",
            fromNodeKey: task.nodeKey,
            toNodeKey: nextNode.nodeKey,
            comment: validated.data.comment ?? null,
          },
        });

        // M6：通知落库 —— 下一节点进入：审批人待办 + 节点抄送
        const nextCcIds = await resolveNodeCc(nextNode, initiator);
        flowNotifs = dedupeNotifications([
          ...todoNotifications(nextAssignees, request.id, request.requestNo, request.title),
          ...ccNotifications(nextCcIds, request.id, request.requestNo, request.title),
        ]);
        await createNotifications(tx, flowNotifs);
      } else {
        // 最后一节点通过 → 终态 APPROVED
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: "APPROVED",
            currentNodeId: null,
            finishedAt: now,
            // 自动执行型（报废/退回）终审自动执行；交接单型（离职）生成对账单待对账；需手动执行的才记录末节点审批角色（仅 "ASSET_MANAGER" 可进待执行）
            finalNodeRole:
              AUTO_EXECUTE_BUSINESS_TYPES.has(request.businessType) ||
              HANDOVER_BUSINESS_TYPES.has(request.businessType)
                ? null
                : node.assigneeRole,
          },
        });
        await tx.approvalLog.create({
          data: {
            requestId: request.id,
            actorId: user.id,
            action: "APPROVE",
            fromNodeKey: task.nodeKey,
            toNodeKey: null,
            comment: validated.data.comment ?? null,
          },
        });

        if (AUTO_EXECUTE_BUSINESS_TYPES.has(request.businessType)) {
          // 自动执行（报废/退回）；失败不阻断审批，记 EXECUTE_FAILED（资产保持预占待人工介入）
          try {
            if (request.businessType === "ASSET_SCRAP") {
              await executeScrapOnApproval(tx, request.id, request.payload);
            } else {
              await executeReturnOnApproval(tx, request.id, request.payload);
            }
            await tx.approvalLog.create({
              data: {
                requestId: request.id,
                actorId: null,
                action: "EXECUTE",
                fromNodeKey: task.nodeKey,
                toNodeKey: null,
              },
            });
          } catch (e) {
            await tx.approvalLog.create({
              data: {
                requestId: request.id,
                actorId: null,
                action: "EXECUTE_FAILED",
                fromNodeKey: task.nodeKey,
                toNodeKey: null,
                meta: { error: e instanceof Error ? e.message : String(e) },
              },
            });
          }
        }
        // ASSET_UPGRADE：完全手动执行 —— 不再调用 executeUpgradeOnApproval、不改配件；
        // 资产保持预占，待资产管理员在「待执行变更」页统一执行（改配件+释放预占+记 executedAt）。

        // ASSET_DEPART：终审生成离职交接单（待对账）；失败记 EXECUTE_FAILED，设备保持原状待人工介入
        if (HANDOVER_BUSINESS_TYPES.has(request.businessType)) {
          try {
            await executeDepartOnApproval(tx, request.id, request.payload);
            await tx.approvalLog.create({
              data: {
                requestId: request.id,
                actorId: null,
                action: "EXECUTE",
                fromNodeKey: task.nodeKey,
                toNodeKey: null,
              },
            });
          } catch (e) {
            await tx.approvalLog.create({
              data: {
                requestId: request.id,
                actorId: null,
                action: "EXECUTE_FAILED",
                fromNodeKey: task.nodeKey,
                toNodeKey: null,
                meta: { error: e instanceof Error ? e.message : String(e) },
              },
            });
          }
        }

        // M6：通知落库 —— 末节点通过：发起人收到「审批通过」
        finalNotifs = [
          resultNotification(
            request.initiatorId,
            request.id,
            request.requestNo,
            request.title,
            true
          ),
        ];
        await createNotifications(tx, finalNotifs);
      }
    } else {
      // ALL 会签尚未集齐，只记日志
      await tx.approvalLog.create({
        data: {
          requestId: request.id,
          actorId: user.id,
          action: "APPROVE",
          fromNodeKey: task.nodeKey,
          toNodeKey: task.nodeKey,
          comment: validated.data.comment ?? null,
        },
      });
    }
  });

  // M6：事务提交后实时推送（无在线连接时静默跳过）
  pushItems(flowNotifs, request.id);
  pushItems(finalNotifs, request.id);

  return { success: true, data: { ok: true } };
}

export async function rejectTask(input: {
  taskId: number;
  comment?: string;
}): Promise<ActionResult<{ ok: true }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "approval.approve", "没有审批权限");
  if (denied) return denied;

  const validated = actSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { data, error } = await loadActingTask(validated.data.taskId, user.id);
  if (error) return error;
  if (!data) return { success: false, error: "待办不存在" };

  const { task, request, node } = data;

  // M6：通知（事务内落库，事务后推送）—— 驳回即终态：发起人收到「审批驳回」
  const rejectNotif = resultNotification(
    request.initiatorId,
    request.id,
    request.requestNo,
    request.title,
    false
  );

  // 驳回即终态：本节点其余待办跳过，申请单 REJECTED
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    // 原子抢占任务：仅当仍是 PENDING 才可驳回为 REJECTED；命中数≠1 说明已被并发/重复处理，直接终止
    const claim = await tx.approvalTask.updateMany({
      where: { id: task.id, status: "PENDING" },
      data: { status: "REJECTED", comment: validated.data.comment ?? null, actedAt: now },
    });
    if (claim.count !== 1) return;
    await tx.approvalTask.updateMany({
      where: { requestId: request.id, nodeId: node.id, status: "PENDING" },
      data: { status: "SKIPPED" },
    });
    await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", currentNodeId: null, finishedAt: now },
    });
    await tx.approvalLog.create({
      data: {
        requestId: request.id,
        actorId: user.id,
        action: "REJECT",
        fromNodeKey: task.nodeKey,
        toNodeKey: null,
        comment: validated.data.comment ?? null,
      },
    });

    // M5：驳回即终态，释放预占资产并恢复原状态
    const reservedAsset = await tx.asset.findFirst({
      where: { reservedByRequestId: request.id },
    });
    if (reservedAsset) {
      await tx.asset.update({
        where: { id: reservedAsset.id },
        data: {
          status: reservedAsset.reservedFromStatus ?? "IDLE",
          reservedByRequestId: null,
          reservedFromStatus: null,
        },
      });
    }

    // M6：通知落库
    await createNotifications(tx, [rejectNotif]);
  });

  // M6：事务提交后实时推送（与 approveTask 同一通道）
  pushItems([rejectNotif], request.id);

  return { success: true, data: { ok: true } };
}
