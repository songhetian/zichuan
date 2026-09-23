import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  submitApprovalRequest,
  getMyTodoTasks,
  approveTask,
} from "@/actions/approval.actions";

// ============================================================
// 退回申请（ASSET_RETURN）：终审通过后自动将设备置「闲置」归还
// Seam：S1 提交分发 → S2 终审自动执行
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

/** 标准退回环境：技术部（主管 mgrEmp）员工 emp；ASSET_RETURN 已发布流程（部门主管→资产管理员）；在用设备 */
async function seedReturnEnv() {
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

  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_RETURN",
      name: "退回设备流程",
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

  return { initiator, deptMgr, assetMgr, asset, emp };
}

/** 帮当前用户审批下一张待办（逐节点推进） */
async function approveNext() {
  const mine = await getMyTodoTasks();
  if (!mine.success) throw new Error("取待办失败");
  const task = mine.data[0];
  if (!task) throw new Error("无待办");
  const a = await approveTask({ taskId: task.id, comment: "同意" });
  if (!a.success) throw new Error(`审批失败：${a.error}`);
  return task;
}

describe("退回申请 ASSET_RETURN：提交 → 逐节点通过 → 自动归还闲置", () => {
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

  it("终审通过 → 设备自动置闲置、释放预占、写 RETURNED 日志、无手动执行态", async () => {
    const { initiator, deptMgr, assetMgr, asset } = await seedReturnEnv();

    // 提交退回申请：只看本人名下设备
    await login(initiator);
    const s = await submitApprovalRequest({
      title: "申请退回电脑",
      businessType: "ASSET_RETURN" as never,
      payload: { assetId: asset.id, reason: "不再需要该设备" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;

    // 提交后设备被预占
    const reserved = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reserved.status).toBe("RESERVED");

    // 部门主管通过
    await login(deptMgr);
    await approveNext();
    // 资产管理员通过（末节点）→ 自动执行
    await login(assetMgr);
    await approveNext();

    // 申请单终态 APPROVED + 无 finalNodeRole（自动型，不进待执行）+ EXECUTE 日志
    const full = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: s.data.id },
      include: { logs: true },
    });
    expect(full.status).toBe("APPROVED");
    expect(full.finalNodeRole).toBeNull();
    expect(full.logs.map((l) => l.action)).toContain("EXECUTE");

    // 设备自动置「闲置」+ 释放预占 + 写 RETURNED 生命周期日志
    const assetAfter = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(assetAfter.status).toBe("IDLE");
    expect(assetAfter.reservedByRequestId).toBeNull();
    expect(assetAfter.reservedFromStatus).toBeNull();
    expect(assetAfter.employeeId).toBeNull();

    const life = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: asset.id, action: "RETURNED" },
    });
    expect(life.requestId).toBe(full.id);
    expect(life.fromStatus).toBe("RESERVED");
    expect(life.toStatus).toBe("IDLE");
  });

  it("普通员工只能提交本人名下设备的退回申请", async () => {
    const { initiator, deptMgr, asset, emp } = await seedReturnEnv();

    // 另一名员工（无设备）尝试退回他人设备 → 拒绝
    const otherEmp = await prisma.employee.create({
      data: { employeeNo: "E-OTHER", name: "其他员工", departmentId: (await prisma.employee.findUniqueOrThrow({ where: { id: emp.id }, select: { departmentId: true } })).departmentId },
    });
    const otherInitiator = await seedAccount("other", "EMPLOYEE", ["approval.submit"], otherEmp.id);
    await login(otherInitiator);
    const r = await submitApprovalRequest({
      title: "越权退回",
      businessType: "ASSET_RETURN" as never,
      payload: { assetId: asset.id, reason: "帮别人退" },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("本人名下");
  });
});