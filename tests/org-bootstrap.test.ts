import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { bootstrapOrgData } from "@/lib/org-bootstrap";

describe("bootstrapOrgData — 组织数据补全（部门+员工+主管+全员账号）", () => {
  it("空库运行时创建部门/员工/账号，并正确指派主管与角色", async () => {
    const result = await bootstrapOrgData([
      { name: "技术部", employeeCount: 3 },
      { name: "市场部", employeeCount: 2 },
    ]);

    // 2 部门 + 5 员工 + 5 员工账号 + 1 资产管理员账号（默认流程 n2 角色）
    expect(result).toEqual({ skipped: false, departments: 2, employees: 5, admins: 6 });

    // 部门与员工数量
    const depts = await prisma.department.findMany({ orderBy: { id: "asc" } });
    expect(depts).toHaveLength(2);
    expect(depts.map((d) => d.name)).toEqual(["技术部", "市场部"]);

    // 每个部门首人（employeeNo 最小）任部门主管
    for (const dept of depts) {
      const emps = await prisma.employee.findMany({
        where: { departmentId: dept.id },
        orderBy: { employeeNo: "asc" },
      });
      expect(emps).toHaveLength(dept.name === "技术部" ? 3 : 2);
      const head = emps[0];
      expect(dept.managerId).toBe(head.id);
      // 其余员工直属主管指向本部门主管
      for (const e of emps.slice(1)) {
        expect(e.managerId).toBe(head.id);
      }
    }

    // 全员账号：用户名=工号、绑定员工、角色身份匹配
    const allEmps = await prisma.employee.findMany();
    expect(allEmps).toHaveLength(5);
    for (const e of allEmps) {
      const acct = await prisma.admin.findUnique({
        where: { employeeId: e.id },
        include: { role: true },
      });
      expect(acct).not.toBeNull();
      expect(acct!.username).toBe(e.employeeNo);
      expect(acct!.displayName).toBe(e.name);
      const isHead = e.managerId === null;
      expect(acct!.role?.key).toBe(isHead ? "DEPT_MANAGER" : "EMPLOYEE");
    }

    // 资产管理员账号：默认流程 n2 角色可解析
    const assetMgr = await prisma.admin.findUnique({
      where: { username: "assetmgr" },
      include: { role: true },
    });
    expect(assetMgr).not.toBeNull();
    expect(assetMgr!.role?.key).toBe("ASSET_MANAGER");
    expect(assetMgr!.isActive).toBe(true);
  });

  it("重复运行幂等跳过，不重复建数据", async () => {
    await bootstrapOrgData([{ name: "技术部", employeeCount: 3 }]);

    const second = await bootstrapOrgData([{ name: "技术部", employeeCount: 3 }]);
    expect(second.skipped).toBe(true);
    expect(second.employees).toBe(0);
    expect(second.admins).toBe(0);

    expect(await prisma.department.count()).toBe(1);
    expect(await prisma.employee.count()).toBe(3);
    expect(await prisma.admin.count()).toBe(4); // 3 员工账号 + 1 资产管理员
  });
});
