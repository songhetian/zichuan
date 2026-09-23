import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  submitApprovalRequest,
  getMyTodoTasks,
  getMySubmittedRequests,
  getApprovalRequestById,
  approveTask,
  rejectTask,
} from "@/actions/approval.actions";
import { getUpgradeAssetOptions } from "@/lib/approval-scope";

// ============================================================
// 组织 + 账号 + 流程 种子（审批人解析依赖）
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

/** 标准组织：技术部（主管 mgrEmp）→ 员工 emp（直属主管 mgrEmp）；三账号 + 已发布流程 + 资产/配件/库存 */
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

  // 配件：旧型号（DDR4-8G）+ 新型号（DDR4-16G，有库存）
  const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const oldModel = await prisma.componentModel.create({
    data: { name: "DDR4-8G", categoryId: compCat.id },
  });
  const newModel = await prisma.componentModel.create({
    data: { name: "DDR4-16G", categoryId: compCat.id },
  });
  await prisma.componentStock.create({ data: { modelId: newModel.id, quantity: 10 } });

  // 设备：在用（分配给申请员工），当前配置 = 旧型号内存
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

  return { dept, mgrEmp, emp, initiator, deptMgr, assetMgr, def, asset, oldModel, newModel, compCat, upgrade };
}

describe("M4 审批引擎：提交 / 待办 / 详情", () => {
  beforeEach(async () => {
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
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

  it("员工提交申请：生成 PENDING 单 + 首节点待办给部门主管 + SUBMIT 日志", async () => {
    const org = await seedOrg();
    await login(org.initiator);

    const r = await submitApprovalRequest({
      title: "申请升级内存",
      payload: org.upgrade,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // 单号格式 AP-YYYYMM-NNNN
    expect(r.data.requestNo).toMatch(/^AP-\d{6}-\d{4}$/);
    expect(r.data.status).toBe("PENDING");
    expect(r.data.currentNodeKey).toBe("n1");

    const req = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: r.data.id },
      include: { tasks: true, logs: true },
    });
    expect(req.definitionId).toBe(org.def.id);
    expect(req.initiatorId).toBe(org.initiator.id);
    // 首节点待办 → 部门主管
    expect(req.tasks).toHaveLength(1);
    expect(req.tasks[0].nodeKey).toBe("n1");
    expect(req.tasks[0].assigneeId).toBe(org.deptMgr.id);
    expect(req.tasks[0].status).toBe("PENDING");
    // SUBMIT 日志
    expect(req.logs.some((l) => l.action === "SUBMIT")).toBe(true);
  });

  it("待办列表：审批人看到、无关账号看不到", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "升级", payload: org.upgrade });
    if (!r.success) throw new Error(r.error);

    // 部门主管有 1 条待办
    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    expect(mine.success).toBe(true);
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0].requestNo).toBe(r.data.requestNo);
    expect(mine.data[0].nodeName).toBe("部门主管审批");

    // 发起人自己看不到待办
    await login(org.initiator);
    const mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    expect(mine2.data).toHaveLength(0);
  });

  it("审批人解析不到（部门主管无账号）时提交报错", async () => {
    const dept = await prisma.department.create({ data: { name: "无人主管部" } });
    const empNoAccount = await prisma.employee.create({
      data: { employeeNo: "E-NOACC", name: "无主管账号员工", departmentId: dept.id },
    });
    // 部门有主管员工，但主管员工没有账号
    const mgrNoAccount = await prisma.employee.create({
      data: { employeeNo: "E-MGRNO", name: "无账号主管", departmentId: dept.id },
    });
    await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrNoAccount.id } });

    // 有生效流程（n1 部门主管审批），但主管无账号 → 提交时应报「无法解析审批人」
    await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "升级配件流程",
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        nodes: {
          create: [
            { nodeKey: "n1", name: "部门主管审批", type: "APPROVAL", sortOrder: 0, assigneeType: "DEPT_MANAGER" },
          ],
        },
      },
    });

    const initiator = await seedAccount("noacc", "EMPLOYEE", ["approval.submit"], empNoAccount.id);
    await login(initiator);

    const r = await submitApprovalRequest({ title: "升级", payload: { assetId: 999, componentCategoryId: 1, action: "UPGRADE", reason: "x" } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("无法解析审批人");
  });

  it("无 approval.submit 权限被拒", async () => {
    const org = await seedOrg();
    await login(org.assetMgr); // ASSET_MANAGER 未授予 submit 权限

    const r = await submitApprovalRequest({ title: "升级", payload: org.upgrade });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("权限");
  });

  it("详情：返回申请信息与时间线日志", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
    if (!r.success) throw new Error(r.error);

    const detail = await getApprovalRequestById(r.data.id);
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(detail.data.requestNo).toBe(r.data.requestNo);
    expect(detail.data.title).toBe("申请升级内存");
    expect(detail.data.status).toBe("PENDING");
    expect(detail.data.version).toBe(1);
    expect(detail.data.initiatorName).toBe("申请员工");
    expect(detail.data.currentNodeName).toBe("部门主管审批");
    // 时间线：SUBMIT
    expect(detail.data.logs.map((l) => l.action)).toContain("SUBMIT");
  });

  it("IDOR 防护：无关账号（非发起/非审批参与/无审批权限）无法查看他人申请单", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "升级", payload: org.upgrade });
    if (!r.success) throw new Error(r.error);
    const requestId = r.data.id;

    // 无关账号：既不是发起人，也没参与审批，且无审批详情权限
    const outsider = await seedAccount("outsider", "EMPLOYEE", []);
    await login(outsider);
    const detail = await getApprovalRequestById(requestId);
    expect(detail.success).toBe(false);

    setTestUser(null);
  });

  it("IDOR 防护：发起人本人始终可查看自己发起的申请单", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const r = await submitApprovalRequest({ title: "升级", payload: org.upgrade });
    if (!r.success) throw new Error(r.error);

    // 再次登录仍为发起人（普通员工），应能查看自己的申请
    await login(org.initiator);
    const detail = await getApprovalRequestById(r.data.id);
    expect(detail.success).toBe(true);
    if (!detail.success) return;
    expect(detail.data.requestNo).toBe(r.data.requestNo);
  });

  it("提交后资产预占：status=RESERVED + reservedByRequestId + reservedFromStatus", async () => {
    const org = await seedOrg();
    await login(org.initiator);

    const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(asset.status).toBe("RESERVED");
    expect(asset.reservedByRequestId).toBe(r.data.id);
    expect(asset.reservedFromStatus).toBe("IN_USE");
  });

  it("payload 缺配件类别或类别不在设备配置：提交报错", async () => {
    const org = await seedOrg();
    await login(org.initiator);

    // 缺 componentCategoryId（配件类别）
    const noCat = await submitApprovalRequest({
      title: "升级",
      payload: { assetId: org.asset.id, action: "UPGRADE", reason: "x" },
    });
    expect(noCat.success).toBe(false);
    if (noCat.success) return;
    expect(noCat.error).toContain("配件类别");

    // 类别不在设备当前配置上
    const otherCat = await prisma.componentCategory.create({ data: { name: "硬盘" } });
    const wrongCat = await submitApprovalRequest({
      title: "升级",
      payload: { assetId: org.asset.id, componentCategoryId: otherCat.id, action: "UPGRADE", reason: "x" },
    });
    expect(wrongCat.success).toBe(false);
    if (wrongCat.success) return;
    expect(wrongCat.error).toContain("不存在该配件类别");
  });

  it("资产已被其他申请预占：提交报错", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const r1 = await submitApprovalRequest({ title: "升级1", payload: org.upgrade });
    expect(r1.success).toBe(true);
    if (!r1.success) return;

    // 同一资产再次提交（仍处于 RESERVED）
    const r2 = await submitApprovalRequest({ title: "升级2", payload: org.upgrade });
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(r2.error).toContain("预占");
  });

  it("员工不能对他人名下的设备发起升级申请", async () => {
    const org = await seedOrg();
    // 另一个员工账号（设备属于 org.emp，不属于他）
    const otherEmp = await prisma.employee.create({
      data: {
        employeeNo: "E-OTHER",
        name: "其他员工",
        departmentId: org.dept.id,
        managerId: org.mgrEmp.id,
      },
    });
    const otherAccount = await seedAccount("other", "EMPLOYEE", ["approval.submit"], otherEmp.id);
    await login(otherAccount);

    const r = await submitApprovalRequest({ title: "越权升级", payload: org.upgrade });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("本人名下");
  });

  it("发起页数据范围：普通员工仅本人名下设备，资产管理员可见全部", async () => {
    const org = await seedOrg();
    // 另一名员工持有另一台设备
    const otherEmp = await prisma.employee.create({
      data: {
        employeeNo: "E-OTHER2",
        name: "其他员工2",
        departmentId: org.dept.id,
        managerId: org.mgrEmp.id,
      },
    });
    const otherAccount = await seedAccount("other2", "EMPLOYEE", ["approval.submit"], otherEmp.id);
    const otherAsset = await prisma.asset.create({
      data: {
        assetNo: "DN-0002",
        name: "其他员工的电脑",
        templateId: org.asset.templateId,
        status: "IN_USE",
        employeeId: otherEmp.id,
      },
    });

    // 普通员工：只看到自己的设备
    const mine = await getUpgradeAssetOptions(otherAccount.id);
    expect(mine.map((a) => a.id)).toEqual([otherAsset.id]);

    // 资产管理员：看到全部设备
    const all = await getUpgradeAssetOptions(org.assetMgr.id);
    expect(all.map((a) => a.id).sort()).toEqual([org.asset.id, otherAsset.id].sort());
  });

  it("发起选择设备排除 RESERVED（普通员工与资产管理员均不误伤）", async () => {
    const org = await seedOrg();
    // 把本机置为已预占（RESERVED）
    await prisma.asset.update({
      where: { id: org.asset.id },
      data: { status: "RESERVED", reservedFromStatus: "IN_USE" },
    });

    // 普通员工：已预占设备不可再选
    const mine = await getUpgradeAssetOptions(org.initiator.id);
    expect(mine.some((a) => a.id === org.asset.id)).toBe(false);

    // 资产管理员：已预占设备同样不可再选
    const all = await getUpgradeAssetOptions(org.assetMgr.id);
    expect(all.some((a) => a.id === org.asset.id)).toBe(false);
  });

  it("我的申请列表：只返回自己发起的单（单号/标题/状态/当前节点）", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const r1 = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
    if (!r1.success) throw new Error(r1.error);

    // 另一名员工也发起申请（不应出现在发起人的列表里）
    const otherEmp = await prisma.employee.create({
      data: {
        employeeNo: "E-OTHER3",
        name: "其他员工3",
        departmentId: org.dept.id,
        managerId: org.mgrEmp.id,
      },
    });
    const otherAccount = await seedAccount("other3", "EMPLOYEE", ["approval.submit"], otherEmp.id);
    const otherAsset = await prisma.asset.create({
      data: {
        assetNo: "DN-0003",
        name: "其他员工3的电脑",
        templateId: org.asset.templateId,
        status: "IN_USE",
        employeeId: otherEmp.id,
      },
    });
    await prisma.assetComponent.create({
      data: { assetId: otherAsset.id, modelId: org.oldModel.id, quantity: 1 },
    });
    await login(otherAccount);
    const r2 = await submitApprovalRequest({
      title: "他人的升级",
      payload: { assetId: otherAsset.id, componentCategoryId: org.compCat.id, action: "UPGRADE", reason: "x" },
    });
    if (!r2.success) throw new Error(r2.error);

    await login(org.initiator);
    const mine = await getMySubmittedRequests();
    expect(mine.success).toBe(true);
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0].requestNo).toBe(r1.data.requestNo);
    expect(mine.data[0].title).toBe("申请升级内存");
    expect(mine.data[0].status).toBe("PENDING");
    expect(mine.data[0].currentNodeName).toBe("部门主管审批");
    expect(mine.data[0].finishedAt).toBeNull();
  });

  it("我的申请列表：状态随流转更新（通过→APPROVED / 驳回→REJECTED）", async () => {
    const org = await seedOrg();
    // 第二台设备（同属发起人）用于第二张单（资产预占互斥，不能同一资产提交两张）
    const asset2 = await prisma.asset.create({
      data: {
        assetNo: "DN-0004",
        name: "申请员工第二台电脑",
        templateId: org.asset.templateId,
        status: "IN_USE",
        employeeId: org.emp.id,
      },
    });
    await prisma.assetComponent.create({
      data: { assetId: asset2.id, modelId: org.oldModel.id, quantity: 1 },
    });
    const upgrade2 = {
      assetId: asset2.id,
      componentCategoryId: org.compCat.id,
      action: "UPGRADE" as const,
      reason: "第二台升级",
    };

    await login(org.initiator);
    const r1 = await submitApprovalRequest({ title: "升级A", payload: org.upgrade });
    if (!r1.success) throw new Error(r1.error);
    const r2 = await submitApprovalRequest({ title: "升级B", payload: upgrade2 });
    if (!r2.success) throw new Error(r2.error);

    // 驳回 B
    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    const bTask = mine.data.find((t) => t.requestId === r2.data.id);
    expect(bTask).toBeDefined();
    if (!bTask) return;
    await rejectTask({ taskId: bTask.id });

    // 通过 A（部门主管 → 资产管理员）
    const aTask = mine.data.find((t) => t.requestId === r1.data.id);
    if (!aTask) return;
    await approveTask({ taskId: aTask.id });
    await login(org.assetMgr);
    const mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    const aTask2 = mine2.data.find((t) => t.requestId === r1.data.id);
    expect(aTask2).toBeDefined();
    if (!aTask2) return;
    await approveTask({ taskId: aTask2.id });

    await login(org.initiator);
    const mine3 = await getMySubmittedRequests();
    expect(mine3.success).toBe(true);
    if (!mine3.success) return;
    expect(mine3.data).toHaveLength(2);
    const statusByNo = new Map(mine3.data.map((x) => [x.requestNo, x.status]));
    expect(statusByNo.get(r1.data.requestNo)).toBe("APPROVED");
    expect(statusByNo.get(r2.data.requestNo)).toBe("REJECTED");
  });
});

// ============================================================
// M4 审批引擎：流转（approveTask / rejectTask）
// ============================================================

/** 提交一张申请并返回 id（需先 login 为发起人） */
async function submitOne(org: Awaited<ReturnType<typeof seedOrg>>) {
  const r = await submitApprovalRequest({ title: "申请升级内存", payload: org.upgrade });
  if (!r.success) throw new Error(r.error);
  return r.data.id;
}

describe("M4 审批引擎：流转", () => {
  beforeEach(async () => {
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
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

  it("首节点通过：待办流转到下一节点 + APPROVE 日志", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    // 部门主管通过 n1
    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    const a = await approveTask({ taskId: mine.data[0].id, comment: "同意" });
    expect(a.success).toBe(true);
    if (!a.success) return;

    // n1 任务 APPROVED；新待办 → 资产管理员
    await login(org.assetMgr);
    const mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    expect(mine2.data).toHaveLength(1);
    expect(mine2.data[0].nodeName).toBe("资产管理员审批");

    // 申请单停留在 n2
    const detail = await getApprovalRequestById(requestId);
    if (!detail.success) return;
    expect(detail.data.status).toBe("PENDING");
    expect(detail.data.currentNodeName).toBe("资产管理员审批");
    expect(detail.data.logs.map((l) => l.action)).toContain("APPROVE");
  });

  it("全部节点通过 → APPROVED 终态", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    await approveTask({ taskId: mine.data[0].id, comment: "同意" });

    await login(org.assetMgr);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    const a = await approveTask({ taskId: mine.data[0].id, comment: "通过" });
    expect(a.success).toBe(true);
    if (!a.success) return;

    const detail = await getApprovalRequestById(requestId);
    if (!detail.success) return;
    expect(detail.data.status).toBe("APPROVED");
    expect(detail.data.currentNodeName).toBeNull();
    expect(detail.data.finishedAt).not.toBeNull();
  });

  it("末节点通过 → 置 APPROVED；不改配件/库存；资产保持预占；finalNodeRole=ASSET_MANAGER（待资产管理员执行）", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    await approveTask({ taskId: mine.data[0].id, comment: "同意" });

    await login(org.assetMgr);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    const a = await approveTask({ taskId: mine.data[0].id, comment: "通过" });
    expect(a.success).toBe(true);
    if (!a.success) return;

    // 新配件库存不变（不再自动扣减）
    const newStock = await prisma.componentStock.findUniqueOrThrow({ where: { modelId: org.newModel.id } });
    expect(newStock.quantity).toBe(10);

    // 旧配件配置仍在（不再执行更换）
    const oldComp = await prisma.assetComponent.findUnique({
      where: { assetId_modelId: { assetId: org.asset.id, modelId: org.oldModel.id } },
    });
    expect(oldComp).not.toBeNull();

    // 无配件库存流水（不再自动出库/回库）
    const stockLogs = await prisma.componentStockLog.findMany({
      where: { modelId: { in: [org.oldModel.id, org.newModel.id] } },
    });
    expect(stockLogs).toHaveLength(0);

    // 生命周期日志：审批通过不再写 UPGRADED（留待资产管理员手动执行时写）
    const lifecycle = await prisma.lifecycleLog.findMany({
      where: { assetId: org.asset.id, action: "UPGRADED" },
    });
    expect(lifecycle).toHaveLength(0);

    // 资产保持预占（手动执行前不释放）
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(asset.status).toBe("RESERVED");
    expect(asset.reservedByRequestId).toBe(requestId);
    expect(asset.reservedFromStatus).toBe("IN_USE");

    // 申请单 APPROVED + finalNodeRole=ASSET_MANAGER（可执行）+ executedAt 为空 + 无 EXECUTE 日志（不再自动执行）
    const req = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { logs: true },
    });
    expect(req.status).toBe("APPROVED");
    expect(req.finalNodeRole).toBe("ASSET_MANAGER");
    expect(req.executedAt).toBeNull();
    expect(req.logs.map((l) => l.action)).not.toContain("EXECUTE");
  });

  it("配件无库存不影响审批通过（审批不触发执行，无 EXECUTE_FAILED）", async () => {
    const org = await seedOrg();
    await prisma.componentStock.update({ where: { modelId: org.newModel.id }, data: { quantity: 0 } });

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
    expect(a.success).toBe(true); // 审批本身成功，无执行失败路径
    if (!a.success) return;

    // 无 EXECUTE_FAILED 日志
    const req = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { logs: true },
    });
    expect(req.status).toBe("APPROVED");
    expect(req.logs.map((l) => l.action)).not.toContain("EXECUTE_FAILED");

    // 资产保持预占（未执行，不释放）
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(asset.status).toBe("RESERVED");
    expect(asset.reservedByRequestId).toBe(requestId);
  });

  it("任一节点驳回 → REJECTED 终态（后续节点无待办）", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;
    const r = await rejectTask({ taskId: mine.data[0].id, comment: "材料不齐" });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const detail = await getApprovalRequestById(requestId);
    if (!detail.success) return;
    expect(detail.data.status).toBe("REJECTED");
    expect(detail.data.currentNodeName).toBeNull();
    expect(detail.data.finishedAt).not.toBeNull();
    expect(detail.data.logs.map((l) => l.action)).toContain("REJECT");

    // 资产管理员无待办（流程终止）
    await login(org.assetMgr);
    const mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    expect(mine2.data).toHaveLength(0);
  });

  it("驳回终态：预占资产释放并恢复原状态", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    // 提交后已预占
    const reserved = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(reserved.status).toBe("RESERVED");

    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;
    const r = await rejectTask({ taskId: mine.data[0].id, comment: "材料不齐" });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(asset.status).toBe("IN_USE");
    expect(asset.reservedByRequestId).toBeNull();
    expect(asset.reservedFromStatus).toBeNull();
  });

  it("ANY 多签：任一审批人通过即推进，其余待办 SKIPPED", async () => {
    const org = await seedOrg();
    const deptMgr2 = await seedAccount("deptmgr2", "DEPT_MANAGER", ["approval.approve"]);
    // 发布新版本：n1 按角色（部门主管，或签）→ n2 资产管理员
    await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "多签流程",
        version: 2,
        status: "PUBLISHED",
        publishedAt: new Date(),
        nodes: {
          create: [
            { nodeKey: "n1", name: "部门主管或签", type: "APPROVAL", sortOrder: 0, assigneeType: "ROLE", assigneeRole: "DEPT_MANAGER", multiMode: "ANY" },
            { nodeKey: "n2", name: "资产管理员审批", type: "APPROVAL", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" },
          ],
        },
      },
    });

    await login(org.initiator);
    await submitOne(org);

    // n1 有两个待办（两个部门主管账号）
    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    await approveTask({ taskId: mine.data[0].id });

    // 另一位主管的待办被跳过
    await login(deptMgr2);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    expect(mine.data).toHaveLength(0);

    // 推进到 n2 资产管理员
    await login(org.assetMgr);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0].nodeName).toBe("资产管理员审批");
  });

  it("ANY 或签：同一用户重复审批已处理待办 → no-op，不产生重复下一节点待办/SKIPPED（幂等）", async () => {
    const org = await seedOrg();
    // 第二个部门主管账号：n1 按角色（部门主管，或签）会同时产生两份待办
    const deptMgr2 = await seedAccount("deptmgr2", "DEPT_MANAGER", ["approval.approve"]);
    await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "多签流程",
        version: 2,
        status: "PUBLISHED",
        publishedAt: new Date(),
        nodes: {
          create: [
            { nodeKey: "n1", name: "部门主管或签", type: "APPROVAL", sortOrder: 0, assigneeType: "ROLE", assigneeRole: "DEPT_MANAGER", multiMode: "ANY", ccType: "INITIATOR" },
            { nodeKey: "n2", name: "资产管理员审批", type: "APPROVAL", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER", ccType: "INITIATOR" },
          ],
        },
      },
    });

    await login(org.initiator);
    const requestId = await submitOne(org);

    // n1 或签：两位部门主管各一份待办
    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    const taskId = mine.data[0].id;

    // 第一位主管通过 → 推进到 n2，另一位主管待办 SKIPPED
    const first = await approveTask({ taskId, comment: "同意" });
    expect(first.success).toBe(true);
    if (!first.success) return;

    // 同一用户再次点击同一待办（双开/双击）：因待办已被抢占而 no-op
    const again = await approveTask({ taskId, comment: "同意" });
    expect(again.success).toBe(false);

    // 第二位主管的待办已被 SKIPPED，尝试处理同样被拒（no-op）
    await login(deptMgr2);
    const mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    expect(mine2.data).toHaveLength(0);

    // 幂等断言：n2 只生成 1 条待办；n1 其余待办只 SKIPPED 1 条；APPROVE 日志只有 1 条
    await login(org.assetMgr);
    const mine3 = await getMyTodoTasks();
    if (!mine3.success) return;
    expect(mine3.data).toHaveLength(1);
    expect(mine3.data[0].nodeName).toBe("资产管理员审批");

    const tasks = await prisma.approvalTask.findMany({ where: { requestId } });
    expect(tasks.filter((t) => t.nodeKey === "n2" && t.status === "PENDING")).toHaveLength(1);
    expect(tasks.filter((t) => t.nodeKey === "n1" && t.status === "SKIPPED")).toHaveLength(1);

    const logs = await prisma.approvalLog.findMany({ where: { requestId } });
    expect(logs.filter((l) => l.action === "APPROVE")).toHaveLength(1);
  });

  it("ALL 会签：全部待办处理后才推进，任一处理不产生重复待办", async () => {
    const org = await seedOrg();
    const deptMgr2 = await seedAccount("deptmgr2", "DEPT_MANAGER", ["approval.approve"]);
    await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_UPGRADE",
        name: "会签流程",
        version: 2,
        status: "PUBLISHED",
        publishedAt: new Date(),
        nodes: {
          create: [
            { nodeKey: "n1", name: "部门主管会签", type: "APPROVAL", sortOrder: 0, assigneeType: "ROLE", assigneeRole: "DEPT_MANAGER", multiMode: "ALL" },
            { nodeKey: "n2", name: "资产管理员审批", type: "APPROVAL", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" },
          ],
        },
      },
    });

    await login(org.initiator);
    const requestId = await submitOne(org);

    // 第一位主管通过：会签未集齐，不应推进
    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    expect(mine.data).toHaveLength(1);
    const a1 = await approveTask({ taskId: mine.data[0].id });
    expect(a1.success).toBe(true);

    // 未推进：第二位主管的待办仍 PENDING，n2 尚无待办
    await login(deptMgr2);
    let mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    expect(mine2.data).toHaveLength(1);
    await login(org.assetMgr);
    const mine3 = await getMyTodoTasks();
    if (!mine3.success) return;
    expect(mine3.data).toHaveLength(0);

    // 第二位通过后集齐 → 推进到 n2，n1 无残留 PENDING/SKIPPED 误伤
    await login(deptMgr2);
    const a2 = await approveTask({ taskId: mine2.data[0].id });
    expect(a2.success).toBe(true);

    const tasks = await prisma.approvalTask.findMany({ where: { requestId } });
    expect(tasks.filter((t) => t.nodeKey === "n1" && t.status === "PENDING")).toHaveLength(0);
    expect(tasks.filter((t) => t.nodeKey === "n2" && t.status === "PENDING")).toHaveLength(1);

    await login(org.assetMgr);
    const mine4 = await getMyTodoTasks();
    if (!mine4.success) return;
    expect(mine4.data).toHaveLength(1);
    expect(mine4.data[0].nodeName).toBe("资产管理员审批");
  });

  it("无 approval.approve 权限被拒", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    await submitOne(org);

    await login(org.initiator); // 发起人只有 submit 权限
    const r = await approveTask({ taskId: 1 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("权限");
  });

  it("重复处理同一待办 → 不产生重复下一节点待办/日志（幂等）", async () => {
    const org = await seedOrg();
    await login(org.initiator);
    const requestId = await submitOne(org);

    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;
    const taskId = mine.data[0].id;
    const first = await approveTask({ taskId, comment: "同意" });
    expect(first.success).toBe(true);
    if (!first.success) return;

    // 再次点击同一待办（模拟重复提交）：不报错、不写重复待办/日志
    const again = await approveTask({ taskId, comment: "同意" });
    expect(again.success).toBe(false);

    // 下一节点（资产管理员）只有 1 条待办；APPROVE 日志只有 1 条
    await login(org.assetMgr);
    const mine2 = await getMyTodoTasks();
    if (!mine2.success) return;
    expect(mine2.data).toHaveLength(1);

    const req = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { logs: true },
    });
    expect(req.logs.filter((l) => l.action === "APPROVE")).toHaveLength(1);
  });

  it("非当前待办归属人不能处理他人待办", async () => {
    const org = await seedOrg();
    const otherMgr = await seedAccount("othermgr", "DEPT_MANAGER", ["approval.approve"]);
    await login(org.initiator);
    await submitOne(org);

    await login(org.deptMgr);
    const mine = await getMyTodoTasks();
    if (!mine.success) return;

    // 有审批权限但不是该待办归属人的主管，不能处理
    await login(otherMgr);
    const r = await approveTask({ taskId: mine.data[0].id });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("无权限");
  });
});

// ============================================================
// M5 扩展：资产报废流程（ASSET_SCRAP）提交 + 全链路执行
// ============================================================
describe("资产报废流程（ASSET_SCRAP）", () => {
  beforeEach(async () => {
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.workflowEdge.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.assetComponent.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  async function seedScrapOrg() {
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const mgrEmp = await prisma.employee.create({
      data: { employeeNo: "E-MGR", name: "部门主管", departmentId: dept.id },
    });
    await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
    const emp = await prisma.employee.create({
      data: { employeeNo: "E-EMP", name: "申请员工", departmentId: dept.id, managerId: mgrEmp.id },
    });
    const initiator = await seedAccount("scrapinitiator", "EMPLOYEE", ["approval.submit"], emp.id);
    const deptMgr = await seedAccount("scrapdeptmgr", "DEPT_MANAGER", ["approval.approve"], mgrEmp.id);
    const assetMgr = await seedAccount("scrapassetmgr", "ASSET_MANAGER", ["approval.approve", "asset.manage"]);

    const def = await prisma.workflowDefinition.create({
      data: {
        businessType: "ASSET_SCRAP",
        name: "资产报废流程",
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

    const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
    const template = await prisma.deviceTemplate.create({
      data: { name: "标准电脑", categoryId: assetCat.id },
    });
    const asset = await prisma.asset.create({
      data: { assetNo: "DN-SCRAP", name: "待报废电脑", templateId: template.id, status: "IN_USE", employeeId: emp.id },
    });

    return { dept, emp, initiator, deptMgr, assetMgr, def, asset };
  }

  it("员工提交报废申请；全部审批通过后资产自动置为 SCRAPPED + 生命周期日志 + 释放预占", async () => {
    const org = await seedScrapOrg();
    await login(org.initiator);

    const r = await submitApprovalRequest({
      title: "设备损坏申请报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: org.asset.id, reason: "屏幕损坏无法维修" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // 提交时资产被预占
    const reserved = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(reserved.status).toBe("RESERVED");

    // 部门主管通过
    await login(org.deptMgr);
    let mine = await getMyTodoTasks();
    if (!mine.success) return;
    await approveTask({ taskId: mine.data[0].id, comment: "同意" });

    // 资产管理员通过 → 自动报废
    await login(org.assetMgr);
    mine = await getMyTodoTasks();
    if (!mine.success) return;
    const a = await approveTask({ taskId: mine.data[0].id, comment: "损坏属实" });
    expect(a.success).toBe(true);
    if (!a.success) return;

    const scrap = await prisma.asset.findUniqueOrThrow({ where: { id: org.asset.id } });
    expect(scrap.status).toBe("SCRAPPED");
    expect(scrap.reservedByRequestId).toBeNull();
    expect(scrap.reservedFromStatus).toBeNull();

    const lifecycle = await prisma.lifecycleLog.findFirstOrThrow({
      where: { assetId: org.asset.id, action: "SCRAPPED" },
    });
    expect(lifecycle.operatorId).toBeNull();
  });

  it("无该业务类型生效流程时提交被拒", async () => {
    const org = await seedScrapOrg();
    await prisma.workflowDefinition.deleteMany({
      where: { businessType: "ASSET_SCRAP" },
    });
    await login(org.initiator);
    const r = await submitApprovalRequest({
      title: "报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: org.asset.id, reason: "坏了" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("流程");
  });

  it("非归属员工不能对他人名下设备发起报废", async () => {
    const org = await seedScrapOrg();
    // 独立账号：同部门且归属同一主管（能解析出审批人），但设备不属于他
    const intruderEmp = await prisma.employee.create({
      data: {
        employeeNo: "E-INTRUDER",
        name: "越权员工",
        departmentId: org.dept.id,
        managerId: org.emp.managerId,
      },
    });
    const intruder = await seedAccount("scrapintruder", "EMPLOYEE", ["approval.submit"], intruderEmp.id);
    await login(intruder);
    const r = await submitApprovalRequest({
      title: "越权报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: org.asset.id, reason: "x" },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("本人名下");
  });
});
