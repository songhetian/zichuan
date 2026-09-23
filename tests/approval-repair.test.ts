import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { executeRepairChange } from "@/actions/approval-execute.actions";

// ============================================================
// 资产管理员「待执行变更」：手动执行设备维修（ASSET_REPAIR）
// 执行动作：旧机置维修中(IN_MAINTENANCE) + 分配替换机给申请人，写生命周期日志，幂等
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

/** 建一个已通过(APPROVED)、末节点=资产管理员的维修单 + 旧机/替换机环境 */
async function seedApprovedRepair(opts?: {
  finalNodeRole?: string | null;
  status?: string;
  executedAt?: Date | null;
}) {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id },
  });
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage"]);

  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准办公电脑", categoryId: assetCat.id },
  });

  const oldAsset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "送修设备",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });
  const replacement = await prisma.asset.create({
    data: {
      assetNo: "DN-0002",
      name: "替换机",
      templateId: template.id,
      status: "IN_STOCK",
      employeeId: null,
    },
  });

  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_REPAIR",
      name: "设备维修流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  const request = await prisma.approvalRequest.create({
    data: {
      requestNo: "AP-REPAIR-0001",
      definitionId: def.id,
      businessType: "ASSET_REPAIR",
      title: "申请维修电脑",
      status: (opts?.status ?? "APPROVED") as never,
      finalNodeRole: opts?.finalNodeRole === undefined ? "ASSET_MANAGER" : opts.finalNodeRole,
      executedAt: opts?.executedAt ?? null,
      payload: { assetId: oldAsset.id, reason: "设备故障，需送修" },
      initiatorId: assetMgr.id,
    },
  });

  await prisma.asset.update({
    where: { id: oldAsset.id },
    data: { status: "RESERVED", reservedByRequestId: request.id, reservedFromStatus: "IN_USE" },
  });

  return { assetMgr, emp, oldAsset, replacement, request };
}

async function login(a: { id: number; username: string }) {
  setTestUser({ id: a.id, username: a.username });
}

describe("待执行变更：executeRepairChange（执行维修）", () => {
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

  it("执行：旧机置维修中、替换机分配改 IN_USE 给申请人，写 MAINTENANCE_START/ALLOCATED 日志，executedAt 幂等释放预占", async () => {
    const org = await seedApprovedRepair();
    await login(org.assetMgr);

    const r = await executeRepairChange(org.request.id, org.replacement.id);
    expect(r.success).toBe(true);

    const oldAfter = await prisma.asset.findUniqueOrThrow({ where: { id: org.oldAsset.id } });
    expect(oldAfter.status).toBe("IN_MAINTENANCE");
    expect(oldAfter.reservedByRequestId).toBeNull();
    expect(oldAfter.reservedFromStatus).toBeNull();

    const repAfter = await prisma.asset.findUniqueOrThrow({ where: { id: org.replacement.id } });
    expect(repAfter.status).toBe("IN_USE");
    expect(repAfter.employeeId).toBe(org.emp.id);

    const mstart = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: org.oldAsset.id, action: "MAINTENANCE_START" },
    });
    expect(mstart.requestId).toBe(org.request.id);
    expect(mstart.operator).toBe("assetmgr");
    const alloc = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: org.replacement.id, action: "ALLOCATED" },
    });
    expect(alloc.requestId).toBe(org.request.id);

    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: org.request.id } });
    expect(req.executedAt).not.toBeNull();
  });

  it("已执行后再次执行 → 拒绝（幂等）", async () => {
    const org = await seedApprovedRepair();
    await login(org.assetMgr);
    await executeRepairChange(org.request.id, org.replacement.id);

    const r = await executeRepairChange(org.request.id, org.replacement.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });

  it("替换机不是闲置/库存可用 → 拒绝执行", async () => {
    const org = await seedApprovedRepair();
    const occupied = await prisma.asset.create({
      data: {
        assetNo: "DN-9999",
        name: "他人电脑",
        templateId: org.oldAsset.templateId!,
        status: "IN_USE",
        employeeId: null,
      },
    });
    await login(org.assetMgr);
    const r = await executeRepairChange(org.request.id, occupied.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不可用");
  });
});