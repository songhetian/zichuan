import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  getApprovalRequestById,
  submitApprovalRequest,
  getMyTodoTasks,
  approveTask,
} from "@/actions/approval.actions";
import { getDepartureCheckInfo, getDepartureHandover } from "@/actions/approval-depart.actions";

// ============================================================
// 离职审批「核对设备」上下文
//
// 背景：离职流程 = 部门主管审批 → 资产管理员审批，两个节点的审批人都要看
//       「这名员工名下有哪些设备」才能决定是否通过。
//       但这两个角色都不持有 employee.view，不能直接放开 /employees/[id]。
//       所以核对视图的数据出口单独做，授权口径 = 「你是这张单的相关人」
//       （与 getApprovalRequestById 的数据范围完全同源）。
//
// Seam：
//   S1 getDepartureCheckInfo —— 审批人读离职员工身份 + 名下全部设备
//   S2 getDepartureHandover  —— 终审后读交接单（对账回收卡片用）
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

async function seedAccount(
  username: string,
  roleKey: string,
  permissions: string[],
  employeeId?: number
) {
  const role = await seedRole(roleKey, permissions);
  return prisma.admin.create({
    data: { username, password: "x", roleId: role.id, employeeId },
  });
}

async function login(admin: { id: number; username: string }) {
  setTestUser({ id: admin.id, username: admin.username });
  return admin;
}

/**
 * 标准离职环境：技术部主管 mgr（**只有 approval.approve，没有 employee.view**）
 * 名下有一个下属 emp（另有 2 台在用的设备），另有一个外部门同事 outsider。
 */
async function seedDepartEnv() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: {
      employeeNo: "E-EMP",
      name: "离职员工",
      departmentId: dept.id,
      managerId: mgrEmp.id,
      phone: "13800000000",
      email: "emp@example.com",
    },
  });

  const otherDept = await prisma.department.create({ data: { name: "市场部" } });
  const outsiderEmp = await prisma.employee.create({
    data: { employeeNo: "E-OUT", name: "无关同事", departmentId: otherDept.id },
  });

  // 关键：部门主管只有审批权，刻意不给 employee.view
  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve"], mgrEmp.id);
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", [
    "approval.approve",
    "asset.manage",
    "asset.depart.view",
  ]);
  const outsider = await seedAccount("outsider", "EMPLOYEE", ["approval.submit"], outsiderEmp.id);

  await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_DEPART",
      name: "离职流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      nodes: {
        create: [
          {
            nodeKey: "n1",
            name: "部门主管审批",
            type: "APPROVAL",
            sortOrder: 0,
            assigneeType: "DEPT_MANAGER",
          },
          {
            nodeKey: "n2",
            name: "资产管理员审批",
            type: "APPROVAL",
            sortOrder: 1,
            assigneeType: "ROLE",
            assigneeRole: "ASSET_MANAGER",
          },
        ],
      },
    },
  });

  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准办公电脑", categoryId: assetCat.id },
  });
  const a1 = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "员工电脑1",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });
  const a2 = await prisma.asset.create({
    data: {
      assetNo: "DN-0002",
      name: "员工电脑2",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });

  return { initiator, deptMgr, assetMgr, outsider, emp, a1, a2 };
}

async function submitDepart(initiator: { id: number; username: string }, empId: number) {
  await login(initiator);
  const s = await submitApprovalRequest({
    title: "员工离职交接",
    businessType: "ASSET_DEPART" as never,
    payload: { targetEmployeeId: empId, reason: "个人原因离职" },
  });
  if (!s.success) throw new Error(`提交失败：${s.error}`);
  return s.data.id;
}

async function approveNext() {
  const mine = await getMyTodoTasks();
  if (!mine.success) throw new Error("取待办失败");
  const task = mine.data[0];
  if (!task) throw new Error("无待办");
  const a = await approveTask({ taskId: task.id, comment: "同意" });
  if (!a.success) throw new Error(`审批失败：${a.error}`);
}

async function resetDb() {
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
}

describe("离职核对上下文 getDepartureCheckInfo", () => {
  beforeEach(resetDb);

  afterEach(() => setTestUser(null));

  it("部门主管（无 employee.view）在审批前能读到离职员工身份与名下全部设备", async () => {
    const { initiator, deptMgr, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);

    await login(deptMgr);
    const res = await getDepartureCheckInfo(requestId);

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.employee.name).toBe("离职员工");
    expect(res.data.employee.employeeNo).toBe("E-EMP");
    expect(res.data.employee.departmentName).toBe("技术部");
    expect(res.data.employee.phone).toBe("13800000000");
    expect(res.data.assets.map((a) => a.assetNo).sort()).toEqual(["DN-0001", "DN-0002"]);
    expect(res.data.assets.every((a) => a.status === "IN_USE")).toBe(true);
  });

  it("资产管理员（后续节点，同样无 employee.view）也能读到同一份核对上下文", async () => {
    const { initiator, deptMgr, assetMgr, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);

    await login(deptMgr);
    await approveNext(); // 轮到资产管理员节点

    await login(assetMgr);
    const res = await getDepartureCheckInfo(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.employee.id).toBe(emp.id);
    expect(res.data.assets).toHaveLength(2);
  });

  it("与本单无关的账号读到的是「不存在」，不泄露单据是否存在", async () => {
    const { initiator, outsider, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);

    await login(outsider);
    const res = await getDepartureCheckInfo(requestId);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain("不存在");
  });

  it("对非离职单调用直接拒绝，避免被当成通用的员工设备接口", async () => {
    const { initiator, a1 } = await seedDepartEnv();

    // 另起一张「退回」单（同一个人是发起人 = 单对他是可见的）
    await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_RETURN",
        name: "退回流程",
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        nodes: {
          create: [
            {
              nodeKey: "n1",
              name: "资产管理员审批",
              type: "APPROVAL",
              sortOrder: 0,
              assigneeType: "ROLE",
              assigneeRole: "ASSET_MANAGER",
            },
          ],
        },
      },
    });

    await login(initiator);
    const s = await submitApprovalRequest({
      title: "退回设备",
      businessType: "ASSET_RETURN" as never,
      payload: { assetId: a1.id, reason: "不再使用" },
    });
    expect(s.success).toBe(true);
    if (!s.success) return;

    const res = await getDepartureCheckInfo(s.data.id);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain("离职");
  });

  it("名下没有设备时返回空清单（前端据此渲染空态，而不是报错）", async () => {
    const { initiator, deptMgr, emp, a1, a2 } = await seedDepartEnv();
    await prisma.asset.updateMany({
      where: { id: { in: [a1.id, a2.id] } },
      data: { employeeId: null },
    });
    const requestId = await submitDepart(initiator, emp.id);

    await login(deptMgr);
    const res = await getDepartureCheckInfo(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.assets).toEqual([]);
  });
});

describe("离职单详情补全离职员工信息", () => {
  beforeEach(resetDb);

  afterEach(() => setTestUser(null));

  it("详情 payload 补出姓名/工号/部门，页面才不会退化成「设备 #-」", async () => {
    const { initiator, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);

    const res = await getApprovalRequestById(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;

    const payload = res.data.payload as Record<string, unknown>;
    expect(payload.targetEmployeeId).toBe(emp.id);
    expect(payload.targetEmployeeName).toBe("离职员工");
    expect(payload.targetEmployeeNo).toBe("E-EMP");
    expect(payload.targetDepartmentName).toBe("技术部");
  });

  it("非离职单不会被补上离职员工字段（不误伤其他业务类型）", async () => {
    const { initiator, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { businessType: "ASSET_RETURN" },
    });

    const res = await getApprovalRequestById(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const payload = res.data.payload as Record<string, unknown>;
    expect(payload.targetEmployeeName).toBeUndefined();
  });
});

describe("离职交接单 getDepartureHandover", () => {
  beforeEach(resetDb);

  afterEach(() => setTestUser(null));

  it("终审通过后能读到待对账交接单与设备台数", async () => {
    const { initiator, deptMgr, assetMgr, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);
    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    const res = await getDepartureHandover(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).not.toBeNull();
    expect(res.data?.status).toBe("PENDING");
    expect(res.data?.orderNo).toMatch(/^HO-/);
    expect(res.data?.assetCount).toBe(2);
    expect(res.data?.employeeId).toBe(emp.id);
    // 对账依据 = 交接单快照冻结的应回收清单
    expect(res.data?.items.map((i) => i.assetNo).sort()).toEqual(["DN-0001", "DN-0002"]);
    // 资产管理员持有 asset.depart.view 模块点 → 展开出 asset.depart.execute，可回收
    expect(res.data?.canConfirm).toBe(true);
  });

  it("没有对账回收权限的审批人（部门主管）能看到交接单，但拿不到回收按钮", async () => {
    const { initiator, deptMgr, assetMgr, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);
    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    await login(deptMgr);
    const res = await getDepartureHandover(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data?.status).toBe("PENDING");
    expect(res.data?.canConfirm).toBe(false);
  });

  it("还在审批中时返回 null（没有交接单可对账）", async () => {
    const { initiator, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);

    const res = await getDepartureHandover(requestId);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data).toBeNull();
  });

  it("与本单无关的账号拿不到交接单（越权防护）", async () => {
    const { initiator, deptMgr, assetMgr, outsider, emp } = await seedDepartEnv();
    const requestId = await submitDepart(initiator, emp.id);
    await login(deptMgr);
    await approveNext();
    await login(assetMgr);
    await approveNext();

    await login(outsider);
    const res = await getDepartureHandover(requestId);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain("不存在");
  });
});
