/**
 * 员工批量创建：姓名 = `部门名-4 位随机编号`，工号自动连续生成。
 * 场景是「先造一批占位员工，再拿去和设备搭配（分配/调拨）」。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { createDepartment } from "@/actions/department.actions";
import { createEmployee, createEmployeesBatch, getEmployees } from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

describe("createEmployeesBatch 批量创建员工", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("一次创建指定人数，姓名以部门名开头", async () => {
    const dept = unwrap(await createDepartment({ name: "研发部" }));

    const result = await createEmployeesBatch({ departmentId: dept.id, count: 5 });

    expect(result.success).toBe(true);
    const created = unwrap(result);
    expect(created).toHaveLength(5);
    for (const emp of created) {
      expect(emp.name.startsWith("研发部-")).toBe(true);
      expect(emp.departmentName).toBe("研发部");
    }
  });

  it("工号自动生成、互不重复、且为连续序号", async () => {
    const dept = unwrap(await createDepartment({ name: "行政部" }));

    const created = unwrap(await createEmployeesBatch({ departmentId: dept.id, count: 3 }));

    const nos = created.map((e) => e.employeeNo);
    expect(new Set(nos).size).toBe(3);
    expect(nos).toEqual(["EMP0001", "EMP0002", "EMP0003"]);
  });

  it("已有员工时工号接着往后排", async () => {
    const dept = unwrap(await createDepartment({ name: "行政部" }));
    await createEmployee({ name: "老员工", departmentId: dept.id }); // EMP0001

    const created = unwrap(await createEmployeesBatch({ departmentId: dept.id, count: 2 }));

    expect(created.map((e) => e.employeeNo)).toEqual(["EMP0002", "EMP0003"]);
  });

  it("批内姓名不重复", async () => {
    const dept = unwrap(await createDepartment({ name: "市场部" }));

    const created = unwrap(await createEmployeesBatch({ departmentId: dept.id, count: 8 }));

    expect(new Set(created.map((e) => e.name)).size).toBe(8);
  });

  it("连续两批之间姓名也不重复", async () => {
    const dept = unwrap(await createDepartment({ name: "市场部" }));

    const first = unwrap(await createEmployeesBatch({ departmentId: dept.id, count: 6 }));
    const second = unwrap(await createEmployeesBatch({ departmentId: dept.id, count: 6 }));

    const all = [...first, ...second].map((e) => e.name);
    expect(new Set(all).size).toBe(12);
  });

  it("创建的人能在员工列表里查到", async () => {
    const dept = unwrap(await createDepartment({ name: "财务部" }));
    await createEmployeesBatch({ departmentId: dept.id, count: 2 });

    const list = unwrap(await getEmployees({ departmentId: dept.id }));

    expect(list).toHaveLength(2);
  });

  it("数量为 0 或负数会被拒绝", async () => {
    const dept = unwrap(await createDepartment({ name: "财务部" }));

    const zero = await createEmployeesBatch({ departmentId: dept.id, count: 0 });
    expect(zero.success).toBe(false);

    const negative = await createEmployeesBatch({ departmentId: dept.id, count: -1 });
    expect(negative.success).toBe(false);

    expect(await prisma.employee.count()).toBe(0);
  });

  it("单次创建数量上限 50", async () => {
    const dept = unwrap(await createDepartment({ name: "财务部" }));

    const result = await createEmployeesBatch({ departmentId: dept.id, count: 51 });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("50");
    expect(await prisma.employee.count()).toBe(0);
  });

  it("部门不存在时拒绝", async () => {
    const result = await createEmployeesBatch({ departmentId: 9999, count: 3 });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("部门不存在");
  });
});
