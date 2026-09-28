import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { createAdmin, getAdmins } from "@/actions/admin.actions";
import { createEmployee, updateEmployee, resetEmployeePassword, deleteEmployee, getEmployees } from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

/** 建一个角色（测试自建，不依赖种子）；permissions = 该角色拥有的权限 key */
async function seedRole(key: string, name: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { key, name, isSystem: true } });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "system", name: p },
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  }
  return role;
}

async function seedSuperAdmin() {
  const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
  const boss = await prisma.admin.create({
    data: { username: "boss", password: "x", roleId: superRole.id },
  });
  setTestUser({ id: boss.id, username: "boss" });
  return boss;
}

describe("创建账号时绑定员工（M2：全员登录账号）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    await prisma.employee.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("创建账号时可绑定员工，列表显示绑定关系", async () => {
    await seedSuperAdmin();
    const deptRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({
      data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
    });

    const result = await createAdmin({
      username: "zhangsan",
      password: "pass123",
      roleId: deptRole.id,
      employeeId: emp.id,
    });
    expect(result.success).toBe(true);

    const admins = unwrap(await getAdmins());
    const zhangsan = admins.find((a) => a.username === "zhangsan");
    expect(zhangsan?.employee?.name).toBe("张三");
  });

  it("员工已被其他账号绑定时报错", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({
      data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
    });

    await createAdmin({ username: "zhangsan", password: "pass123", roleId: empRole.id, employeeId: emp.id });
    const result = await createAdmin({ username: "lisi", password: "pass123", roleId: empRole.id, employeeId: emp.id });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("已被");
  });

  it("员工不存在时报错", async () => {
    await seedSuperAdmin();
    const ghostRole = await seedRole("EMPLOYEE", "普通员工", []);

    const result = await createAdmin({ username: "ghost", password: "pass123", roleId: ghostRole.id, employeeId: 999999 });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("员工");
  });

  it("创建账号默认置 mustChangePassword=true（首次登录需改密）", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({
      data: { employeeNo: "E009", name: "新员工", departmentId: dept.id },
    });

    const result = await createAdmin({
      username: "e009",
      password: "pass123",
      roleId: empRole.id,
      employeeId: emp.id,
    });
    expect(result.success).toBe(true);

    const acc = await prisma.admin.findUnique({ where: { username: "e009" } });
    expect(acc?.mustChangePassword).toBe(true);
  });
});

describe("新建员工自动创建登录账号（登录名=工号）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    await prisma.employee.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("超管新建员工自动创建账号（登录名=工号、默认密码 123456、首登强制改密）", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });

    const result = await createEmployee({
      name: "王五",
      departmentId: dept.id,
      roleId: empRole.id,
    });
    expect(result.success).toBe(true);
    const empNo = unwrap(result).employeeNo;
    expect(empNo).toMatch(/^EMP\d+$/);

    const emps = unwrap(await getEmployees({}));
    const wangwu = emps.find((e) => e.name === "王五");
    expect(wangwu).toBeDefined();
    const admin = await prisma.admin.findUnique({ where: { employeeId: wangwu!.id } });
    expect(admin?.username).toBe(empNo); // 登录名 = 工号
    expect(admin?.roleId).toBe(empRole.id);
    expect(admin?.displayName).toBe("王五");
    expect(admin?.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("123456", admin!.password)).toBe(true);
  });

  it("工号已存在时整体回滚（员工不重复创建、不建账号）", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    await prisma.employee.create({
      data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
    });

    const result = await createEmployee({
      employeeNo: "E001",
      name: "李四",
      departmentId: dept.id,
      roleId: empRole.id,
    });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("工号已存在");
    const lisi = await prisma.employee.findFirst({ where: { name: "李四" } });
    expect(lisi).toBeNull();
    const dupli = await prisma.admin.findFirst({ where: { username: "E001" } });
    expect(dupli).toBeNull();
  });

  it("无账号管理权限：员工增删改一律被拒（新建员工需账号管理权限）", async () => {
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const adminRole = await seedRole("ADMIN", "管理员", []);
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });
    setTestUser({ id: emp.id, username: "emp1" });
    const dept = await prisma.department.create({ data: { name: "技术部" } });

    // 显式指定角色：无账号管理权限被拒
    const denied = await createEmployee({ name: "黑客", departmentId: dept.id, roleId: adminRole.id });
    expect(denied.success).toBe(false);
    expect(unwrapError(denied)).toContain("权限");

    // 未指定角色（默认普通员工）：同样需账号管理权限
    const deniedDefault = await createEmployee({ name: "普通员工甲", departmentId: dept.id });
    expect(deniedDefault.success).toBe(false);
    expect(unwrapError(deniedDefault)).toContain("权限");
  });

  it("重置员工密码为 123456 并标记首登强制改密", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const result = await createEmployee({ name: "赵六", departmentId: dept.id, roleId: empRole.id });
    expect(result.success).toBe(true);
    const empId = unwrap(await getEmployees({})).find((e) => e.name === "赵六")!.id;

    // 先改成非默认密码并清除强制改密标记，模拟正常使用中的账号
    const account = await prisma.admin.findUnique({ where: { employeeId: empId } });
    await prisma.admin.update({
      where: { id: account!.id },
      data: { password: await bcrypt.hash("ComplexPass1", 10), mustChangePassword: false },
    });

    const res = await resetEmployeePassword(empId);
    expect(res.success).toBe(true);
    const after = await prisma.admin.findUnique({ where: { id: account!.id } });
    expect(after?.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("123456", after!.password)).toBe(true);
  });
});

describe("编辑员工时同步登录账号（登录名=工号）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    await prisma.employee.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("修改员工工号时同步更新绑定账号的登录名", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });

    const created = await createEmployee({ name: "张三", departmentId: dept.id, roleId: empRole.id });
    expect(created.success).toBe(true);
    const empId = unwrap(created).id;

    const upd = await updateEmployee(empId, { employeeNo: "NEW001" });
    expect(upd.success).toBe(true);

    const account = await prisma.admin.findUnique({ where: { employeeId: empId } });
    expect(account?.username).toBe("NEW001");
  });

  it("修改工号为其他员工已占用工号时拒绝且账号不变", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });

    const a = await createEmployee({ name: "员工甲", departmentId: dept.id, roleId: empRole.id });
    const b = await createEmployee({ name: "员工乙", departmentId: dept.id, roleId: empRole.id });
    const empA = unwrap(a);
    const empB = unwrap(b);

    const upd = await updateEmployee(empA.id, { employeeNo: empB.employeeNo });
    expect(upd.success).toBe(false);

    const accountA = await prisma.admin.findUnique({ where: { employeeId: empA.id } });
    expect(accountA?.username).toBe(empA.employeeNo);
  });

  it("编辑角色但员工没有登录账号时返回明确错误", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    // 直接建员工、不建账号（模拟存量无账号员工）
    const emp = await prisma.employee.create({
      data: { employeeNo: "NOACC1", name: "无账号员工", departmentId: dept.id },
    });

    const upd = await updateEmployee(emp.id, { roleId: empRole.id });

    expect(upd.success).toBe(false);
    expect(unwrapError(upd)).toContain("登录账号");
  });

  it("角色未变化时不发送角色变更通知", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });

    const created = await createEmployee({ name: "通知测试", departmentId: dept.id, roleId: empRole.id });
    expect(created.success).toBe(true);
    const empId = unwrap(created).id;

    const upd = await updateEmployee(empId, { roleId: empRole.id });
    expect(upd.success).toBe(true);

    const notifs = await prisma.notification.count();
    expect(notifs).toBe(0);
  });
});

describe("删除员工时级联清理绑定登录账号（无孤儿账号）", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    await prisma.employee.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("删除员工时级联删除绑定账号，不留下孤儿账号", async () => {
    await seedSuperAdmin();
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });

    const created = await createEmployee({ name: "待删除员工", departmentId: dept.id, roleId: empRole.id });
    expect(created.success).toBe(true);
    const empId = unwrap(created).id;
    const empNo = unwrap(created).employeeNo;
    const before = await prisma.admin.count();

    const del = await deleteEmployee(empId);
    expect(del.success).toBe(true);

    const emp = await prisma.employee.findUnique({ where: { id: empId } });
    expect(emp).toBeNull();
    // 账号必须被真正删除而非仅解绑（employeeId 置空即孤儿账号）
    const after = await prisma.admin.count();
    expect(after).toBe(before - 1);
    const orphan = await prisma.admin.findFirst({ where: { username: empNo } });
    expect(orphan).toBeNull();
  });
});
