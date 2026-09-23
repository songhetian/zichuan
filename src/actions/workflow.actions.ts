"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { parseCcRules } from "@/lib/cc-rules";

// ============================================================
// 流程配置（M3）：定义/节点/版本 管理
// 规则：
//   - 一个业务类型可有多个版本，同时只有一个 PUBLISHED
//   - 未删除的版本（草稿/生效/归档）均可原地编辑节点；删除后不再存在
//   - 节点为顺序链（sortOrder 升序），START/END 由引擎隐式
// ============================================================

const businessTypeSchema = z.enum(["ASSET_UPGRADE", "ASSET_SCRAP"], {
  message: "业务类型不合法",
});

const nodeInputSchema = z.object({
  name: z.string().min(1, "节点名称不能为空"),
  assigneeType: z.enum(["USER", "ROLE", "DEPT_MANAGER", "EMP_MANAGER", "INITIATOR", "CUSTOM"], {
    message: "审批人类型不合法",
  }),
  assigneeUserId: z.number().int().positive().optional(),
  assigneeRole: z.string().optional(),
  initiatorCanChoose: z.boolean().optional(),
  multiMode: z.enum(["ANY", "ALL"], {
    message: "审批方式不合法",
  }).optional(),
  ccType: z.enum(["NONE", "INITIATOR", "DEPT_MANAGER", "EMP_MANAGER", "SPECIFIC"], {
    message: "抄送类型不合法",
  }).optional(),
  ccUserIds: z.array(z.number().int().positive()).optional(),
  ccRules: z
    .array(
      z.union([
        z.object({ type: z.literal("INITIATOR") }),
        z.object({ type: z.literal("DEPT_MANAGER") }),
        z.object({ type: z.literal("EMP_MANAGER") }),
        z.object({ type: z.literal("ROLE"), roleKey: z.string().min(1, "抄送角色不能为空") }),
        z.object({ type: z.literal("USER"), userIds: z.array(z.number().int().positive()) }),
      ])
    )
    .optional(),
});

export type WorkflowNodeInput = z.infer<typeof nodeInputSchema>;

const createSchema = z.object({
  businessType: businessTypeSchema,
  name: z.string().min(1, "流程名称不能为空"),
  nodes: z.array(nodeInputSchema).min(1, "审批链至少需要一个节点"),
});

/** 校验节点字段间的依赖：ROLE 必须带 assigneeRole；SPECIFIC 必须带 ccUserIds */
function validateNode(n: WorkflowNodeInput): string | null {
  if (n.assigneeType === "ROLE" && !n.assigneeRole) {
    return "按角色审批时必须指定角色";
  }
  if (n.assigneeType === "USER" && !n.assigneeUserId) {
    return "指定审批人时必须选择账号";
  }
  if (n.ccType === "SPECIFIC" && (!n.ccUserIds || n.ccUserIds.length === 0)) {
    return "抄送指定人时必须选择抄送对象";
  }
  return null;
}

/** 是否已是「资产管理员(按角色)」节点 */
function isAssetManagerNode(n: { assigneeType?: string; assigneeRole?: string | null }): boolean {
  return n.assigneeType === "ROLE" && n.assigneeRole === "ASSET_MANAGER";
}

/** 默认资产管理员末节点（升级/降级配件为完全手动执行，末节点必须是资产管理员才可进「待执行变更」） */
function defaultAssetManagerNode(nodeKey: string, sortOrder: number) {
  return {
    nodeKey,
    name: "资产管理员审批",
    type: "APPROVAL" as const,
    sortOrder,
    assigneeType: "ROLE" as const,
    assigneeUserId: null,
    assigneeRole: "ASSET_MANAGER",
    initiatorCanChoose: false,
    multiMode: "ANY" as const,
    ccType: "NONE" as const,
    ccUserIds: undefined,
    ccRules: undefined,
    rejectPolicy: "TO_START" as const,
    rejectToNodeId: null,
  };
}

/**
 * 保证 ASSET_UPGRADE 审批流「末节点=资产管理员」不变式。
 * 升级/降级配件为完全手动执行：末节点必须是 角色=ASSET_MANAGER(assigneeType=ROLE + assigneeRole=ASSET_MANAGER)，
 * 新单才能进入「待执行变更」（按 finalNodeRole=ASSET_MANAGER 筛选）。
 * 在改动节点/创建流程的同一事务内调用（幂等）：
 *   - 末节点已是资产管理员 → 无操作；
 *   - 已存在资产管理员节点但非末位 → 置为末位（保持「恰好一个作为末节点」，不重复）；
 *   - 不存在资产管理员节点 → 在末尾追加一个默认资产管理员节点。
 * ASSET_SCRAP 等其它业务类型完全不受影响。
 */
async function ensureAssetManagerFinalNode(
  db: Prisma.TransactionClient,
  definitionId: number,
  businessType: string
): Promise<void> {
  if (businessType !== "ASSET_UPGRADE") return;

  const nodes = await db.workflowNode.findMany({
    where: { definitionId },
    select: {
      id: true,
      nodeKey: true,
      sortOrder: true,
      assigneeType: true,
      assigneeRole: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  if (nodes.length === 0) return;

  const last = nodes[nodes.length - 1];
  if (isAssetManagerNode(last)) return;

  const maxOrder = nodes[nodes.length - 1].sortOrder;
  // 已存在资产管理员节点但非末位 → 置为末位（取最靠后的一个以免端序波动）
  let existingAm: (typeof nodes)[number] | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (isAssetManagerNode(nodes[i])) {
      existingAm = nodes[i];
      break;
    }
  }
  if (existingAm) {
    await db.workflowNode.update({
      where: { id: existingAm.id },
      data: { sortOrder: maxOrder + 1 },
    });
    return;
  }

  // 否则追加一个默认资产管理员末节点
  let maxSeq = 0;
  for (const n of nodes) {
    const m = n.nodeKey.match(/^n(\d+)$/);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  await db.workflowNode.create({
    data: {
      ...defaultAssetManagerNode(`n${maxSeq + 1}`, maxOrder + 1),
      definitionId,
    },
  });
}

/** 求节点 key 的最大序号（n1 → 1），用于追加时生成下一个稳定标识 */
async function maxNodeSeq(definitionId: number): Promise<number> {
  const nodes = await prisma.workflowNode.findMany({
    where: { definitionId },
    select: { nodeKey: true },
  });
  let max = 0;
  for (const n of nodes) {
    const m = n.nodeKey.match(/^n(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

async function getDefinition(definitionId: number) {
  return prisma.workflowDefinition.findUnique({ where: { id: definitionId } });
}

/** 重要配置操作写入系统日志（审计用） */
async function writeLog(
  user: { username: string },
  action: string,
  detail: string
): Promise<void> {
  await prisma.systemLog.create({
    data: { module: "workflow", action, detail, operator: user.username },
  });
}

async function guardEditable(
  definitionId: number
): Promise<{ def: Awaited<ReturnType<typeof getDefinition>>; error: ActionResult<never> | null }> {
  const def = await getDefinition(definitionId);
  if (!def) return { def: null, error: { success: false, error: "流程定义不存在" } };
  // 只要版本未被删除即可编辑节点（草稿/生效/归档一致）
  return { def, error: null };
}

// ============================================================
// 查询
// ============================================================

export async function getWorkflowDefinitions(
  businessType: z.infer<typeof businessTypeSchema>
): Promise<
  ActionResult<
    {
      id: number;
      name: string;
      version: number;
      status: string;
      publishedAt: Date | null;
      nodeCount: number;
    }[]
  >
> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const defs = await prisma.workflowDefinition.findMany({
    where: { businessType },
    include: { _count: { select: { nodes: true } } },
    orderBy: { version: "desc" },
  });

  return {
    success: true,
    data: defs.map((d) => ({
      id: d.id,
      name: d.name,
      version: d.version,
      status: d.status,
      publishedAt: d.publishedAt,
      nodeCount: d._count.nodes,
    })),
  };
}

export async function getWorkflowDefinition(
  definitionId: number
): Promise<
  ActionResult<{
    id: number;
    name: string;
    businessType: string;
    version: number;
    status: string;
    publishedAt: Date | null;
    nodes: {
      id: number;
      nodeKey: string;
      name: string;
      sortOrder: number;
      assigneeType: string;
      assigneeUserId: number | null;
      assigneeRole: string | null;
      initiatorCanChoose: boolean;
      multiMode: string;
      ccType: string;
      ccUserIds: number[] | null;
      ccRules: unknown;
    }[];
  }>
> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const def = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { nodes: { orderBy: { sortOrder: "asc" } } },
  });
  if (!def) return { success: false, error: "流程定义不存在" };

  return {
    success: true,
    data: {
      id: def.id,
      name: def.name,
      businessType: def.businessType,
      version: def.version,
      status: def.status,
      publishedAt: def.publishedAt,
      nodes: def.nodes.map((n) => ({
        id: n.id,
        nodeKey: n.nodeKey,
        name: n.name,
        sortOrder: n.sortOrder,
        assigneeType: n.assigneeType,
        assigneeUserId: n.assigneeUserId,
        assigneeRole: n.assigneeRole,
        initiatorCanChoose: n.initiatorCanChoose,
        multiMode: n.multiMode,
        ccType: n.ccType,
        ccUserIds: n.ccUserIds as number[] | null,
        ccRules: parseCcRules(n.ccRules),
      })),
    },
  };
}

/** 各业务类型的流程配置汇总（新建时提示「该类型已有配置」用） */
export async function getWorkflowConfigSummary(): Promise<
  ActionResult<
    Record<
      z.infer<typeof businessTypeSchema>,
      { total: number; published: number }
    >
  >
> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const types: z.infer<typeof businessTypeSchema>[] = ["ASSET_UPGRADE", "ASSET_SCRAP"];
  const out = {} as Record<
    z.infer<typeof businessTypeSchema>,
    { total: number; published: number }
  >;
  for (const t of types) {
    const [total, published] = await Promise.all([
      prisma.workflowDefinition.count({ where: { businessType: t } }),
      prisma.workflowDefinition.count({
        where: { businessType: t, status: "PUBLISHED" },
      }),
    ]);
    out[t] = { total, published };
  }
  return { success: true, data: out };
}

// ============================================================
// 创建 / 节点管理
// ============================================================

export async function createWorkflowDefinition(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string; version: number; status: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  for (const n of validated.data.nodes) {
    const err = validateNode(n);
    if (err) return { success: false, error: err };
  }

  const { businessType, name, nodes } = validated.data;

  const maxVersion = await prisma.workflowDefinition.aggregate({
    where: { businessType },
    _max: { version: true },
  });
  const version = (maxVersion._max.version ?? 0) + 1;

  // 升级/降级配件为手动执行：末节点必须是资产管理员（缺失/非末位由 ensureAssetManagerFinalNode 自动修正）
  const nodeCreateItems: Prisma.WorkflowNodeCreateWithoutDefinitionInput[] = nodes.map(
    (n, i) => ({
      nodeKey: `n${i + 1}`,
      name: n.name,
      type: "APPROVAL" as const,
      sortOrder: i,
      assigneeType: n.assigneeType,
      assigneeUserId: n.assigneeUserId ?? null,
      assigneeRole: n.assigneeRole ?? null,
      initiatorCanChoose: n.initiatorCanChoose ?? false,
      multiMode: n.multiMode ?? "ANY",
      ccType: n.ccType ?? "NONE",
      ccUserIds: n.ccUserIds ? JSON.stringify(n.ccUserIds) : undefined,
      ccRules: n.ccRules ? JSON.parse(JSON.stringify(n.ccRules)) : undefined,
    })
  );

  const def = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowDefinition.create({
      data: {
        businessType,
        name,
        version,
        status: "DRAFT",
        createdById: user.id,
        nodes: { create: nodeCreateItems },
      },
    });
    await ensureAssetManagerFinalNode(tx, created.id, businessType);
    return created;
  });

  await writeLog(
    user,
    "CREATE",
    `创建流程草稿 v${version}「${name}」（类型：${businessType}）`
  );

  return {
    success: true,
    data: { id: def.id, name: def.name, version: def.version, status: def.status },
  };
}

export async function addWorkflowNode(
  definitionId: number,
  input: WorkflowNodeInput
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const validated = nodeInputSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }
  const err = validateNode(validated.data);
  if (err) return { success: false, error: err };

  const { def, error } = await guardEditable(definitionId);
  if (error) return error;
  if (!def) return { success: false, error: "流程定义不存在" };

  const seq = (await maxNodeSeq(definitionId)) + 1;
  const maxOrder = await prisma.workflowNode.aggregate({
    where: { definitionId },
    _max: { sortOrder: true },
  });

  const n = validated.data;
  const node = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowNode.create({
      data: {
        definitionId,
        nodeKey: `n${seq}`,
        name: n.name,
        type: "APPROVAL",
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        assigneeType: n.assigneeType,
        assigneeUserId: n.assigneeUserId ?? null,
        assigneeRole: n.assigneeRole ?? null,
        initiatorCanChoose: n.initiatorCanChoose ?? false,
        multiMode: n.multiMode ?? "ANY",
        ccType: n.ccType ?? "NONE",
        ccUserIds: n.ccUserIds ? JSON.stringify(n.ccUserIds) : undefined,
        ccRules: n.ccRules ? JSON.parse(JSON.stringify(n.ccRules)) : undefined,
      },
    });
    // 追加后保持 ASSET_UPGRADE 末节点=资产管理员不变式
    await ensureAssetManagerFinalNode(tx, definitionId, def.businessType);
    return created;
  });

  return { success: true, data: { id: node.id } };
}

export async function updateWorkflowNode(
  nodeId: number,
  input: Partial<WorkflowNodeInput>
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const validated = nodeInputSchema.partial().safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.workflowNode.findUnique({ where: { id: nodeId } });
  if (!existing) return { success: false, error: "节点不存在" };

  const { def, error } = await guardEditable(existing.definitionId);
  if (error) return error;
  if (!def) return { success: false, error: "流程定义不存在" };

  const merged: WorkflowNodeInput = {
    name: validated.data.name ?? existing.name,
    assigneeType: validated.data.assigneeType ?? existing.assigneeType,
    assigneeUserId: validated.data.assigneeUserId ?? existing.assigneeUserId ?? undefined,
    assigneeRole: validated.data.assigneeRole ?? existing.assigneeRole ?? undefined,
    initiatorCanChoose: validated.data.initiatorCanChoose ?? existing.initiatorCanChoose,
    multiMode: validated.data.multiMode ?? existing.multiMode,
    ccType: validated.data.ccType ?? existing.ccType,
    ccUserIds:
      validated.data.ccUserIds ?? (existing.ccUserIds as number[] | null) ?? undefined,
    ccRules: validated.data.ccRules ?? parseCcRules(existing.ccRules) ?? undefined,
  };
  const err = validateNode(merged);
  if (err) return { success: false, error: err };

  await prisma.$transaction(async (tx) => {
    await tx.workflowNode.update({
      where: { id: nodeId },
      data: {
        name: merged.name,
        assigneeType: merged.assigneeType,
        assigneeUserId: merged.assigneeUserId ?? null,
        assigneeRole: merged.assigneeRole ?? null,
        initiatorCanChoose: merged.initiatorCanChoose,
        multiMode: merged.multiMode,
        ccType: merged.ccType,
        ccUserIds: merged.ccUserIds ? JSON.stringify(merged.ccUserIds) : Prisma.JsonNull,
        ccRules: merged.ccRules
          ? JSON.parse(JSON.stringify(merged.ccRules))
          : Prisma.JsonNull,
      },
    });
    // 更新后保持 ASSET_UPGRADE 末节点=资产管理员不变式（可能把末位资产管理员改走）
    await ensureAssetManagerFinalNode(tx, existing.definitionId, def.businessType);
  });

  return { success: true, data: { id: nodeId } };
}

export async function removeWorkflowNode(
  nodeId: number
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const existing = await prisma.workflowNode.findUnique({ where: { id: nodeId } });
  if (!existing) return { success: false, error: "节点不存在" };

  const { def, error } = await guardEditable(existing.definitionId);
  if (error) return error;
  if (!def) return { success: false, error: "流程定义不存在" };

  const count = await prisma.workflowNode.count({
    where: { definitionId: existing.definitionId },
  });
  if (count <= 1) {
    return { success: false, error: "审批链至少需要一个节点" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.workflowNode.delete({ where: { id: nodeId } });
    // 删除后保持 ASSET_UPGRADE 末节点=资产管理员不变式（可能删掉了末位资产管理员）
    await ensureAssetManagerFinalNode(tx, existing.definitionId, def.businessType);
  });
  return { success: true, data: { id: nodeId } };
}

export async function duplicateWorkflowNode(
  nodeId: number
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const source = await prisma.workflowNode.findUnique({ where: { id: nodeId } });
  if (!source) return { success: false, error: "节点不存在" };

  const { error } = await guardEditable(source.definitionId);
  if (error) return error;

  const seq = (await maxNodeSeq(source.definitionId)) + 1;
  const insertOrder = source.sortOrder + 1;

  const created = await prisma.$transaction(async (tx) => {
    // 复制后的节点紧邻原节点之后，插入点上原有的后续节点整体后移
    await tx.workflowNode.updateMany({
      where: {
        definitionId: source.definitionId,
        sortOrder: { gte: insertOrder },
      },
      data: { sortOrder: { increment: 1 } },
    });
    return tx.workflowNode.create({
      data: {
        definitionId: source.definitionId,
        nodeKey: `n${seq}`,
        name: source.name,
        type: source.type,
        sortOrder: insertOrder,
        assigneeType: source.assigneeType,
        assigneeUserId: source.assigneeUserId,
        assigneeRole: source.assigneeRole,
        initiatorCanChoose: source.initiatorCanChoose,
        multiMode: source.multiMode,
        ccType: source.ccType,
        ccUserIds: source.ccUserIds
          ? JSON.stringify(source.ccUserIds)
          : Prisma.JsonNull,
        ccRules: source.ccRules
          ? JSON.parse(JSON.stringify(
              typeof source.ccRules === "string"
                ? JSON.parse(source.ccRules)
                : source.ccRules
            ))
          : Prisma.JsonNull,
      },
    });
  });

  return { success: true, data: { id: created.id } };
}

export async function reorderWorkflowNodes(
  definitionId: number,
  nodeIds: number[]
): Promise<ActionResult<{ ok: true }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  if (nodeIds.length === 0) {
    return { success: false, error: "节点顺序不能为空" };
  }

  const { def, error } = await guardEditable(definitionId);
  if (error) return error;
  if (!def) return { success: false, error: "流程定义不存在" };

  const nodes = await prisma.workflowNode.findMany({
    where: { definitionId },
    select: { id: true },
  });
  const existingIds = nodes.map((n) => n.id).sort((a, b) => a - b);
  const givenIds = [...nodeIds].sort((a, b) => a - b);
  if (
    givenIds.length !== existingIds.length ||
    givenIds.some((id, i) => id !== existingIds[i])
  ) {
    return { success: false, error: "节点顺序与当前节点不一致" };
  }

  await prisma.$transaction(async (tx) => {
    for (const [index, id] of nodeIds.entries()) {
      await tx.workflowNode.update({ where: { id }, data: { sortOrder: index } });
    }
    // 调序后保持 ASSET_UPGRADE 末节点=资产管理员不变式（资产管理员移出末位则回置末位）
    await ensureAssetManagerFinalNode(tx, definitionId, def.businessType);
  });

  return { success: true, data: { ok: true } };
}

// ============================================================
// 发布（发布即切换生效版本）
// ============================================================

export async function publishWorkflowDefinition(
  definitionId: number
): Promise<ActionResult<{ id: number; version: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const def = await getDefinition(definitionId);
  if (!def) return { success: false, error: "流程定义不存在" };
  if (def.status !== "DRAFT") {
    return { success: false, error: "仅草稿可发布" };
  }

  await prisma.$transaction([
    // 同类型旧发布版自动归档
    prisma.workflowDefinition.updateMany({
      where: { businessType: def.businessType, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    }),
    prisma.workflowDefinition.update({
      where: { id: definitionId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    }),
  ]);

  await writeLog(
    user,
    "PUBLISH",
    `发布流程 v${def.version}「${def.name}」生效（类型：${def.businessType}）`
  );

  return { success: true, data: { id: def.id, version: def.version } };
}

// ============================================================
// 发布版可管理化（M×）：派生新版草稿 / 删除草稿 / 历史版本设为当前生效
// ============================================================

/** 一键复制任意版本为新版草稿（深拷贝节点配置），用于「已发布/已归档版本也能被改动」 */
export async function duplicateWorkflowDefinition(
  definitionId: number
): Promise<ActionResult<{ id: number; name: string; version: number; status: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const source = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { nodes: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) return { success: false, error: "流程定义不存在" };

  const maxVersion = await prisma.workflowDefinition.aggregate({
    where: { businessType: source.businessType },
    _max: { version: true },
  });
  const version = (maxVersion._max.version ?? 0) + 1;

  // 升级/降级配件为手动执行：末节点必须是资产管理员（缺失/非末位由 ensureAssetManagerFinalNode 自动修正）
  const nodeCreateItems: Prisma.WorkflowNodeCreateWithoutDefinitionInput[] = source.nodes.map(
    (n, i) => ({
      nodeKey: `n${i + 1}`,
      name: n.name,
      type: n.type,
      sortOrder: i,
      assigneeType: n.assigneeType,
      assigneeUserId: n.assigneeUserId ?? null,
      assigneeRole: n.assigneeRole ?? null,
      initiatorCanChoose: n.initiatorCanChoose,
      multiMode: n.multiMode,
      ccType: n.ccType,
      ccUserIds: n.ccUserIds ? JSON.stringify(n.ccUserIds) : undefined,
      ccRules: n.ccRules ? JSON.parse(JSON.stringify(n.ccRules)) : undefined,
      rejectPolicy: n.rejectPolicy,
      rejectToNodeId: n.rejectToNodeId,
    })
  );

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowDefinition.create({
      data: {
        businessType: source.businessType,
        name: source.name,
        version,
        status: "DRAFT",
        createdById: user.id,
        nodes: { create: nodeCreateItems },
      },
    });
    await ensureAssetManagerFinalNode(tx, created.id, source.businessType);
    return created;
  });

  await writeLog(
    user,
    "DUPLICATE",
    `由 v${source.version}「${source.name}」复制为新草稿 v${version}（类型：${source.businessType}）`
  );

  return {
    success: true,
    data: { id: copy.id, name: copy.name, version: copy.version, status: copy.status },
  };
}

/** 删除未发布的草稿版本 */
export async function removeWorkflowDraft(
  definitionId: number
): Promise<ActionResult<{ ok: true }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const def = await getDefinition(definitionId);
  if (!def) return { success: false, error: "流程定义不存在" };

  // 当前生效（PUBLISHED）版本视为正在使用，禁止删除，避免业务类型失去默认流程
  if (def.status === "PUBLISHED") {
    return {
      success: false,
      error: "该流程为当前生效版本，正在使用中，无法删除；如需更换请先激活其他版本",
    };
  }

  const used = await prisma.approvalRequest.count({ where: { definitionId } });
  if (used > 0) {
    return { success: false, error: "该流程版本已被审批单引用，无法删除" };
  }

  const total = await prisma.workflowDefinition.count({
    where: { businessType: def.businessType },
  });
  if (total <= 1) {
    return { success: false, error: "该流程类型至少需保留一个版本" };
  }

  await prisma.$transaction([
    prisma.workflowEdge.deleteMany({ where: { definitionId } }),
    prisma.workflowDefinition.delete({ where: { id: definitionId } }),
  ]);

  await writeLog(
    user,
    "DELETE",
    `删除流程版本 v${def.version}「${def.name}」（类型：${def.businessType}）`
  );

  return { success: true, data: { ok: true } };
}

/** 历史版本一键设为当前生效（自动归档现行 PUBLISHED，保持同类型仅一个生效版） */
export async function activateWorkflowVersion(
  definitionId: number
): Promise<ActionResult<{ id: number; version: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "workflow.config.manage", "没有流程配置权限");
  if (denied) return denied;

  const target = await getDefinition(definitionId);
  if (!target) return { success: false, error: "流程定义不存在" };
  if (target.status === "PUBLISHED") {
    // 已生效：幂等，直接成功
    return { success: true, data: { id: target.id, version: target.version } };
  }
  if (target.status === "DRAFT") {
    return { success: false, error: "草稿需先发布，请使用『发布』" };
  }

  await prisma.$transaction([
    prisma.workflowDefinition.updateMany({
      where: { businessType: target.businessType, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    }),
    prisma.workflowDefinition.update({
      where: { id: definitionId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    }),
  ]);

  await writeLog(
    user,
    "ACTIVATE",
    `历史版本 v${target.version}「${target.name}」设为当前生效（类型：${target.businessType}）`
  );

  return { success: true, data: { id: target.id, version: target.version } };
}

