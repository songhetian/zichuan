import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { submitApprovalRequest, getMyTodoTasks, approveTask } from "@/actions/approval.actions";
import { confirmHandover } from "@/actions/approval-execute.actions";

// ============================================================
// 员工离职（ASSET_DEPART）：提交 → 逐节点通过 → 终审生成交接单(待对账)
// → 资产管理员对账确认 → 自动回收离职员工名下全部设备
// Seam：S1 提交分发 / S2 终审生成交接单 / S3 对账确认回收
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

/** 标准离职环境：离职员工 emp 名下 2 台设备；ASSET_DEPART 流程（部门主管→资产管理员） */
async function seedDepartEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "离职员工", departmentId: dept.id, managerId: mgrEmp.id },
  });

  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve"], mgrEmp.id);
  // 资产管理员：审批 + 离职交接对账权限
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
    "approval.approve",
    "asset.manage",
    "asset.depart.view",
  ]);

  await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_DEPART",
      name: "离职流程",
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
  const a1 = await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "员工电脑1", templateId: template.id, status: "IN_USE", employeeId: emp.id },
  });
  const a2 = await prisma.asset.create({
    data: { assetNo: "DN-0002", name: "员工电脑2", templateId: template.id, status: "IN_USE", employeeId: emp.id },
  });

  return { initiator, deptMgr, assetMgr, emp, a1, a2 };
}

async function approveNext() {
  const mine = await getMyTodoTasks();
  if (!mine.success) throw new Error("取待办失败");
  const task = mine.data[0];
  if (!task) throw new Error("无待办");
  const a = await approveTask({ taskId: task.id, comment: "同意" });
  if (!a.success) throw new Error(`审批失败：${a.error}`);
}

describe("离职 ASSET_DEPART：提交 → 终审生成交接单 → 对账确认回收", () => {
  beforeEach(async () => {
    await prisma.handoverOrder.deleteMany();
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

  it("提交离职 → 逐节点通过 → 终审生成 PENDING 交接单(含设备快照)、设备未被回收", async () => {
    const { initiator, deptMgr, assetMgr, emp, a1, a2 } = await seedDepartEnv();

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "员工离职交接",
      businessType: "ASSET_DEPART" as never,
      payload: { targetEmployeeId: emp.id, reason: "个人原因离职" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;

    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    // 终审通过 + 生成交接单 + EXECUTE 日志
    const full = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: s.data.id },
      include: { logs: true },
    });
    expect(full.status).toBe("APPROVED");
    expect(full.logs.map((l) => l.action)).toContain("EXECUTE");

    const order = await prisma.handoverOrder.findUniqueOrThrow({
      where: { requestId: full.id },
    });
    expect(order.status).toBe("PENDING");
    expect(order.employeeId).toBe(emp.id);
    // 快照含离职员工名下 2 台设备
    const snapshot = order.assetSnapshot as { assetId: number }[];
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map((x) => x.assetId)).toEqual(expect.arrayContaining([a1.id, a2.id]));

    // 设备未被回收（仍归属离职员工）
    const a1After = await prisma.asset.findUniqueOrThrow({ where: { id: a1.id } });
    expect(a1After.employeeId).toBe(emp.id);
    expect(a1After.status).toBe("IN_USE");
  });

  it("对账确认 → 自动回收离职员工全部设备置闲置、释放人员、写 RETURNED 日志、单置已回收", async () => {
    const { initiator, deptMgr, assetMgr, emp, a1, a2 } = await seedDepartEnv();

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "员工离职交接",
      businessType: "ASSET_DEPART" as never,
      payload: { targetEmployeeId: emp.id, reason: "个人原因离职" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;
    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    const order = await prisma.handoverOrder.findUniqueOrThrow({ where: { requestId: s.data.id } });
    const c = await confirmHandover(order.id, "核对无误");
    expect(c.success).toBe(true);

    // 两台设备全部回收
    const [a1After, a2After] = await Promise.all([
      prisma.asset.findUniqueOrThrow({ where: { id: a1.id } }),
      prisma.asset.findUniqueOrThrow({ where: { id: a2.id } }),
    ]);
    expect(a1After.status).toBe("IDLE");
    expect(a1After.employeeId).toBeNull();
    expect(a2After.status).toBe("IDLE");
    expect(a2After.employeeId).toBeNull();

    // 每台写 RETURNED 生命周期日志（requestId 追溯）
    const logs = await prisma.lifecycleLog.findMany({
      where: { requestId: s.data.id, action: "RETURNED" },
    });
    expect(logs).toHaveLength(2);

    // 交接单已回收
    const orderAfter = await prisma.handoverOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfter.status).toBe("COLLECTED");
    expect(orderAfter.confirmedAt).not.toBeNull();
    expect(orderAfter.collectedAt).not.toBeNull();
  });

  it("已回收后再次确认 → 拒绝（幂等）", async () => {
    const { initiator, deptMgr, assetMgr, emp } = await seedDepartEnv();
    await login(initiator);
    const s = await submitApprovalRequest({
      title: "员工离职交接",
      businessType: "ASSET_DEPART" as never,
      payload: { targetEmployeeId: emp.id, reason: "个人原因离职" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;
    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    const order = await prisma.handoverOrder.findUniqueOrThrow({ where: { requestId: s.data.id } });
    await confirmHandover(order.id);
    const r = await confirmHandover(order.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("已回收");
  });
});