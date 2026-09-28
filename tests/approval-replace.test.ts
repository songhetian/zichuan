import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { executeReplaceChange } from "@/actions/approval-execute.actions";

// ============================================================
// 资产管理员「待执行变更」：手动执行设备更换（ASSET_REPLACE）
// 执行动作：回收旧机置闲置归还 + 分配新机给申请人，写生命周期日志，幂等
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

/** 建一个已通过(APPROVED)、末节点=资产管理员的更换单 + 旧机/新机环境 */
async function seedApprovedReplace(opts?: {
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

  // 旧机：在用、已分配给申请人；提交申请后进入预占(RESERVED)
  const oldAsset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "申请员工的旧电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });
  // 新机：库存可用、未分配
  const newAsset = await prisma.asset.create({
    data: {
      assetNo: "DN-0002",
      name: "待分配的备用电脑",
      templateId: template.id,
      status: "IDLE",
      employeeId: null,
    },
  });

  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_REPLACE",
      name: "设备更换流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  const request = await prisma.approvalRequest.create({
    data: {
      requestNo: "AP-REPLACE-0001",
      definitionId: def.id,
      businessType: "ASSET_REPLACE",
      title: "申请更换电脑",
      status: (opts?.status ?? "APPROVED") as never,
      finalNodeRole: opts?.finalNodeRole === undefined ? "ASSET_MANAGER" : opts.finalNodeRole,
      executedAt: opts?.executedAt ?? null,
      payload: { assetId: oldAsset.id, reason: "旧机故障，申请更换" },
      initiatorId: assetMgr.id,
    },
  });

  // 模拟发起时的旧机预占
  await prisma.asset.update({
    where: { id: oldAsset.id },
    data: { status: "RESERVED", reservedByRequestId: request.id, reservedFromStatus: "IN_USE" },
  });

  return { assetMgr, emp, oldAsset, newAsset, request };
}

async function login(a: { id: number; username: string }) {
  setTestUser({ id: a.id, username: a.username });
}

describe("待执行变更：executeReplaceChange（执行更换）", () => {
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

  it("执行：旧机回收置闲置归还、新机分配改 IN_USE 给申请人，写 REPLACED/ALLOCATED 日志，executedAt 幂等释放预占", async () => {
    const org = await seedApprovedReplace();
    await login(org.assetMgr);

    const r = await executeReplaceChange(org.request.id, org.newAsset.id);
    expect(r.success).toBe(true);

    // 旧机：闲置、归还人员、释放预占
    const oldAfter = await prisma.asset.findUniqueOrThrow({ where: { id: org.oldAsset.id } });
    expect(oldAfter.status).toBe("IDLE");
    expect(oldAfter.employeeId).toBeNull();
    expect(oldAfter.reservedByRequestId).toBeNull();
    expect(oldAfter.reservedFromStatus).toBeNull();

    // 新机：分配可申请人，状态在用
    const newAfter = await prisma.asset.findUniqueOrThrow({ where: { id: org.newAsset.id } });
    expect(newAfter.status).toBe("IN_USE");
    expect(newAfter.employeeId).toBe(org.emp.id);

    // 生命周期日志：旧机 REPLACED + 新机 ALLOCATED（requestId 追溯 + operator 账号名）
    const replaced = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: org.oldAsset.id, action: "REPLACED" },
    });
    expect(replaced.requestId).toBe(org.request.id);
    expect(replaced.operator).toBe("assetmgr");
    const allocated = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: org.newAsset.id, action: "ALLOCATED" },
    });
    expect(allocated.requestId).toBe(org.request.id);

    // 申请单标记已执行
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: org.request.id } });
    expect(req.executedAt).not.toBeNull();
  });

  it("原机无使用人时，新机回闲置池（不得出现「在用但无人」的矛盾态）", async () => {
    const org = await seedApprovedReplace();
    // 模拟管理员对闲置旧机发起更换：旧机无归属
    await prisma.asset.update({
      where: { id: org.oldAsset.id },
      data: { employeeId: null, reservedFromStatus: "IDLE" },
    });
    await login(org.assetMgr);

    const r = await executeReplaceChange(org.request.id, org.newAsset.id);
    expect(r.success).toBe(true);

    const newAfter = await prisma.asset.findUniqueOrThrow({ where: { id: org.newAsset.id } });
    expect(newAfter.status).toBe("IDLE");
    expect(newAfter.employeeId).toBeNull();
    expect(newAfter.name).toBe("标准办公电脑");
  });

  it("已执行后再次执行 → 拒绝（幂等）", async () => {
    const org = await seedApprovedReplace();
    await login(org.assetMgr);
    await executeReplaceChange(org.request.id, org.newAsset.id);

    const r = await executeReplaceChange(org.request.id, org.newAsset.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });

  it("新机不是闲置/库存可用 → 拒绝执行", async () => {
    const org = await seedApprovedReplace();
    // 另一台在用设备作为新机（已被他人占用）
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

    const r = await executeReplaceChange(org.request.id, occupied.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不可用");
  });

  it("非末节点角色账号 → 拒绝执行", async () => {
    const org = await seedApprovedReplace();
    const staff = await seedAccount("staff", "EMPLOYEE", ["approval.submit"]);
    await login(staff);

    const r = await executeReplaceChange(org.request.id, org.newAsset.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });

  it("末节点角色之外的角色（UPGRADE_ONLY）→ 拒绝执行更换", async () => {
    const org = await seedApprovedReplace();
    // 更换单末节点角色为 ASSET_MANAGER，该账号角色 UPGRADE_ONLY → 角色不匹配被拒
    const upgradeOnly = await seedAccount("upgradeonly", "UPGRADE_ONLY", []);
    await login(upgradeOnly);

    const r = await executeReplaceChange(org.request.id, org.newAsset.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("不满足执行条件或已执行");
  });
});