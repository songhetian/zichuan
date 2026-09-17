import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock prisma，无需数据库即可锁定「分配/归还时同步更新设备名」的行为
vi.mock("@/lib/prisma", () => {
  const prisma = {
    employee: { findUnique: vi.fn() },
    asset: { findMany: vi.fn(), updateMany: vi.fn() },
    deviceTemplate: { findMany: vi.fn() },
    assetCategory: { findMany: vi.fn() },
    lifecycleLog: { createMany: vi.fn() },
    systemLog: { create: vi.fn() },
    $transaction: (fn: (tx: any) => any) => fn(prisma),
  };
  return { prisma };
});

import { allocateAssets, returnAssets, transferAssets } from "@/actions/lifecycle.actions";
import { setTestUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("分配/归还时同步更新设备名", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, username: "admin" });
    (prisma.lifecycleLog.createMany as any).mockResolvedValue({ count: 1 });
    (prisma.systemLog.create as any).mockResolvedValue({});
  });
  afterEach(() => setTestUser(null));

  it("分配时把设备名改为使用人姓名", async () => {
    (prisma.employee.findUnique as any).mockResolvedValue({ id: 5, name: "张三" });
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IDLE", employeeId: null },
    ]);
    (prisma.deviceTemplate.findMany as any).mockResolvedValue([]);
    (prisma.assetCategory.findMany as any).mockResolvedValue([]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await allocateAssets({ assetIds: [1], employeeId: 5, operator: "admin" });

    expect(result.success).toBe(true);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "张三" }),
      })
    );
  });

  it("归还时把设备名改为「闲置」", async () => {
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IN_USE", employeeId: 5 },
    ]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await returnAssets({ assetIds: [1], operator: "admin" });

    expect(result.success).toBe(true);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "闲置" }),
      })
    );
  });

  it("调拨时把设备名改为新使用人姓名", async () => {
    (prisma.employee.findUnique as any).mockResolvedValue({ id: 6, name: "李四" });
    (prisma.asset.findMany as any).mockResolvedValue([
      { id: 1, templateId: 10, status: "IN_USE", employeeId: 5 },
    ]);
    (prisma.deviceTemplate.findMany as any).mockResolvedValue([]);
    (prisma.assetCategory.findMany as any).mockResolvedValue([]);
    (prisma.asset.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await transferAssets({ assetIds: [1], toEmployeeId: 6, operator: "admin" });

    expect(result.success).toBe(true);
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "李四" }),
      })
    );
  });
});
