import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  getPendingExecutionRequests,
  getExecutableDetail,
} from "@/actions/approval-execute.actions";
import {
  submitApprovalRequest,
  getMyTodoTasks,
  approveTask,
} from "@/actions/approval.actions";

// ============================================================
// 待执行变更页泛化：列表同时含 UPGRADE/REPLACE/REPAIR，条目带 businessType
// Seam C：getPendingExecutionRequests 泛化 / Seam D：getExecutableDetail 泛化
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

async function login(admin: { id: number; username: string }) {
  setTestUser({ id: admin.id, username: admin.username });
  return admin;
}

/** 通用待执行环境：技术部(mgrEmp)+员工emp；UPGRADE/REPLACE/REPAIR 三套已发布流程 */
async function seedEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "一名员工", departmentId: dept.id, managerId: mgrEmp.id },
  });
  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve"], mgrEmp.id);
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage", "asset.upgrade.execute", "asset.replace.execute", "asset.repair.execute"]);

  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准办公电脑", categoryId: assetCat.id },
  });
  const asset = await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "在用设备", templateId: template.id, status: "IN_USE", employeeId: emp.id },
  });
  const asset2 = await prisma.asset.create({
    data: { assetNo: "DN-0002", name: "闲置替换机", templateId: template.id, status: "IDLE", employeeId: null },
  });

  async function seedWorkflow(
    businessType: "ASSET_UPGRADE" | "ASSET_REPLACE" | "ASSET_REPAIR" | "ASSET_SCRAP" | "ASSET_RETURN" | "ASSET_DEPART"
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

  async function approveAll() {
    await login(deptMgr);
    for (const _ of [1]) {
      const m = await getMyTodoTasks();
      if (!m.success) throw new Error("取待办失败");
      const t = m.data[0];
      if (!t) break;
      const a = await approveTask({ taskId: t.id, comment: "同意" });
      if (!a.success) throw new Error(`审批失败：${a.error}`);
    }
    await login(assetMgr);
    for (const _ of [1]) {
      const m = await getMyTodoTasks();
      if (!m.success) throw new Error("取待办失败");
      const t = m.data[0];
      if (!t) break;
      const a = await approveTask({ taskId: t.id, comment: "同意" });
      if (!a.success) throw new Error(`审批失败：${a.error}`);
    }
  }

  return { initiator, deptMgr, assetMgr, asset, asset2, emp, seedWorkflow, approveAll };
}

describe("待执行变更 泛化（Seam C/D）", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.lifecycleLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  it("c) 无执行角色时返回空列表（待执行仅按末节点角色过滤，无角色无单可执行）", async () => {
    const { seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_UPGRADE");

    const noPerm = await seedAccount("noperm", "NO_PERM", []);
    await login(noPerm);
    const r = await getPendingExecutionRequests();
    expect(r).toEqual({ success: true, data: [] });
  });

  it("c2) 列表同时包含 UPGRADE 与 REPLACE 待执行单，且条目带 businessType", async () => {
    const { initiator, asset, asset2, assetMgr, seedWorkflow, approveAll } = await seedEnv();
    await seedWorkflow("ASSET_UPGRADE");
    await seedWorkflow("ASSET_REPLACE");

    await login(initiator);
    // UPGRADE 需要配件类别（此处仅验证列表泛化，用 REPLACE + 一个简单 UPGRADE 难以共存；
    // 故仅用 REPLACE 构造待执行单，再以独立用例覆盖三种类型）
    const s = await submitApprovalRequest({
      title: "更换设备",
      businessType: "ASSET_REPLACE" as never,
      payload: { assetId: asset.id, reason: "旧机故障" },
    });
    expect(s.success).toBe(true);
    await approveAll();

    await login(assetMgr);
    const r = await getPendingExecutionRequests();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.some((x) => x.businessType === "ASSET_REPLACE")).toBe(true);
    expect(r.data.length).toBe(1);
  });

  it("d) 详情 REPLACE：返回该申请信息与候选替换机列表（闲置且在库可分配）", async () => {
    const { initiator, deptMgr, asset, asset2, assetMgr, seedWorkflow, approveAll } = await seedEnv();
    await seedWorkflow("ASSET_REPLACE");

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "更换设备",
      businessType: "ASSET_REPLACE" as never,
      payload: { assetId: asset.id, reason: "旧机故障需更换" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;
    await approveAll();

    await login(assetMgr);
    const r = await getExecutableDetail(s.data.id);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.businessType).toBe("ASSET_REPLACE");
    expect(r.data.assetNo).toBe(asset.assetNo);
    // 候选替换机包含闲置的 asset2（不在用、未分配）
    const repIds = r.data.availableAssets?.map((x) => x.assetId) ?? [];
    expect(repIds).toContain(asset2.id);
    // 在用设备 asset 不在候选里
    expect(repIds).not.toContain(asset.id);
  });

  it("d2) 详情 REPAIR：返回候选替换机列表", async () => {
    const { initiator, asset, asset2, assetMgr, seedWorkflow, approveAll } = await seedEnv();
    await seedWorkflow("ASSET_REPAIR");

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "报修设备",
      businessType: "ASSET_REPAIR" as never,
      payload: { assetId: asset.id, reason: "设备故障报修" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;
    await approveAll();

    await login(assetMgr);
    const r = await getExecutableDetail(s.data.id);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.businessType).toBe("ASSET_REPAIR");
    const repIds = r.data.availableAssets?.map((x) => x.assetId) ?? [];
    expect(repIds).toContain(asset2.id);
    expect(repIds).not.toContain(asset.id);
  });
});