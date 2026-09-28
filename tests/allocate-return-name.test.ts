import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock prisma，无需数据库即可锁定「分配/归还/调拨时同步更新设备名」的行为
vi.mock("@/lib/prisma", () => {
  const prisma = {
    employee: { findUnique: vi.fn() },
    asset: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    deviceTemplate: { findMany: vi.fn() },
    assetCategory: { findMany: vi.fn() },
    lifecycleLog: { createMany: vi.fn(), create: vi.fn() },
    systemLog: { create: vi.fn() },
    $transaction: (fn: (tx: any) => any) => fn(prisma),
  };
  return { prisma };
});

import {
  allocateAssets,
  returnAssets,
  transferAssets,
} from "@/actions/lifecycle.actions";
import { setTestUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("分配/归还/调拨时同步更新设备名", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
    (prisma.lifecycleLog.createMany as any).mockResolvedValue({ count: 1 });
    (prisma.systemLog.create as any).mockResolvedValue({});
  });
  afterEach(() => setTestUser(null));

  it("分配时把设备名改为「{使用人}的{设备分类}」", async () => {
    (prisma.employee.findUnique as any).mockResolvedValue({ id: 5, name: "张三" });
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IDLE", employeeId: null },
    ]);
    (prisma.deviceTemplate.findMany as any).mockResolvedValue([{ id: 10, categoryId: 100 }]);
    (prisma.assetCategory.findMany as any).mockResolvedValue([
      { id: 100, name: "显示器", unique: false },
    ]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await allocateAssets({ assetIds: [1], employeeId: 5, operator: "admin" });

    expect(result.success).toBe(true);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "张三的显示器" }),
      })
    );
  });

  it("批量分配跨分类设备时，每台按各自分类命名", async () => {
    (prisma.employee.findUnique as any).mockResolvedValue({ id: 5, name: "张三" });
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IDLE", employeeId: null },
      { id: 2, templateId: 11, status: "IDLE", employeeId: null },
    ]);
    (prisma.deviceTemplate.findMany as any).mockResolvedValue([
      { id: 10, categoryId: 100 },
      { id: 11, categoryId: 200 },
    ]);
    (prisma.assetCategory.findMany as any).mockResolvedValue([
      { id: 100, name: "显示器", unique: false },
      { id: 200, name: "笔记本电脑", unique: false },
    ]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await allocateAssets({ assetIds: [1, 2], employeeId: 5, operator: "admin" });

    expect(result.success).toBe(true);
    const names = (prisma.asset.updateMany as any).mock.calls.map(
      (call: any[]) => call[0].data.name
    );
    expect(names).toEqual(["张三的显示器", "张三的笔记本电脑"]);
  });

  it("归还时把设备名改回模板名，并解除使用人", async () => {
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IN_USE", employeeId: 5, template: { name: "办公主机 A" } },
    ]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await returnAssets({ assetIds: [1], operator: "admin" });

    expect(result.success).toBe(true);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "办公主机 A",
          status: "IDLE",
          employeeId: null,
        }),
      })
    );
  });

  it("调拨时把设备名改为「{新使用人}的{设备分类}」", async () => {
    (prisma.employee.findUnique as any).mockResolvedValue({ id: 6, name: "李四" });
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IN_USE", employeeId: 5 },
    ]);
    (prisma.deviceTemplate.findMany as any).mockResolvedValue([{ id: 10, categoryId: 100 }]);
    (prisma.assetCategory.findMany as any).mockResolvedValue([
      { id: 100, name: "显示器", unique: false },
    ]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await transferAssets({ assetIds: [1], toEmployeeId: 6, operator: "admin" });

    expect(result.success).toBe(true);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "李四的显示器" }),
      })
    );
  });
});
