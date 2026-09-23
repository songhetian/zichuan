import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { submitApprovalRequest, getMyTodoTasks, approveTask } from "@/actions/approval.actions";

// ============================================================
// 设备维修申请（ASSET_REPAIR）：提交分发 → 终审手动归位（待执行）
// Seam：S1 提交分发 → S2 终审（末节点=资产管理员，进入待执行，不自动执行）
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
  return prisma.admin.create({ data: { username, password: "x", roleId: role.id, employeeId } });
}

async function login(admin: { id: number; username: string }) {
  setTestUser({ id: admin.id, username: admin.username });
  return admin;
}

async function seedRepairEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id, managerId: mgrEmp.id },
  });

  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve"], mgrEmp.id);
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage"]);

  await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_REPAIR",
      name: "维修设备流程",
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

  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({ data: { name: "标准办公电脑", categoryId: assetCat.id } });
  const asset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "申请员工的电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });

  return { initiator, deptMgr, assetMgr, asset, emp };
}

async function approveNext() {
  const mine = await getMyTodoTasks();
  if (!mine.success) throw new Error("取待办失败");
  const task = mine.data[0];
  if (!task) throw new Error("无待办");
  const a = await approveTask({ taskId: task.id, comment: "同意" });
  if (!a.success) throw new Error(`审批失败：${a.error}`);
}

describe("维修申请 ASSET_REPAIR：提交 → 逐节点通过 → 终审手动归位", () => {
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

  it("提交维修 → 逐节点通过 → 终审后 finalNodeRole=ASSET_MANAGER、设备保持预占、不自动执行", async () => {
    const { initiator, deptMgr, assetMgr, asset } = await seedRepairEnv();

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "申请维修电脑",
      businessType: "ASSET_REPAIR" as never,
      payload: { assetId: asset.id, reason: "设备故障，申请维修" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;

    const reserved = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reserved.status).toBe("RESERVED");

    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    const full = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: s.data.id },
      include: { logs: true },
    });
    expect(full.status).toBe("APPROVED");
    expect(full.finalNodeRole).toBe("ASSET_MANAGER");
    expect(full.logs.map((l) => l.action)).not.toContain("EXECUTE");

    const assetAfter = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(assetAfter.status).toBe("RESERVED");
    expect(assetAfter.reservedByRequestId).toBe(full.id);
  });

  it("普通员工只能提交本人名下设备的维修申请", async () => {
    const { initiator, asset, emp } = await seedRepairEnv();
    const otherEmp = await prisma.employee.create({
      data: {
        employeeNo: "E-OTHER",
        name: "其他员工",
        departmentId: emp.departmentId,
      },
    });
    const otherInitiator = await seedAccount("other", "EMPLOYEE", ["approval.submit"], otherEmp.id);
    await login(otherInitiator);
    const r = await submitApprovalRequest({
      title: "越权维修",
      businessType: "ASSET_REPAIR" as never,
      payload: { assetId: asset.id, reason: "帮别人修" },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("本人名下");
  });
});