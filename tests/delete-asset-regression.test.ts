import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 用 mock 替代真实 prisma，无需数据库即可锁定「批量删除 = 真删除」语义
vi.mock("@/lib/prisma", () => {
  const asset = {
    findUnique: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
  };
  const lifecycleLog = { create: vi.fn() };
  return { prisma: { asset, lifecycleLog } };
});

import { deleteAsset } from "@/actions/asset.actions";
import { setTestUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("deleteAsset —— 真删除语义回归", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, username: "admin" });
  });
  afterEach(() => setTestUser(null));

  it("执行硬删除(prisma.asset.delete)，不调用 updateMany(归还)，也不写 RETURNED 日志", async () => {
    (prisma.asset.findUnique as any).mockResolvedValue({ id: 1 });
    (prisma.asset.delete as any).mockResolvedValue({ id: 1 });

    const result = await deleteAsset(1);

    expect(result.success).toBe(true);
    expect(prisma.asset.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    // 归还动作走 updateMany({ status: "IDLE", employeeId: null })，此处必须不出现
    expect(prisma.asset.updateMany).not.toHaveBeenCalled();
    // 真删除不写任何生命周期日志（归还会写 RETURNED）
    expect(prisma.lifecycleLog.create).not.toHaveBeenCalled();
  });

  it("设备不存在时返回失败且不调用 delete", async () => {
    (prisma.asset.findUnique as any).mockResolvedValue(null);

    const result = await deleteAsset(999);

    expect(result.success).toBe(false);
    expect(prisma.asset.delete).not.toHaveBeenCalled();
  });
});
