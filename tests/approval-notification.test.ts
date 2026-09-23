import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  submitApprovalRequest,
  getMyTodoTasks,
  approveTask,
  rejectTask,
} from "@/actions/approval.actions";

// ============================================================
// M6 通知触发点：提交 / 流转 / 驳回 / 通过 时落库 Notification
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
}

/** 标准组织：技术部（主管 mgrEmp）→ 员工 emp；节点均 ccType=INITIATOR 抄送发起人 */
async function seedOrg() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const mgrEmp = await prisma.employee.create({
    data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
  });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id, managerId: mgrEmp.id },
  });

  const initiator = await seedAccount("initiator", "EMPLOYEE", ["approval.submit"], emp.id);
  const deptMgr = await seedAccount("deptmgr", "DEPT_MANAGER", ["approval.approve", "approval.submit"], mgrEmp.id);
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage"]);

  const def = await prisma.workflowDefinition.create({
    data: {
      businessType: "ASSET_UPGRADE",
      name: "升级配件流程",
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      nodes: {
        create: [
          { nodeKey: "n1", name: "部门主管审批", type: "APPROVAL", sortOrder: 0, assigneeType: "DEPT_MANAGER", ccType: "INITIATOR" },
          { nodeKey: "n2", name: "资产管理员审批", type: "APPROVAL", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER", ccType: "INITIATOR" },
        ],
      },
    },
  });

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

  const upgrade = {
    assetId: asset.id,
    componentCategoryId: compCat.id,
    action: "UPGRADE" as const,
    reason: "内存不足，申请升级",
  };

  return { initiator, deptMgr, assetMgr, asset, upgrade };
}

async function submitOne(org: Awaited<ReturnType<typeof seedOrg>>) {
  const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
  if (!r.success) throw new Error(r.error);
  return r.data.id;
}

async function notificationsOf(adminId: number) {
  return prisma.notification.findMany({
    where: { adminId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

describe("M6 审批触发点通知", () => {
  afterEach(() => setTestUser(null));

  it("提交后：首节点审批人收到待办通知 + 发起人收到抄送通知", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    // 审批人（部门主管）：1 条「新的审批待办」，关联 requestId，未读
    const mgrNotifs = await notificationsOf(org.deptMgr.id);
    expect(mgrNotifs).toHaveLength(1);
    expect(mgrNotifs[0].requestId).toBe(requestId);
    expect(mgrNotifs[0].title).toBe("新的审批待办");
    expect(mgrNotifs[0].isRead).toBe(false);
    expect(mgrNotifs[0].content).toContain("AP-");

    // 抄送（ccType=INITIATOR → 发起人）：1 条「审批抄送」
    const initiatorNotifs = await notificationsOf(org.initiator.id);
    expect(initiatorNotifs).toHaveLength(1);
    expect(initiatorNotifs[0].title).toBe("审批抄送");
    expect(initiatorNotifs[0].requestId).toBe(requestId);
  });

  it("首节点通过：下一节点审批人收到待办通知 + 发起人收到该节点抄送", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;
    const a = await approveTask({ taskId: mine.data[0].id, comment: "同意" });
    expect(a.success).toBe(true);
    if (!a.success) return;

    // 下一节点审批人（资产管理员）收到新待办通知
    const amNotifs = await notificationsOf(org.assetMgr.id);
    expect(amNotifs).toHaveLength(1);
    expect(amNotifs[0].title).toBe("新的审批待办");
    expect(amNotifs[0].requestId).toBe(requestId);

    // 抄送人（发起人）累计 2 条：提交时 n1 抄送 + 通过时 n1 抄送
    const initiatorNotifs = await notificationsOf(org.initiator.id);
    expect(initiatorNotifs).toHaveLength(2);
    expect(initiatorNotifs.map((n) => n.title)).toEqual(["审批抄送", "审批抄送"]);
  });

  it("末节点通过：发起人收到「审批通过」通知", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    await approveTask({ taskId: mine.data[0].id });

    await login(org.assetMgr);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    const a = await approveTask({ taskId: mine.data[0].id });
    expect(a.success).toBe(true);
    if (!a.success) return;

    const initiatorNotifs = await notificationsOf(org.initiator.id);
    const passed = initiatorNotifs.find((n) => n.title === "审批通过");
    expect(passed).toBeDefined();
    expect(passed?.requestId).toBe(requestId);
  });

  it("驳回：发起人收到「审批驳回」通知", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;
    const r = await rejectTask({ taskId: mine.data[0].id, comment: "材料不齐" });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const initiatorNotifs = await notificationsOf(org.initiator.id);
    const rejected = initiatorNotifs.find((n) => n.title === "审批驳回");
    expect(rejected).toBeDefined();
    expect(rejected?.requestId).toBe(requestId);
  });

  it("节点指定抄送人（SPECIFIC）：提交时按 ccUserIds 抄送", async () => {
    const org = await seedOrg();
    const ccUser = await seedAccount("ccuser", "EMPLOYEE", []);
    const def = await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "指定抄送流程",
        version: 2,
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
              ccType: "SPECIFIC",
              ccUserIds: [ccUser.id],
            },
          ],
        },
      },
    });

    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const ccNotifs = await notificationsOf(ccUser.id);
    expect(ccNotifs).toHaveLength(1);
    expect(ccNotifs[0].title).toBe("审批抄送");
    expect(ccNotifs[0].requestId).toBe(r.data.id);

    // 审批人只收到待办通知，不会收到抄送
    const mgrNotifs = await notificationsOf(org.deptMgr.id);
    expect(mgrNotifs.map((n) => n.title)).toEqual(["新的审批待办"]);
  });

  it("抄送规则 ccRules（spec §5.1）：默认流程 n1 抄送发起人+资产管理员", async () => {
    const org = await seedOrg();
    const def = await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "抄送规则流程",
        version: 2,
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
              // 多规则抄送：发起人本人 + 资产管理员角色
              ccType: "NONE",
              ccRules: [
                { type: "INITIATOR" },
                { type: "ROLE", roleKey: "ASSET_MANAGER" },
              ],
            },
          ],
        },
      },
    });

    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // 抄送：发起人本人
    const initiatorNotifs = await notificationsOf(org.initiator.id);
    expect(initiatorNotifs).toHaveLength(1);
    expect(initiatorNotifs[0].title).toBe("审批抄送");
    expect(initiatorNotifs[0].requestId).toBe(r.data.id);

    // 抄送：资产管理员角色下的账号
    const amNotifs = await notificationsOf(org.assetMgr.id);
    expect(amNotifs).toHaveLength(1);
    expect(amNotifs[0].title).toBe("审批抄送");
    expect(amNotifs[0].requestId).toBe(r.data.id);
  });

  it("抄送规则并集去重：发起人既是审批人又是抄送人时只收一条", async () => {
    const org = await seedOrg();
    // 节点审批人 = 部门主管，抄送规则 = 部门主管 + 指定账号（与审批人重合）
    const def = await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "抄送去重流程",
        version: 3,
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
              ccType: "NONE",
              ccRules: [{ type: "DEPT_MANAGER" }, { type: "USER", userIds: [org.deptMgr.id] }],
            },
          ],
        },
      },
    });

    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // 部门主管（既是审批人又是抄送人）只收 1 条：待办（审批人优先）
    const mgrNotifications = await notificationsOf(org.deptMgr.id);
    expect(mgrNotifications).toHaveLength(1);
    expect(mgrNotifications[0].title).toBe("新的审批待办");
  });

  it("通知带类型（spec §4）：待办 APPROVAL_TODO / 抄送 APPROVAL_CC / 结果 APPROVAL_RESULT", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    await submitOne(org);

    // 提交：审批人收到待办、发起人收到抄送
    const mgrNotifs = await notificationsOf(org.deptMgr.id);
    expect(mgrNotifs[0].type).toBe("APPROVAL_TODO");
    const ccNotifs = await notificationsOf(org.initiator.id);
    expect(ccNotifs[0].type).toBe("APPROVAL_CC");

    // 全链路通过：发起人收到「审批通过」结果通知
    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    await approveTask({ taskId: mine.data[0].id });

    await login(org.assetMgr);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    await approveTask({ taskId: mine.data[0].id });

    const passed = (await notificationsOf(org.initiator.id)).find(
      (n) => n.title === "审批通过"
    );
    expect(passed?.type).toBe("APPROVAL_RESULT");
  });
});
