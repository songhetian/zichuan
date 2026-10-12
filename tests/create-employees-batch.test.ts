import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prisma = {
    department: { findUnique: vi.fn() },
    employee: { findMany: vi.fn(), create: vi.fn() },
    role: { findUnique: vi.fn() },
    admin: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  // 事务直接以 prisma 作为 tx 执行（与 createEmployee 相同模式）
  prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
  return { prisma };
});

import { createEmployeesBatch } from "@/actions/employee.actions";
import { setTestUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("createEmployeesBatch 按部门批量生成临时员工", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, username: "admin", permissions: ["system.account.manage"] });
    (prisma.department.findUnique as any).mockResolvedValue({ id: 1, name: "双立人" });
    (prisma.role.findUnique as any).mockResolvedValue({ id: 2, key: "EMPLOYEE", name: "普通员工" });
    (prisma.admin.findUnique as any).mockResolvedValue(null);
    (prisma.employee.create as any).mockImplementation(async ({ data }: any) => ({
      id: Math.floor(Math.random() * 100000),
      createdAt: new Date("2026-10-12T00:00:00.000Z"),
      ...data,
      department: { name: "双立人" },
    }));
    (prisma.employee.findMany as any).mockResolvedValue([{ employeeNo: "EMP0003" }]);
  });
  afterEach(() => setTestUser(null));

  it("按数量生成临时员工：姓名 = 部门名-随机4位数字，同批内不重复，工号自动递增", async () => {
    const result = await createEmployeesBatch({ departmentId: 1, count: 3 });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toHaveLength(3);
    expect(prisma.employee.create).toHaveBeenCalledTimes(3);

    const names = result.data.map((e) => e.name);
    // 姓名 = 部门名-4 位数字
    for (const name of names) {
      expect(name).toMatch(/^双立人-\d{4}$/);
    }
    // 同批内姓名互不相同（随机数可能撞，实现必须去重）
    expect(new Set(names).size).toBe(3);

    // 工号基于现有最大序号自动递增且互不相同
    const nos = result.data.map((e) => e.employeeNo);
    expect(nos).toEqual(["EMP0004", "EMP0005", "EMP0006"]);
  });

  it("同步创建登录账号：登录名 = 工号，displayName = 姓名，首登强制改密", async () => {
    const result = await createEmployeesBatch({ departmentId: 1, count: 2 });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(prisma.admin.create).toHaveBeenCalledTimes(2);
    result.data.forEach((e) => {
      expect(prisma.admin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: e.employeeNo,
            displayName: e.name,
            mustChangePassword: true,
          }),
        })
      );
    });
  });

  it("count 超出范围（0 / 101）时拒绝", async () => {
    const zero = await createEmployeesBatch({ departmentId: 1, count: 0 });
    expect(zero.success).toBe(false);

    const over = await createEmployeesBatch({ departmentId: 1, count: 101 });
    expect(over.success).toBe(false);

    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it("部门不存在时拒绝", async () => {
    (prisma.department.findUnique as any).mockResolvedValue(null);
    const result = await createEmployeesBatch({ departmentId: 999, count: 1 });
    expect(result.success).toBe(false);
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });
});
