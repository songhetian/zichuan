import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  submitApprovalRequest,
  getMySubmittedRequests,
} from "@/actions/approval.actions";

// ============================================================
// 审批业务类型 tabs：「我的申请」按类型过滤
// Seam A：getMySubmittedRequests(businessType?) 过滤 + 返回 businessType 字段
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

/** 造一套能提交多类申请的最小环境：部门主管→资产管理员流程模板 + 申请人 */
async function seedEnv() {
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

  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准办公电脑", categoryId: assetCat.id },
  });
  const asset = await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "员工的电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });
  const asset2 = await prisma.asset.create({
    data: {
      assetNo: "DN-0002",
      name: "员工的电脑2",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });

  async function seedWorkflow(
    businessType: "ASSET_SCRAP" | "ASSET_RETURN" | "ASSET_UPGRADE" | "ASSET_REPLACE" | "ASSET_REPAIR" | "ASSET_DEPART"
  ) {
    const def = await prisma.workflowDefinition.create({
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
    return def;
  }

  return { initiator, deptMgr, assetMgr, asset, asset2, emp, seedWorkflow };
}

describe("我的申请 按业务类型过滤（Seam A）", () => {
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

  it("返回值包含 businessType 字段（供前端 tab 计数）", async () => {
    const { initiator, asset, asset2, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");
    await seedWorkflow("ASSET_RETURN");

    setTestUser({ id: initiator.id, username: initiator.username });
    await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP" as never,
      payload: { assetId: asset.id, reason: "报废" },
    });
    await submitApprovalRequest({
      title: "退回电脑",
      businessType: "ASSET_RETURN" as never,
      payload: { assetId: asset2.id, reason: "退回" },
    });

    const r = await getMySubmittedRequests();
    expect(r.success).toBe(true);
    if (!r.success) return;
    const types = new Set(r.data.map((x) => x.businessType));
    expect(types.size).toBe(2);
    expect(r.data.length).toBe(2);
  });

  it("按 businessType 过滤：仅返回该类型的申请", async () => {
    const { initiator, asset, asset2, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");
    await seedWorkflow("ASSET_RETURN");

    setTestUser({ id: initiator.id, username: initiator.username });
    await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP" as never,
      payload: { assetId: asset.id, reason: "报废" },
    });
    await submitApprovalRequest({
      title: "退回电脑",
      businessType: "ASSET_RETURN" as never,
      payload: { assetId: asset2.id, reason: "退回" },
    });

    const r = await getMySubmittedRequests("ASSET_SCRAP");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(1);
    expect(r.data[0].title).toBe("报废电脑");
    expect(r.data[0].businessType).toBe("ASSET_SCRAP");
  });

  it("传入未提交过的类型 → 返回空数组", async () => {
    const { initiator, asset, seedWorkflow } = await seedEnv();
    await seedWorkflow("ASSET_SCRAP");

    setTestUser({ id: initiator.id, username: initiator.username });
    await submitApprovalRequest({
      title: "报废电脑",
      businessType: "ASSET_SCRAP" as never,
      payload: { assetId: asset.id, reason: "报废" },
    });

    const r = await getMySubmittedRequests("ASSET_REPAIR");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(0);
  });
});