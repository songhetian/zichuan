import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createDepartment,
  getDepartmentById,
  updateDepartment,
} from "@/actions/department.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

describe("部门主管（M1：managerId 读写）", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["department.update"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("可设置部门主管并读到主管信息", async () => {
    const dept = unwrap(await createDepartment({ name: "技术部" }));
    const emp = await prisma.employee.create({
      data: { employeeNo: "E001", name: "张主管", departmentId: dept.id },
    });

    const updated = await updateDepartment(dept.id, { managerId: emp.id });
    expect(updated.success).toBe(true);

    const got = await getDepartmentById(dept.id);
    expect(unwrap(got).managerId).toBe(emp.id);
    expect(unwrap(got).manager?.name).toBe("张主管");
  });

  it("可清除部门主管", async () => {
    const dept = unwrap(await createDepartment({ name: "技术部" }));
    const emp = await prisma.employee.create({
      data: { employeeNo: "E001", name: "张主管", departmentId: dept.id },
    });
    await updateDepartment(dept.id, { managerId: emp.id });

    const cleared = await updateDepartment(dept.id, { managerId: null });
    expect(cleared.success).toBe(true);

    const got = await getDepartmentById(dept.id);
    expect(unwrap(got).managerId).toBeNull();
  });

  it("managerId 指向不存在的员工时报错", async () => {
    const dept = unwrap(await createDepartment({ name: "技术部" }));
    const result = await updateDepartment(dept.id, { managerId: 99999 });
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("员工");
  });
});
