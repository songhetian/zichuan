import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { unwrap, unwrapError } from "./helpers";
import { submitApprovalRequest } from "@/actions/approval.actions";
import { hasPermission } from "@/lib/permissions";

// ============================================================
// 主管代申请：部门主管可为其部门员工的本人设备发起申请
// Seam：submitApprovalRequest({ ..., forEmployeeId })
//   - 数据范围：须 dept.data.view 且被代申员工属于本人主管部门，否则拒
//   - 归属校验：资产必须属于被代申员工
//   - 首节点按被代申员工的组织解析
// ============================================================

async function seedRole(key: string, permissions: string[]) {
  const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key, isSystem: true } });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({ where: { key: p }, update: {}, create: { key: p, module: "m", name: p } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function seedWorkflow(businessType: "ASSET_SCRAP" | "ASSET_UPGRADE") {
  const def = await prisma.workflowDefinition.create({
    data: { name: "t", businessType, status: "PUBLISHED", version: 1 },
  });
  const first = await prisma.workflowNode.create({
    data: { definitionId: def.id, name: "部门主管", nodeKey: "n1", sortOrder: 0, assigneeType: "DEPT_MANAGER" },
  });
  const last = await prisma.workflowNode.create({
    data: { definitionId: def.id, name: "资产管理员", nodeKey: "n2", sortOrder: 1, assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" },
  });
  return { def, first, last };
}

async function seedOrg() {
  const amRole = await seedRole("AM", ["asset.manage"]);
  const am = await prisma.admin.create({ data: { username: "am", password: "x", roleId: amRole.id } });

  const dept = await prisma.department.create({ data: { name: "技术部", managerId: null } });
  // 员工 A 属于技术部
  const empA = await prisma.employee.create({ data: { employeeNo: "A001", name: "张三", departmentId: dept.id } });
  // 部门固定一个可解析的主管账号（DEPT_MANAGER 节点依赖）
  const mgrEmp = await prisma.employee.create({ data: { employeeNo: "M99", name: "部门主管", departmentId: dept.id } });
  await prisma.admin.create({ data: { username: "deptmgr", password: "x", roleId: amRole.id, employeeId: mgrEmp.id } });
  await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });

  // ROLE=资产管理员 节点需要一个该角色账号（否则末节点解析不到）
  const amRole2 = await seedRole("ASSET_MANAGER", []);
  await prisma.admin.create({ data: { username: "assetmgr", password: "x", roleId: amRole2.id } });

  const assetCat = await prisma.assetCategory.upsert({ where: { code: "DN" }, update: {}, create: { name: "电脑", code: "DN" } });
  const tmpl = await prisma.deviceTemplate.create({ data: { name: "标准", categoryId: assetCat.id } });
  const asset = await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "idle", status: "IN_USE", employeeId: empA.id, templateId: tmpl.id },
  });
  return { dept, am, asset, empA };
}

describe("主管代申请", () => {
  afterEach(() => setTestUser(null));
  beforeEach(async () => {
    await prisma.approvalTask.deleteMany();
    await prisma.approvalLog.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.workflowEdge.deleteMany();
    await prisma.workflowNode.deleteMany();
    await prisma.workflowDefinition.deleteMany();
    await prisma.lifecycleLog.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  it("部门主管可为本人部门员工的本人设备代发申请（首节点=该员工部门主管）", async () => {
    const { dept, asset, empA } = await seedOrg();
    const dmRole = await seedRole("DM", ["approval.submit", "dept.data.view"]);
    const dm = await prisma.admin.create({ data: { username: "dm", password: "x", roleId: dmRole.id } });
    const dmEmp = await prisma.employee.create({ data: { employeeNo: "M01", name: "主管", departmentId: dept.id } });
    await prisma.admin.update({ where: { id: dm.id }, data: { employeeId: dmEmp.id } });
    await prisma.department.update({ where: { id: dept.id }, data: { managerId: dmEmp.id } });
    setTestUser({ id: dm.id, username: "dm", permissions: ["approval.submit", "dept.data.view"] });

    await seedWorkflow("ASSET_SCRAP");

    const r = await submitApprovalRequest({
      title: "代张三报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "需报废" },
      forEmployeeId: empA.id,
    });
    expect(r.success).toBe(true);
    const req = unwrap(r);
    // 首节点待办应派给技术部主管 dm（被代申员工张三的部门主管）
    const tasks = await prisma.approvalTask.findMany({ where: { requestId: req.id }, include: { node: true } });
    expect(tasks[0].assigneeId).toBe(dm.id);
  });

  it("被代申设备不属于该员工 → 被拒", async () => {
    const { dept, asset, empA } = await seedOrg();
    // 其它员工 B 持有该设备
    const empB = await prisma.employee.create({ data: { employeeNo: "A002", name: "李四", departmentId: dept.id } });
    await prisma.asset.update({ where: { id: asset.id }, data: { employeeId: empB.id } });

    const dmEmp = await prisma.employee.create({ data: { employeeNo: "M03", name: "主管", departmentId: dept.id } });
    const dmRole = await seedRole("DM", ["approval.submit", "dept.data.view"]);
    const dm = await prisma.admin.create({ data: { username: "dm", password: "x", roleId: dmRole.id, employeeId: dmEmp.id } });
    await prisma.department.update({ where: { id: dept.id }, data: { managerId: dmEmp.id } });
    setTestUser({ id: dm.id, username: "dm", permissions: ["approval.submit", "dept.data.view"] });

    await seedWorkflow("ASSET_SCRAP");
    const r = await submitApprovalRequest({
      title: "代张三报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "需报废" },
      forEmployeeId: empA.id,
    });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("该员工");
  });

  it("跨部门代申请 → 被拒", async () => {
    const { dept, asset, empA } = await seedOrg();
    // 运营部主管 dm，其主管部门是 ops，不是 empA 所在的 dept
    const ops = await prisma.department.create({ data: { name: "运营部" } });
    const dmEmp = await prisma.employee.create({ data: { employeeNo: "M02", name: "运营主管", departmentId: ops.id } });
    const dmRole = await seedRole("DM", ["approval.submit", "dept.data.view"]);
    const dm = await prisma.admin.create({ data: { username: "dm", password: "x", roleId: dmRole.id, employeeId: dmEmp.id } });
    await prisma.department.update({ where: { id: ops.id }, data: { managerId: dmEmp.id } }); // dm 只管辖 ops
    setTestUser({ id: dm.id, username: "dm", permissions: ["approval.submit", "dept.data.view"] });

    await seedWorkflow("ASSET_SCRAP");
    const r = await submitApprovalRequest({
      title: "代张三报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "需报废" },
      forEmployeeId: empA.id, // empA 在技术部，dm 主管运营部 → 无权
    });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("无权");
  });

  it("无 forEmployeeId 仍为本人发起（自己的设备）", async () => {
    const { dept, asset, empA } = await seedOrg();
    const empRole = await seedRole("EMP", ["approval.submit"]);
    const emp = await prisma.admin.create({
      data: { username: "emp", password: "x", roleId: empRole.id, employeeId: empA.id },
    });
    setTestUser({ id: emp.id, username: "emp", permissions: ["approval.submit"] });

    await seedWorkflow("ASSET_SCRAP");
    const r = await submitApprovalRequest({
      title: "我的报废",
      businessType: "ASSET_SCRAP",
      payload: { assetId: asset.id, reason: "需报废" },
    });
    expect(r.success).toBe(true);
  });
});