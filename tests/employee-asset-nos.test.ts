import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { getEmployees } from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

/**
 * 员工管理页要支持「按设备编码搜到使用人」，但过滤是前端实时做的
 * （141 名员工 / 118 台有主设备，整份数据才 1KB 出头，没必要为每次输入打一次接口）。
 * 因此 `getEmployees` 必须把每位员工名下的设备编码一并带出来。
 */
async function setupData() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const otherDept = await prisma.department.create({ data: { name: "财务部" } });
  const category = await prisma.assetCategory.create({
    data: { name: "计算机设备", code: "DT" },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准办公电脑", categoryId: category.id },
  });

  const 张三 = await prisma.employee.create({
    data: { employeeNo: "EMP0001", name: "张三", departmentId: dept.id },
  });
  const 李四 = await prisma.employee.create({
    data: { employeeNo: "EMP0002", name: "李四", departmentId: otherDept.id },
  });

  const asset = await prisma.asset.create({
    data: {
      assetNo: "DT-7KF3WX",
      name: "张三的办公电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: 张三.id,
    },
  });

  return { 张三, 李四, asset };
}

describe("getEmployees 带出员工名下设备编码", () => {
  beforeEach(() => setTestUser({ id: 1, username: "admin" }));
  afterEach(() => setTestUser(null));

  it("返回每位员工名下设备的编码，没有设备的员工返回空数组", async () => {
    const { 张三, 李四, asset } = await setupData();

    const list = unwrap(await getEmployees());

    expect(list.find((e) => e.id === 张三.id)?.assetNos).toEqual([asset.assetNo]);
    expect(list.find((e) => e.id === 李四.id)?.assetNos).toEqual([]);
  });
});
