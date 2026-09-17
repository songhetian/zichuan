import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prisma = {
    department: { findUnique: vi.fn() },
    employee: { findMany: vi.fn(), create: vi.fn() },
  };
  return { prisma };
});

import { createEmployee } from "@/actions/employee.actions";
import { setTestUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("createEmployee 工号自动生成", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, username: "admin" });
    (prisma.department.findUnique as any).mockResolvedValue({ id: 1, name: "技术部" });
    (prisma.employee.create as any).mockImplementation(async ({ data }: any) => ({
      id: 1,
      // formatEmployee 会读 createdAt（列表新增「创建时间」列），mock 必须提供
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ...data,
      department: { name: "技术部" },
    }));
  });
  afterEach(() => setTestUser(null));

  it("不传工号时按现有最大序号自动生成", async () => {
    (prisma.employee.findMany as any).mockResolvedValue([
      { employeeNo: "EMP0001" },
      { employeeNo: "EMP0003" },
    ]);

    const result = await createEmployee({ name: "张三", departmentId: 1 });

    expect(result.success).toBe(true);
    expect(prisma.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeNo: "EMP0004" }),
      })
    );
  });

  it("显式传工号时原样使用，不再查询现有工号", async () => {
    const result = await createEmployee({
      employeeNo: "CUSTOM-01",
      name: "李四",
      departmentId: 1,
    });

    expect(result.success).toBe(true);
    expect(prisma.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeNo: "CUSTOM-01" }),
      })
    );
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });
});
