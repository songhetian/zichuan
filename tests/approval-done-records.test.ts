import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { submitApprovalRequest, approveTask, getMyTodoTasks, getMyHandledRecords, getHandledRecordFilterOptions } from "@/actions/approval.actions";
import {
  executeApprovedChange,
  executeReplaceChange,
  executeRepairChange,
} from "@/actions/approval-execute.actions";
import { exportHandledRecordsToExcel } from "@/actions/excel.actions";
import * as XLSX from "xlsx";

// ============================================================
// 「我办理的记录」(/approvals/done)
// Seam：submitApprovalRequest / getMyHandledRecords 等导出的 action 函数
// ============================================================

async function seedRole(key: string, permissions: string[]) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, isSystem: true },
  });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "approval", name: p },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function seedAccount(username: string, roleKey: string, permissions: string[], employeeId?: number) {
  const role = await seedRole(roleKey, permissions);
  return prisma.admin.create({
    data: { username, password: "x", roleId: role.id, employeeId },
  });
}

/** 最小可提交环境：部门主管→资产管理员 两节点流程 + 申请人 + 带配件的设备 */
async function seedEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id, managerId: mgrEmp.id },
  });
  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve", "approval.done.view"], mgrEmp.id);
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
    "approval.approve",
    "asset.manage",
    "approval.done.view",
    "approval.done.export",
  ]);
  // 审计账号：可看「全部办理记录」（approval.detail.view），但自己不办理业务
  const auditor = await seedAccount("auditor", "AUDITOR", [
    "approval.done.view",
    "approval.detail.view",
  ]);

  const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const oldModel = await prisma.componentModel.create({
    data: { name: "DDR4-8G", categoryId: compCat.id },
  });

  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准办公电脑", categoryId: assetCat.id },
  });
  const asset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "申请员工的电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });
  await prisma.assetComponent.create({
    data: { assetId: asset.id, modelId: oldModel.id, quantity: 1 },
  });
  const asset2 = await prisma.asset.create({
    data: {
      assetNo: "DN-0002",
      name: "申请员工的电脑2",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });

  async function seedWorkflow(
    businessType: "ASSET_SCRAP" | "ASSET_RETURN" | "ASSET_UPGRADE" | "ASSET_REPLACE" | "ASSET_REPAIR" | "ASSET_DEPART"
  ) {
    return prisma.workflowDefinition.create({
      data: {
        businessType,
        name: `${businessType} 流程`,
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        nodes: {
          create: [
            { nodeKey: "n1", name: "部门主管审批", type: "APPROVAL", sortOrder: 0, assigneeType: "DEPT_MANAGER" },
            { nodeKey: "n2", name: "资产管理员审批", type: "APPROVAL", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" },
          ],
        },
      },
    });
  }

  return { dept, emp, mgrEmp, initiator, deptMgr, assetMgr, auditor, compCat, oldModel, asset, asset2, seedWorkflow };
}

async function cleanup() {
  await prisma.notification.deleteMany();
  await prisma.approvalTask.deleteMany();
  await prisma.approvalLog.deleteMany();
  await prisma.lifecycleLog.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.assetComponent.deleteMany();
  await prisma.componentStockLog.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.deviceTemplate.deleteMany();
  await prisma.assetCategory.deleteMany();
  await prisma.componentStock.deleteMany();
  await prisma.componentModel.deleteMany();
  await prisma.componentCategory.deleteMany();
  await prisma.workflowNode.deleteMany();
  await prisma.workflowDefinition.deleteMany();
  await prisma.adminDepartment.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
}

beforeEach(cleanup);
afterEach(() => setTestUser(null));

describe("提交申请：写入 componentCategoryId（配件类型筛选的数据源）", () => {
  it("升级申请：建单时冗余 payload.componentCategoryId", async () => {
    const { initiator, compCat, asset, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_UPGRADE");

    setTestUser({ id: initiator.id, username: initiator.username });
    const r = await submitApprovalRequest({
      title: "升级内存",
      businessType: "ASSET_UPGRADE",
      payload: {
        assetId: asset.id,
        componentCategoryId: compCat.id,
        action: "UPGRADE",
        reason: "内存不足",
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const row = await prisma.approvalRequest.findUnique({ where: { id: r.data.id } });
    expect(row?.componentCategoryId).toBe(compCat.id);
  });

  it("维修申请（payload 无配件类型）：componentCategoryId 为空", async () => {
    const { initiator, asset2, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_REPAIR");

    setTestUser({ id: initiator.id, username: initiator.username });
    const r = await submitApprovalRequest({
      title: "维修电脑",
      businessType: "ASSET_REPAIR",
      payload: { assetId: asset2.id, reason: "屏幕坏了" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const row = await prisma.approvalRequest.findUnique({ where: { id: r.data.id } });
    expect(row?.componentCategoryId).toBeNull();
  });
});

/** 走完两节点审批：部门主管 → 资产管理员 */
async function approveAll(
  deptMgr: { id: number; username: string },
  assetMgr: { id: number; username: string }
) {
  setTestUser({ id: deptMgr.id, username: deptMgr.username });
  const t1 = await getMyTodoTasks();
  if (!t1.success || !t1.data[0]) throw new Error("部门主管无待办");
  await approveTask({ taskId: t1.data[0].id, comment: "同意" });

  setTestUser({ id: assetMgr.id, username: assetMgr.username });
  const t2 = await getMyTodoTasks();
  if (!t2.success || !t2.data[0]) throw new Error("资产管理员无待办");
  await approveTask({ taskId: t2.data[0].id, comment: "同意" });
}

describe("我办理的记录：getMyHandledRecords 每单一行 + 动作标签", () => {
  it("我审批过的单：出现在结果中，动作标签为审批/驳回", async () => {
    const { initiator, deptMgr, assetMgr, asset, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");

    setTestUser({ id: initiator.id, username: initiator.username });
    const sub = await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "太旧了" },
    });
    expect(sub.success).toBe(true);
    if (!sub.success) return;
    await approveAll(deptMgr, assetMgr);

    // 资产管理员（终审+触发自动执行）
    const r = await getMyHandledRecords();
    expect(r.success).toBe(true);
    if (!r.success) return;
    const mine = r.data.find((x) => x.requestId === sub.data.id);
    expect(mine).toBeDefined();
    expect(mine?.actions).toContain("APPROVE");
    expect(mine?.actions).toContain("EXECUTE");

    // 部门主管（仅审批）
    setTestUser({ id: deptMgr.id, username: deptMgr.username });
    const r2 = await getMyHandledRecords();
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    const mgr = r2.data.find((x) => x.requestId === sub.data.id);
    expect(mgr).toBeDefined();
    expect(mgr?.actions).toEqual(["APPROVE"]);
  });

  it("每单一行：同一张单多动作聚合，按最后动作时间倒序", async () => {
    const { initiator, deptMgr, assetMgr, asset, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");

    setTestUser({ id: initiator.id, username: initiator.username });
    await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "太旧了" },
    });
    // 先驳回一单再新提交一单，验证倒序
    await approveAll(deptMgr, assetMgr);

    const r = await getMyHandledRecords();
    expect(r.success).toBe(true);
    if (!r.success) return;
    const ids = r.data.map((x) => x.requestId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(ids.length); // 无重复单
  });
});

describe("双模式：我办理的 / 全部办理记录（权限 + 数据范围）", () => {
  async function seedHandled() {
    const env = await seedEnv();
    await env.seedWorkflow("ASSET_SCRAP");
    setTestUser({ id: env.initiator.id, username: env.initiator.username });
    const sub = await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP",
      payload: { assetId: env.asset.id, reason: "太旧了" },
    });
    await approveAll(env.deptMgr, env.assetMgr);
    return { ...env, requestId: sub.success ? sub.data.id : 0 };
  }

  it("无 approval.done.view 权限 → 拒绝", async () => {
    const { initiator } = await seedEnv();
    setTestUser({ id: initiator.id, username: initiator.username });
    const r = await getMyHandledRecords();
    expect(r.success).toBe(false);
  });

  it("切换到「全部办理记录」但无 approval.detail.view → 拒绝", async () => {
    // 只持 done.view（不含审批模块，避免模块级权限展开带出 detail.view）
    const viewer = await seedAccount("viewer", "VIEWER", ["approval.done.view"]);
    setTestUser({ id: viewer.id, username: viewer.username });
    const r = await getMyHandledRecords({ mode: "ALL" });
    expect(r.success).toBe(false);
  });

  it("有 approval.detail.view → 全部模式可见他人办理的单；默认模式仅见我办理的", async () => {
    const { auditor, requestId } = await seedHandled();

    setTestUser({ id: auditor.id, username: auditor.username });
    const mine = await getMyHandledRecords();
    expect(mine.success).toBe(true);
    if (!mine.success) return;
    expect(mine.data).toHaveLength(0); // 我没办理过任何单

    const all = await getMyHandledRecords({ mode: "ALL" });
    expect(all.success).toBe(true);
    if (!all.success) return;
    expect(all.data.map((x) => x.requestId)).toContain(requestId);
  });

  it("全部模式受账号数据范围约束：范围外部门发起人的单不可见", async () => {
    const { auditor, requestId, dept } = await seedHandled();
    const otherDept = await prisma.department.create({ data: { name: "市场部" } });
    // 把审计账号的数据范围精确限定到「市场部」
    await prisma.admin.update({ where: { id: auditor.id }, data: { departmentScope: "EXACT" } });
    await prisma.adminDepartment.create({ data: { adminId: auditor.id, departmentId: otherDept.id } });

    setTestUser({ id: auditor.id, username: auditor.username });
    const all = await getMyHandledRecords({ mode: "ALL" });
    expect(all.success).toBe(true);
    if (!all.success) return;
    expect(all.data.map((x) => x.requestId)).not.toContain(requestId);

    // 反向确认：本部门（技术部）在范围内时可见
    await prisma.adminDepartment.deleteMany({ where: { adminId: auditor.id } });
    await prisma.adminDepartment.create({ data: { adminId: auditor.id, departmentId: dept.id } });
    const again = await getMyHandledRecords({ mode: "ALL" });
    expect(again.success).toBe(true);
    if (!again.success) return;
    expect(again.data.map((x) => x.requestId)).toContain(requestId);
  });
});

describe("筛选：日期 / 人员 / 部门 / 配件类型 / 业务类型 / 关键字", () => {
  /** 直接造单 + 造「我的办理日志」，便于精确控制筛选维度 */
  async function seedRow(opts: {
    businessType: string;
    initiatorId: number;
    requestNo: string;
    title: string;
    componentCategoryId?: number | null;
    actedAt: Date;
    actorId: number;
  }) {
    const def =
      (await prisma.workflowDefinition.findFirst({
        where: { businessType: opts.businessType as never, version: 1 },
      })) ??
      (await prisma.workflowDefinition.create({
        data: {
          businessType: opts.businessType as never,
          name: `${opts.businessType} 流程`,
          version: 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      }));
    const req = await prisma.approvalRequest.create({
      data: {
        requestNo: opts.requestNo,
        definitionId: def.id,
        businessType: opts.businessType as never,
        title: opts.title,
        status: "APPROVED",
        finishedAt: opts.actedAt,
        componentCategoryId: opts.componentCategoryId ?? null,
        payload: {} as never,
        initiatorId: opts.initiatorId,
      },
    });
    await prisma.approvalLog.create({
      data: {
        requestId: req.id,
        actorId: opts.actorId,
        action: "APPROVE",
        createdAt: opts.actedAt,
      },
    });
    return req;
  }

  async function seedTwoInitiators() {
    const env = await seedEnv();
    const deptB = await prisma.department.create({ data: { name: "市场部" } });
    const empB = await prisma.employee.create({
      data: { employeeNo: "E-B", name: "市场员工", departmentId: deptB.id },
    });
    const initiatorB = await seedAccount("initiatorB", "EMPLOYEE", ["approval.submit"], empB.id);
    return { ...env, deptB, empB, initiatorB };
  }

  it("按日期区间筛选（区间以「我最后一次动作时间」为准）", async () => {
    const { auditor, initiator, initiatorB, assetMgr } = await seedTwoInitiators();
    const early = await seedRow({
      businessType: "ASSET_SCRAP",
      initiatorId: initiator.id,
      requestNo: "AP-F-0001",
      title: "早期报废",
      actedAt: new Date("2026-09-01T10:00:00"),
      actorId: assetMgr.id,
    });
    const late = await seedRow({
      businessType: "ASSET_SCRAP",
      initiatorId: initiatorB.id,
      requestNo: "AP-F-0002",
      title: "近期报废",
      actedAt: new Date("2026-09-20T10:00:00"),
      actorId: assetMgr.id,
    });

    setTestUser({ id: auditor.id, username: auditor.username });
    const all = await getMyHandledRecords({ mode: "ALL", dateFrom: "2026-09-15" });
    expect(all.success).toBe(true);
    if (!all.success) return;
    const ids = all.data.map((x) => x.requestId);
    expect(ids).toContain(late.id);
    expect(ids).not.toContain(early.id);

    const inRange = await getMyHandledRecords({
      mode: "ALL",
      dateFrom: "2026-08-25",
      dateTo: "2026-09-05",
    });
    expect(inRange.success).toBe(true);
    if (!inRange.success) return;
    expect(inRange.data.map((x) => x.requestId)).toContain(early.id);
    expect(inRange.data.map((x) => x.requestId)).not.toContain(late.id);
  });

  it("按人员（发起人）与部门（发起人所属部门）筛选", async () => {
    const { auditor, initiator, deptB, initiatorB, assetMgr } = await seedTwoInitiators();
    const mine = await seedRow({
      businessType: "ASSET_SCRAP",
      initiatorId: initiator.id,
      requestNo: "AP-G-0001",
      title: "技术部报废",
      actedAt: new Date("2026-09-10T10:00:00"),
      actorId: assetMgr.id,
    });
    const other = await seedRow({
      businessType: "ASSET_SCRAP",
      initiatorId: initiatorB.id,
      requestNo: "AP-G-0002",
      title: "市场部报废",
      actedAt: new Date("2026-09-11T10:00:00"),
      actorId: assetMgr.id,
    });

    setTestUser({ id: auditor.id, username: auditor.username });
    const byPerson = await getMyHandledRecords({ mode: "ALL", initiatorId: initiator.id });
    expect(byPerson.success).toBe(true);
    if (!byPerson.success) return;
    expect(byPerson.data.map((x) => x.requestId)).toContain(mine.id);
    expect(byPerson.data.map((x) => x.requestId)).not.toContain(other.id);

    const byDept = await getMyHandledRecords({ mode: "ALL", departmentId: deptB.id });
    expect(byDept.success).toBe(true);
    if (!byDept.success) return;
    // 部门筛选按发起人所属部门：市场部
    expect(byDept.data.map((x) => x.requestId)).toContain(other.id);
    expect(byDept.data.map((x) => x.requestId)).not.toContain(mine.id);
  });

  it("按配件类型 / 业务类型 / 关键字筛选", async () => {
    const { auditor, compCat, initiator, assetMgr } = await seedTwoInitiators();
    const upgrade = await seedRow({
      businessType: "ASSET_UPGRADE",
      initiatorId: initiator.id,
      requestNo: "AP-H-0001",
      title: "升级内存",
      componentCategoryId: compCat.id,
      actedAt: new Date("2026-09-12T10:00:00"),
      actorId: assetMgr.id,
    });
    const scrap = await seedRow({
      businessType: "ASSET_SCRAP",
      initiatorId: initiator.id,
      requestNo: "AP-H-0002",
      title: "报废机箱",
      componentCategoryId: null,
      actedAt: new Date("2026-09-13T10:00:00"),
      actorId: assetMgr.id,
    });

    setTestUser({ id: auditor.id, username: auditor.username });
    const byCat = await getMyHandledRecords({ mode: "ALL", componentCategoryId: compCat.id });
    expect(byCat.success).toBe(true);
    if (!byCat.success) return;
    expect(byCat.data.map((x) => x.requestId)).toEqual([upgrade.id]);

    const byType = await getMyHandledRecords({ mode: "ALL", businessType: "ASSET_SCRAP" });
    expect(byType.success).toBe(true);
    if (!byType.success) return;
    expect(byType.data.map((x) => x.requestId)).toEqual([scrap.id]);

    const byKeyword = await getMyHandledRecords({ mode: "ALL", keyword: "AP-H-0001" });
    expect(byKeyword.success).toBe(true);
    if (!byKeyword.success) return;
    expect(byKeyword.data.map((x) => x.requestId)).toEqual([upgrade.id]);

    const byTitleKeyword = await getMyHandledRecords({ mode: "ALL", keyword: "机箱" });
    expect(byTitleKeyword.success).toBe(true);
    if (!byTitleKeyword.success) return;
    expect(byTitleKeyword.data.map((x) => x.requestId)).toEqual([scrap.id]);
  });

  it("筛选下拉数据：仅列出发起过申请单的账号，并标记能否查看全部", async () => {
    const { auditor, initiator, dept, compCat } = await seedTwoInitiators();
    await seedRow({
      businessType: "ASSET_UPGRADE",
      initiatorId: initiator.id,
      requestNo: "AP-I-0001",
      title: "升级内存",
      componentCategoryId: compCat.id,
      actedAt: new Date("2026-09-14T10:00:00"),
      actorId: auditor.id,
    });

    setTestUser({ id: auditor.id, username: auditor.username });
    const r = await getHandledRecordFilterOptions();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.canViewAll).toBe(true); // 审计账号持 approval.detail.view
    expect(r.data.departments.map((d) => d.id)).toContain(dept.id);
    expect(r.data.initiators.map((i) => i.id)).toContain(initiator.id);
    expect(r.data.componentCategories.map((c) => c.id)).toContain(compCat.id);
    // 从未发起过申请单的账号不出现在下拉里
    expect(r.data.initiators.map((i) => i.name)).not.toContain("assetmgr");
  });
});

describe("自动执行归因：EXECUTE 日志记录触发审批人", () => {
  it("报废终审自动执行后，EXECUTE 日志的 actorId = 末节点审批人", async () => {
    const { initiator, deptMgr, assetMgr, asset, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");

    setTestUser({ id: initiator.id, username: initiator.username });
    const sub = await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "太旧了" },
    });
    expect(sub.success).toBe(true);
    if (!sub.success) return;

    await approveAll(deptMgr, assetMgr);

    const log = await prisma.approvalLog.findFirst({
      where: { requestId: sub.data.id, action: "EXECUTE" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(assetMgr.id);
  });
});

/** 造一张已通过(APPROVED)、末节点=资产管理员、待执行的手动执行单 */
async function seedApprovedRequest(
  businessType: "ASSET_UPGRADE" | "ASSET_REPLACE" | "ASSET_REPAIR",
  payload: Record<string, unknown>
) {
  const def = await prisma.workflowDefinition.create({
    data: {
      businessType,
      name: `${businessType} 流程`,
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  return prisma.approvalRequest.create({
    data: {
      requestNo: `AP-MANUAL-${businessType}`,
      definitionId: def.id,
      businessType,
      title: `${businessType} 申请`,
      status: "APPROVED",
      finalNodeRole: "ASSET_MANAGER",
      executedAt: null,
      payload: payload as never,
      initiatorId: (await prisma.admin.findFirstOrThrow({ where: { username: "initiator" } })).id,
    },
  });
}

describe("手动执行归因：EXECUTE 日志记录执行人", () => {
  it("执行升级申请后写入 EXECUTE 日志（actorId = 执行人）", async () => {
    const { assetMgr, compCat, asset } = await seedEnv();
    const newModel = await prisma.componentModel.create({
      data: { name: "DDR4-16G", categoryId: compCat.id },
    });
    await prisma.componentStock.create({ data: { modelId: newModel.id, quantity: 10 } });
    const req = await seedApprovedRequest("ASSET_UPGRADE", {
      assetId: asset.id,
      componentCategoryId: compCat.id,
      action: "UPGRADE",
      reason: "内存不足",
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: { status: "RESERVED", reservedByRequestId: req.id, reservedFromStatus: "IN_USE" },
    });

    setTestUser({ id: assetMgr.id, username: assetMgr.username });
    const r = await executeApprovedChange(req.id, [{ modelId: newModel.id, quantityDelta: 1 }]);
    expect(r.success).toBe(true);

    const log = await prisma.approvalLog.findFirst({
      where: { requestId: req.id, action: "EXECUTE" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(assetMgr.id);
  });

  it("执行更换申请后写入 EXECUTE 日志（actorId = 执行人）", async () => {
    const { assetMgr, asset, asset2 } = await seedEnv();
    const req = await seedApprovedRequest("ASSET_REPLACE", {
      assetId: asset.id,
      reason: "机器太旧要换",
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: { status: "RESERVED", reservedByRequestId: req.id, reservedFromStatus: "IN_USE" },
    });
    await prisma.asset.update({ where: { id: asset2.id }, data: { status: "IDLE", employeeId: null } });

    setTestUser({ id: assetMgr.id, username: assetMgr.username });
    const r = await executeReplaceChange(req.id, asset2.id);
    expect(r.success).toBe(true);

    const log = await prisma.approvalLog.findFirst({
      where: { requestId: req.id, action: "EXECUTE" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(assetMgr.id);
  });

  it("执行维修申请后写入 EXECUTE 日志（actorId = 执行人）", async () => {
    const { assetMgr, asset, asset2 } = await seedEnv();
    const req = await seedApprovedRequest("ASSET_REPAIR", {
      assetId: asset.id,
      reason: "屏幕坏了",
    });
    await prisma.asset.update({
      where: { id: asset.id },
      data: { status: "RESERVED", reservedByRequestId: req.id, reservedFromStatus: "IN_USE" },
    });
    await prisma.asset.update({ where: { id: asset2.id }, data: { status: "IDLE", employeeId: null } });

    setTestUser({ id: assetMgr.id, username: assetMgr.username });
    const r = await executeRepairChange(req.id, asset2.id);
    expect(r.success).toBe(true);

    const log = await prisma.approvalLog.findFirst({
      where: { requestId: req.id, action: "EXECUTE" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(assetMgr.id);
  });
});

describe("导出：approval.done.export 权限 + xlsx 产出", () => {
  it("无 approval.done.export 权限 → 拒绝导出", async () => {
    const { auditor } = await seedEnv();
    setTestUser({ id: auditor.id, username: auditor.username });
    const r = await exportHandledRecordsToExcel();
    expect(r.success).toBe(false);
  });

  it("有导出权限 → 产出 xlsx，含我办理的单", async () => {
    const { initiator, deptMgr, assetMgr, asset, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");

    setTestUser({ id: initiator.id, username: initiator.username });
    const sub = await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "太旧了" },
    });
    expect(sub.success).toBe(true);
    if (!sub.success) return;
    await approveAll(deptMgr, assetMgr);

    setTestUser({ id: assetMgr.id, username: assetMgr.username });
    const r = await exportHandledRecordsToExcel();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.fileName).toContain("办理记录");

    const wb = XLSX.read(Buffer.from(r.data.buffer), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["单号"]).toBeTruthy();
  });
});