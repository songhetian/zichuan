import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  executeApprovedChange,
  getPendingExecutionRequests,
  getExecutableDetail,
  PendingExecutionRequest,
} from "@/actions/approval-execute.actions";

// ============================================================
// 资产管理员「待执行变更」：手动执行升级/降级配件
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

async function seedAccount(username: string, roleKey: string, permissions: string[]) {
  const role = await seedRole(roleKey, permissions);
  return prisma.admin.create({ data: { username, password: "x", roleId: role.id } });
}

/** 建一个已通过(APPROVED)、末节点=资产管理员的升级单 + 环境 */
async function seedApprovedUpgrade(opts?: {
  finalNodeRole?: string | null;
  status?: string;
  executedAt?: Date | null;
}) {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id },
  });
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage"]);

  const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const oldModel = await prisma.componentModel.create({
    data: { name: "DDR4-8G", categoryId: compCat.id },
  });
  const newModel = await prisma.componentModel.create({
    data: { name: "DDR4-16G", categoryId: compCat.id },
  });
  await prisma.componentStock.create({ data: { modelId: newModel.id, quantity: 10 } });

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

  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_UPGRADE",
      name: "升级配件流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  const request = await prisma.approvalRequest.create({
    data: {
      requestNo: "AP-TEST-0001",
      definitionId: def.id,
      businessType: "ASSET_UPGRADE",
      title: "申请升级内存",
      status: (opts?.status ?? "APPROVED") as never,
      finalNodeRole: opts?.finalNodeRole === undefined ? "ASSET_MANAGER" : opts.finalNodeRole,
      executedAt: opts?.executedAt ?? null,
      payload: {
        assetId: asset.id,
        componentCategoryId: compCat.id,
        action: "UPGRADE",
        reason: "内存不足，申请升级",
      },
      initiatorId: assetMgr.id,
    },
  });

  // 模拟发起时的资产预占
  await prisma.asset.update({
    where: { id: asset.id },
    data: { status: "RESERVED", reservedByRequestId: request.id, reservedFromStatus: "IN_USE" },
  });

  return { assetMgr, asset, compCat, oldModel, newModel, request };
}

async function login(a: { id: number; username: string }) {
  setTestUser({ id: a.id, username: a.username });
}

describe("待执行变更：executeApprovedChange / 列表 / 详情", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.approvalTask.deleteMany();
    await prisma.lifecycleLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.assetComponent.deleteMany();
    await prisma.componentStockLog.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.componentStock.deleteMany();
    await prisma.componentModel.deleteMany();
    await prisma.componentCategory.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.workflowEdge.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  it("执行：添新型号+减旧型号 → 库存增减/流水/日志/executedAt/释放预占", async () => {
    const org = await seedApprovedUpgrade();
    await login(org.assetMgr);

    const r = await executeApprovedChange(org.request.id, [
      { modelId: org.newModel.id, quantityDelta: 1 },
      { modelId: org.oldModel.id, quantityDelta: -1 },
    ]);
    expect(r.success).toBe(true);
    if (!r.success) return;

    // 设备配件：旧型号移除、新型号加入
    const oldComp = await prisma.assetComponent.findUnique({
      where: { assetId_modelId: { assetId: org.asset.id, modelId: org.oldModel.id } },
    });
    expect(oldComp).toBeNull();
    const newComp = await prisma.assetComponent.findUniqueOrThrow({
      where: { assetId_modelId: { assetId: org.asset.id, modelId: org.newModel.id } },
    });
    expect(newComp.quantity).toBe(1);

    // 库存：新型号 10→9；旧型号无库存则回补 1
    const newStock = await prisma.componentStock.findUniqueOrThrow({ where: { modelId: org.newModel.id } });
    expect(newStock.quantity).toBe(9);
    const oldStock = await prisma.componentStock.findUniqueOrThrow({ where: { modelId: org.oldModel.id } });
    expect(oldStock.quantity).toBe(1);

    // 流水：UPGRADE_USE(新型号出库) + UPGRADE_RETURN(旧型号回库)
    const logs = await prisma.componentStockLog.findMany({
      where: { modelId: { in: [org.oldModel.id, org.newModel.id] } },
      orderBy: { id: "asc" },
    });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.type)).toEqual(expect.arrayContaining(["UPGRADE_USE", "UPGRADE_RETURN"]));

    // 生命周期日志：requestId 追溯 + operator 为账号名
    const lifecycle = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: org.asset.id, action: "UPGRADED" },
    });
    expect(lifecycle.requestId).toBe(org.request.id);
    expect(lifecycle.operator).toBe("assetmgr");

    // 申请单标记已执行 + 资产释放
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: org.request.id } });
    expect(req.executedAt).not.toBeNull();
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(asset.status).toBe("IN_USE");
    expect(asset.reservedByRequestId).toBeNull();
    expect(asset.reservedFromStatus).toBeNull();
  });

  it("调整的型号不属于该配件品类 → 拒绝执行", async () => {
    const org = await seedApprovedUpgrade();
    await login(org.assetMgr);

    const otherCat = await prisma.componentCategory.create({ data: { name: "硬盘" } });
    const foreignModel = await prisma.componentModel.create({
      data: { name: "NVMe-1T", categoryId: otherCat.id },
    });
    const r = await executeApprovedChange(org.request.id, [
      { modelId: foreignModel.id, quantityDelta: 1 },
    ]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不属于该配件类别");
  });

  it("已执行后再次执行 → 拒绝（幂等）", async () => {
    const org = await seedApprovedUpgrade();
    await login(org.assetMgr);
    await executeApprovedChange(org.request.id, [{ modelId: org.newModel.id, quantityDelta: 1 }]);
    const r = await executeApprovedChange(org.request.id, [{ modelId: org.newModel.id, quantityDelta: 1 }]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });

  it("末节点非资产管理员 → 不进列表、执行被拒", async () => {
    const org = await seedApprovedUpgrade({ finalNodeRole: "DEPT_MANAGER" });
    await login(org.assetMgr);

    const list = await getPendingExecutionRequests();
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.some((p) => p.id === org.request.id)).toBe(false);

    const r = await executeApprovedChange(org.request.id, [{ modelId: org.newModel.id, quantityDelta: 1 }]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });

  it("非末节点角色账号（EMPLOYEE）→ 拒绝执行", async () => {
    const org = await seedApprovedUpgrade();
    const staff = await seedAccount("staff", "EMPLOYEE", ["approval.submit"]);
    await login(staff);

    const r = await executeApprovedChange(org.request.id, [{ modelId: org.newModel.id, quantityDelta: 1 }]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });

  it("非 APPROVED（PENDING）→ 执行被拒", async () => {
    const org = await seedApprovedUpgrade({ status: "PENDING" });
    await login(org.assetMgr);
    const r = await executeApprovedChange(org.request.id, [{ modelId: org.newModel.id, quantityDelta: 1 }]);
    expect(r.success).toBe(false);
  });

  it("列表与详情：返回待执行单、设备当前配件与可选型号", async () => {
    const org = await seedApprovedUpgrade();
    await login(org.assetMgr);

    const list = await getPendingExecutionRequests();
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data).toHaveLength(1);
    const item = list.data[0] as PendingExecutionRequest;
    expect(item.assetId).toBe(org.asset.id);
    expect(item.categoryId).toBe(org.compCat.id);
    expect(item.categoryName).toBe("内存");
    expect(item.action).toBe("UPGRADE");

    const detail = await getExecutableDetail(org.request.id);
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(detail.data.currentComponents!.map((c) => c.modelId)).toContain(org.oldModel.id);
    const modelIds = detail.data.categoryModels!.map((m) => m.modelId);
    expect(modelIds).toEqual(expect.arrayContaining([org.oldModel.id, org.newModel.id]));
  });
});