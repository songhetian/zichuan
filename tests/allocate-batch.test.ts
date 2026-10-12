import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock prisma：无需数据库即可锁定「批量分配（严格 1:1）」的事务语义与结构化报错
vi.mock("@/lib/prisma", () => {
  const prisma = {
    employee: { findMany: vi.fn() },
    asset: { findMany: vi.fn(), updateMany: vi.fn() },
    deviceTemplate: { findMany: vi.fn() },
    assetCategory: { findMany: vi.fn() },
    lifecycleLog: { createMany: vi.fn() },
    systemLog: { create: vi.fn() },
    $transaction: (fn: (tx: any) => any) => fn(prisma),
  };
  return { prisma };
});

import { allocateAssetsBatch } from "@/actions/lifecycle.actions";
import { setTestUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface AssetRow {
  id: number;
  assetNo: string;
  templateId: number;
  status: string;
  employeeId: number | null;
}

interface EmployeeRow {
  id: number;
  name: string;
  status: string;
}

/** 把 mock 的返回值按「调用形态」分流 —— 同一个 asset.findMany 有 3 种 where 形态 */
function wireDb(config: {
  assets: AssetRow[];
  employees?: EmployeeRow[];
  templates?: { id: number; categoryId: number }[];
  categories?: { id: number; name: string; unique: boolean }[];
  held?: { id: number; assetNo: string; employeeId: number | null; template: { categoryId: number } }[];
  offenders?: { id: number }[];
  updateCounts?: number[];
}) {
  (prisma.asset.findMany as any).mockImplementation(async (args: any) => {
    // 1) 按 id 取本批次设备
    if (args?.where?.id?.in) return config.assets;
    // 2) 事务内的 R4 兜底查询（where 里带 template）
    if (args?.where?.template) return config.offenders ?? [];
    // 3) 目标员工当前持有的设备
    return config.held ?? [];
  });
  (prisma.employee.findMany as any).mockResolvedValue(
    config.employees ?? [
      { id: 5, name: "张三", status: "ACTIVE" },
      { id: 6, name: "李四", status: "ACTIVE" },
    ]
  );
  (prisma.deviceTemplate.findMany as any).mockResolvedValue(
    config.templates ?? [
      { id: 10, categoryId: 100 },
      { id: 11, categoryId: 200 },
    ]
  );
  (prisma.assetCategory.findMany as any).mockResolvedValue(
    config.categories ?? [
      { id: 100, name: "笔记本电脑", unique: true },
      { id: 200, name: "显示器", unique: false },
    ]
  );
  (prisma.lifecycleLog.createMany as any).mockResolvedValue({ count: 1 });
  (prisma.systemLog.create as any).mockResolvedValue({});

  const counts = config.updateCounts ?? [1, 1];
  let call = 0;
  (prisma.asset.updateMany as any).mockImplementation(async () => ({
    count: counts[call++] ?? 1,
  }));
}

const idleAsset = (over: Partial<AssetRow> & { id: number }): AssetRow => ({
  assetNo: `DN-${String(over.id).padStart(4, "0")}`,
  templateId: 10,
  status: "IDLE",
  employeeId: null,
  ...over,
});

describe("allocateAssetsBatch：严格 1:1 的批量分配", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });
  afterEach(() => setTestUser(null));

  it("每台设备按各自的使用人命名，并各自落一条生命周期日志", async () => {
    wireDb({
      assets: [
        idleAsset({ id: 1, templateId: 10 }),
        idleAsset({ id: 2, templateId: 11 }),
      ],
    });

    const result = await allocateAssetsBatch({
      pairs: [
        { assetId: 1, employeeId: 5 },
        { assetId: 2, employeeId: 6 },
      ],
      operator: "admin",
      remark: "批量分配",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.allocatedCount).toBe(2);

    const updates = (prisma.asset.updateMany as any).mock.calls.map((c: any[]) => c[0]);
    expect(updates).toEqual([
      expect.objectContaining({
        where: { id: 1, status: "IDLE" },
        data: expect.objectContaining({ status: "IN_USE", employeeId: 5, name: "张三的笔记本电脑" }),
      }),
      expect.objectContaining({
        where: { id: 2, status: "IDLE" },
        data: expect.objectContaining({ status: "IN_USE", employeeId: 6, name: "李四的显示器" }),
      }),
    ]);

    const logData = (prisma.lifecycleLog.createMany as any).mock.calls[0][0].data;
    expect(logData).toEqual([
      expect.objectContaining({ assetId: 1, employeeId: 5, action: "ALLOCATED", toStatus: "IN_USE" }),
      expect.objectContaining({ assetId: 2, employeeId: 6, action: "ALLOCATED", toStatus: "IN_USE" }),
    ]);
  });

  it("设备非闲置 → 整批不生效，并指出具体是哪一台", async () => {
    wireDb({
      assets: [
        idleAsset({ id: 1 }),
        idleAsset({ id: 2, status: "IN_USE", employeeId: 9 }),
      ],
    });

    const result = await allocateAssetsBatch({
      pairs: [
        { assetId: 1, employeeId: 5 },
        { assetId: 2, employeeId: 6 },
      ],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ assetId: 2, employeeId: 6 });
    expect(result.conflicts[0].reason).toContain("DN-0002");
    expect(prisma.asset.updateMany).not.toHaveBeenCalled();
  });

  it("目标员工已离职 → 整批不生效", async () => {
    wireDb({
      assets: [idleAsset({ id: 1 })],
      employees: [{ id: 5, name: "赵敏", status: "LEFT" }],
    });

    const result = await allocateAssetsBatch({
      pairs: [{ assetId: 1, employeeId: 5 }],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.conflicts[0].reason).toContain("赵敏");
    expect(result.conflicts[0].reason).toContain("已离职");
  });

  it("唯一分类且员工已持有 → 报出持有的是哪一台", async () => {
    wireDb({
      assets: [idleAsset({ id: 1, templateId: 10 })],
      employees: [{ id: 5, name: "张三", status: "ACTIVE" }],
      held: [{ id: 91, assetNo: "DN-0091", employeeId: 5, template: { categoryId: 100 } }],
    });

    const result = await allocateAssetsBatch({
      pairs: [{ assetId: 1, employeeId: 5 }],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.conflicts[0].reason).toContain("笔记本电脑");
    expect(result.conflicts[0].reason).toContain("DN-0091");
    expect(prisma.asset.updateMany).not.toHaveBeenCalled();
  });

  it("唯一分类但员工没持有 → 放行（不能过度拦截）", async () => {
    wireDb({
      assets: [idleAsset({ id: 1, templateId: 10 })],
      employees: [{ id: 5, name: "张三", status: "ACTIVE" }],
      held: [{ id: 91, assetNo: "DN-0091", employeeId: 6, template: { categoryId: 100 } }],
    });

    const result = await allocateAssetsBatch({
      pairs: [{ assetId: 1, employeeId: 5 }],
      operator: "admin",
    });

    expect(result.success).toBe(true);
  });

  it("同一台设备被指定两次 → 直接拒绝，不查库", async () => {
    wireDb({ assets: [idleAsset({ id: 1 })] });

    const result = await allocateAssetsBatch({
      pairs: [
        { assetId: 1, employeeId: 5 },
        { assetId: 1, employeeId: 6 },
      ],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("同一台设备");
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it("同一位员工被指定两台设备 → 直接拒绝，不查库", async () => {
    wireDb({ assets: [idleAsset({ id: 1 }), idleAsset({ id: 2 })] });

    const result = await allocateAssetsBatch({
      pairs: [
        { assetId: 1, employeeId: 5 },
        { assetId: 2, employeeId: 5 },
      ],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("同一位员工");
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it("并发抢走（更新条数不足）→ 整批回滚并明确说「未生效」", async () => {
    wireDb({
      assets: [idleAsset({ id: 1 }), idleAsset({ id: 2 })],
      updateCounts: [1, 0],
    });

    const result = await allocateAssetsBatch({
      pairs: [
        { assetId: 1, employeeId: 5 },
        { assetId: 2, employeeId: 6 },
      ],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("未生效");
    expect(prisma.lifecycleLog.createMany).not.toHaveBeenCalled();
  });

  it("事务内 R4 兜底命中 → 整批回滚并说明唯一性约束", async () => {
    wireDb({
      assets: [idleAsset({ id: 1, templateId: 10 })],
      employees: [{ id: 5, name: "张三", status: "ACTIVE" }],
      offenders: [{ id: 999 }],
      updateCounts: [1],
    });

    const result = await allocateAssetsBatch({
      pairs: [{ assetId: 1, employeeId: 5 }],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("唯一性约束");
    expect(result.error).toContain("未生效");
    expect(prisma.asset.updateMany).not.toHaveBeenCalled();
  });

  it("无 asset.manage 权限 → 拒绝", async () => {
    setTestUser({ id: 1, username: "viewer", permissions: [] });
    wireDb({ assets: [idleAsset({ id: 1 })] });

    const result = await allocateAssetsBatch({
      pairs: [{ assetId: 1, employeeId: 5 }],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.conflicts).toEqual([]);
    expect(prisma.asset.findMany).not.toHaveBeenCalled();
  });

  it("员工不存在 → 拒绝", async () => {
    wireDb({
      assets: [idleAsset({ id: 1 })],
      employees: [{ id: 5, name: "张三", status: "ACTIVE" }],
    });

    const result = await allocateAssetsBatch({
      pairs: [
        { assetId: 1, employeeId: 5 },
        { assetId: 2, employeeId: 6 },
      ],
      operator: "admin",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("员工不存在");
  });

  it("空配对 → 参数校验拦下", async () => {
    wireDb({ assets: [] });

    const result = await allocateAssetsBatch({ pairs: [], operator: "admin" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.conflicts).toEqual([]);
  });
});
