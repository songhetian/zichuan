/**
 * @vitest-environment jsdom
 *
 * 分页稳定性回归：凡是「翻到第 2 页后父级重渲染就被打回第 1 页」的页面，
 * 根因都是把 data 内联派生（filter/map/slice 产生新数组引用）传给 DataTable，
 * 触发 TanStack autoResetPageIndex。本文件覆盖全部客户端分页页面。
 *
 * 语义约定：data 引用稳定 = 「结果集真的变了」；
 * 筛选/搜索变化回到第 1 页是正确行为，不在此抑制。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-permission", () => ({
  usePermission: () => true,
}));

vi.mock("@/actions/asset.actions", () => ({
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  createAsset: vi.fn(),
  getAssetById: vi.fn(),
  getAssets: vi.fn(),
}));

vi.mock("@/actions/lifecycle.actions", () => ({
  returnAssets: vi.fn(),
  scrapAssets: vi.fn(),
  allocateAssets: vi.fn(),
  allocateAssetsBatch: vi.fn(),
  transferAssets: vi.fn(),
  maintenanceStart: vi.fn(),
  maintenanceComplete: vi.fn(),
  adjustAssetComponents: vi.fn(),
}));

vi.mock("@/actions/excel.actions", () => ({
  exportAssetsToExcel: vi.fn(),
  importAssetsFromExcel: vi.fn(),
  exportComponentsToExcel: vi.fn(),
  importComponentModelsFromExcel: vi.fn(),
}));

vi.mock("@/actions/auto-import.actions", () => ({
  importAssetsFromExcelAuto: vi.fn(),
}));

vi.mock("@/actions/device-template.actions", () => ({
  getDeviceTemplates: vi.fn(),
}));

vi.mock("@/actions/employee.actions", () => ({
  getEmployees: vi.fn(),
}));

vi.mock("@/actions/component-model.actions", () => ({
  getComponentModels: vi.fn(),
  createComponentModel: vi.fn(),
  deleteComponentModel: vi.fn(),
  updateComponentModel: vi.fn(),
}));

vi.mock("@/actions/component-stock.actions", () => ({
  purchaseStockIn: vi.fn(),
  getStockLogs: vi.fn(),
}));

import { AssetListClient } from "@/app/(main)/assets/asset-list-client";
import { ComponentListClient } from "@/app/(main)/components/component-list-client";
import { ModelsClient } from "@/app/(main)/components/models/models-client";
import { PurchaseRecordsClient } from "@/app/(main)/components/purchase/purchase-records-client";

afterEach(() => {
  cleanup();
});

const departments = [{ id: 1, name: "技术部" }];

function makeAssets() {
  // 25 台设备，createdAt 各不相同；默认 createdAt 倒序 → 第 1 页 = ZC-0025..0016
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return {
      id: n,
      assetNo: `ZC-${String(n).padStart(4, "0")}`,
      name: `设备${String(n).padStart(2, "0")}`,
      templateId: 1,
      templateName: "台式机",
      categoryId: 1,
      categoryName: "台式机",
      status: "IDLE",
      employeeId: null,
      employeeName: null,
      departmentName: null,
      brand: null,
      model: null,
      serialNo: null,
      createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
      purchaseDate: null,
      warrantyMonths: null,
      location: null,
      notes: null,
      components: [],
      lifecycleLogs: [],
    };
  });
}

const categories = [
  { id: 1, name: "台式机", code: "PC", unique: false, parentId: null },
];
const employees: never[] = [];

describe("设备管理：分页停留在当前页", () => {
  it("翻到第 2 页后，父级重渲染（toast 关闭等，props 引用不变）不打回第 1 页", async () => {
    const user = userEvent.setup();
    // props 引用保持不变 —— 模拟真实世界的重渲染源：toast 自动关闭、
    // 权限后置加载、RSC 对比刷新。此时内联 filter 仍会产生新数组 → 打回第 1 页；
    // useMemo 后引用稳定 → 停在当前页。
    const assets = makeAssets();
    const templates: never[] = [];
    const { rerender } = render(
      <AssetListClient
        assets={assets}
        templates={templates}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );

    expect(screen.getByText("ZC-0025")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("ZC-0015")).toBeInTheDocument();

    rerender(
      <AssetListClient
        assets={assets}
        templates={templates}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );
    // TanStack 的重置排在微任务里，必须刷新后才断言（同步断言会假通过）
    await act(async () => {});

    expect(screen.getByText("ZC-0015")).toBeInTheDocument();
    expect(screen.queryByText("ZC-0025")).toBeNull();
  });

  it("RSC 重新下发同内容数据（新数组、新行对象）也不打回第 1 页", async () => {
    const user = userEvent.setup();
    // 行对象含嵌套数组（components/lifecycleLogs）→ TanStack 浅比较识别不了
    // 「新对象、同内容」。服务端每次刷新都重新序列化，若直接把新行对象喂给
    // DataTable，用户翻页后会被 router.refresh() 打回第 1 页。
    const { rerender } = render(
      <AssetListClient
        assets={makeAssets()}
        templates={[]}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );

    expect(screen.getByText("ZC-0025")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("ZC-0015")).toBeInTheDocument();

    // 同内容、全新对象（等价于 RSC refresh 后服务端重新下发）
    rerender(
      <AssetListClient
        assets={makeAssets()}
        templates={[]}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );
    await act(async () => {});

    expect(screen.getByText("ZC-0015")).toBeInTheDocument();
    expect(screen.queryByText("ZC-0025")).toBeNull();
  });

  it("数据真的变化时渲染新内容（缓存不得吞掉更新）", async () => {
    const user = userEvent.setup();
    const v1 = makeAssets();
    const v2 = makeAssets().map((a) =>
      a.id === 20 ? { ...a, status: "IN_USE", employeeName: "张三" } : a
    );
    const { rerender } = render(
      <AssetListClient
        assets={v1}
        templates={[]}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );

    await user.click(screen.getByRole("button", { name: "第 2 页" }));

    // 内容变化 → 允许重算；用搜索验证新字段真的生效（而非命中旧缓存）
    rerender(
      <AssetListClient
        assets={v2}
        templates={[]}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );
    await act(async () => {});

    await user.type(screen.getByPlaceholderText(/搜索/i), "张三");

    expect(screen.getByText("ZC-0020")).toBeInTheDocument();
  });

  it("搜索条件变化时回到第 1 页（不停在可能已不存在的页码）", async () => {
    const user = userEvent.setup();
    render(
      <AssetListClient
        assets={makeAssets()}
        templates={[]}
        categories={categories}
        employees={employees}
        departments={departments}
      />
    );

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("ZC-0015")).toBeInTheDocument();

    // 关键词变化 → 结果集变化 → 应回到第 1 页
    await user.type(screen.getByPlaceholderText(/搜索/i), "设备25");

    expect(screen.getByText("ZC-0025")).toBeInTheDocument();
    expect(screen.queryByText("ZC-0015")).toBeNull();
  });
});

// ============================================================
// 配件型号管理
// ============================================================

const compCategories = [{ id: 1, name: "CPU", parentId: null }];

function makeModels() {
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return {
      id: n,
      name: `型号${String(n).padStart(2, "0")}`,
      brand: "Intel",
      categoryId: 1,
      stock: 10,
    };
  });
}

describe("配件型号：分页停留在当前页", () => {
  // 该页无 defaultSorting → 数据序：第 1 页 = 型号01-10，第 2 页 = 型号11-20
  it("翻到第 2 页后，父级重渲染（props 引用不变）不打回第 1 页", async () => {
    const user = userEvent.setup();
    const models = makeModels();
    const { rerender } = render(
      <ComponentListClient models={models} categories={compCategories} />
    );

    expect(screen.getByText("型号10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("型号20")).toBeInTheDocument();

    rerender(<ComponentListClient models={models} categories={compCategories} />);
    await act(async () => {});

    expect(screen.getByText("型号20")).toBeInTheDocument();
    expect(screen.queryByText("型号10")).toBeNull();
  });

  it("搜索条件变化时回到第 1 页", async () => {
    const user = userEvent.setup();
    render(<ComponentListClient models={makeModels()} categories={compCategories} />);

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("型号20")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("搜索型号名称、品牌..."), "型号10");

    expect(screen.getByText("型号10")).toBeInTheDocument();
    expect(screen.queryByText("型号20")).toBeNull();
  });
});

// ============================================================
// 配件型号管理（models）—— 排序键 id 非访问列，实序展示：第 1 页 = 型号01-10
// ============================================================

describe("配件型号管理：分页停留在当前页", () => {
  it("翻到第 2 页后，父级重渲染（props 引用不变）不打回第 1 页", async () => {
    const user = userEvent.setup();
    const models = makeModels();
    const { rerender } = render(
      <ModelsClient models={models} categories={compCategories} />
    );

    expect(screen.getByText("型号10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("型号20")).toBeInTheDocument();

    rerender(<ModelsClient models={models} categories={compCategories} />);
    await act(async () => {});

    expect(screen.getByText("型号20")).toBeInTheDocument();
    expect(screen.queryByText("型号10")).toBeNull();
  });

  it("搜索条件变化时回到第 1 页", async () => {
    const user = userEvent.setup();
    render(<ModelsClient models={makeModels()} categories={compCategories} />);

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("型号20")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("搜索型号名称、品牌或分类"), "型号10");

    expect(screen.getByText("型号10")).toBeInTheDocument();
    expect(screen.queryByText("型号20")).toBeNull();
  });
});

// ============================================================
// 采购记录 —— 双层分页：外层 PagePagination 是 React state（重渲染天然保留），
// 内层 DataTable 只装 ≤10 条（单内部页，autoReset 重置不可见）。本测试锁住该行为。
// ============================================================

function makePurchases() {
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return {
      id: n,
      orderNo: `PO-2026${String(n).padStart(4, "0")}`,
      requestNo: `AP-2026${String(n).padStart(4, "0")}`,
      modelName: `采购型号${String(n).padStart(2, "0")}`,
      categoryName: "办公耗材",
      quantity: 2,
      unitPrice: "10.00",
      amount: "20.00",
      initiatorName: "张三",
      createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    };
  });
}

describe("采购记录：分页停留在当前页", () => {
  it("外层翻到第 2 页后，父级重渲染（props 引用不变）不打回第 1 页", async () => {
    const user = userEvent.setup();
    const initialItems = makePurchases();
    const { rerender } = render(
      <PurchaseRecordsClient initialItems={initialItems} categories={[]} />
    );

    expect(screen.getByText("采购型号10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("采购型号20")).toBeInTheDocument();

    rerender(
      <PurchaseRecordsClient initialItems={initialItems} categories={[]} />
    );
    await act(async () => {});

    expect(screen.getByText("采购型号20")).toBeInTheDocument();
  });
});
