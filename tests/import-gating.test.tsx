/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelsClient } from "@/app/(main)/components/models/models-client";
import { StocktakeDetailClient } from "@/app/(main)/stocktake/[id]/stocktake-detail-client";
import { SettingsClient } from "@/app/(main)/settings/settings-client";

// key-aware 权限 mock：granted 集合中的权限 key 才放行
const authPerms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/hooks/use-permission", () => ({
  usePermission: (key?: string) => !key || authPerms.granted.has(key),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// 各组件用到的 server action：仅校验按钮门控，不真正触发
vi.mock("@/actions/component-model.actions", () => ({
  createComponentModel: vi.fn(),
  deleteComponentModel: vi.fn(),
  updateComponentModel: vi.fn(),
}));
vi.mock("@/actions/component-stock.actions", () => ({
  purchaseStockIn: vi.fn(),
}));
vi.mock("@/actions/excel.actions", () => ({
  exportComponentsToExcel: vi.fn(),
  importComponentModelsFromExcel: vi.fn(),
  exportAssetsToExcel: vi.fn(),
  exportEmployeesToExcel: vi.fn(),
}));
vi.mock("@/actions/department.actions", () => ({
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
}));
vi.mock("@/actions/asset-category.actions", () => ({
  createAssetCategory: vi.fn(),
  updateAssetCategory: vi.fn(),
  deleteAssetCategory: vi.fn(),
}));
vi.mock("@/actions/component-category.actions", () => ({
  createComponentCategory: vi.fn(),
  updateComponentCategory: vi.fn(),
  deleteComponentCategory: vi.fn(),
}));
vi.mock("@/actions/auth.actions", () => ({
  changePassword: vi.fn(),
}));
vi.mock("@/actions/stocktake.actions", () => ({
  updateStocktakeRecord: vi.fn(),
  completeStocktakeSession: vi.fn(),
  getStocktakeSessionById: vi.fn(),
  importStocktakeFile: vi.fn(),
  exportStocktakeAbnormal: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("导入按钮前端门控（与后端权限 key 对齐）", () => {
  it("models：有 asset.component.create 时显示「导入 Excel」", () => {
    authPerms.granted = new Set(["asset.component.create"]);
    render(<ModelsClient models={[]} categories={[]} />);
    expect(screen.getByRole("button", { name: "导入 Excel" })).toBeInTheDocument();
  });

  it("models：无 asset.component.create 时隐藏「导入 Excel」（新建/导出仍可见）", () => {
    authPerms.granted = new Set();
    render(<ModelsClient models={[]} categories={[]} />);
    expect(screen.queryByRole("button", { name: "导入 Excel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建配件型号" })).toBeInTheDocument();
  });

  it("stocktake：有 asset.manage 时显示「选择 Excel 并上传」", () => {
    authPerms.granted = new Set(["asset.manage"]);
    render(<StocktakeDetailClient session={{ id: 1, name: "月度盘点", description: null, status: "OPEN", startedAt: new Date(), completedAt: null }} records={[]} />);
    expect(screen.getByRole("button", { name: "选择 Excel 并上传" })).toBeInTheDocument();
  });

  it("stocktake：无 asset.manage 时隐藏「选择 Excel 并上传」", () => {
    authPerms.granted = new Set();
    render(<StocktakeDetailClient session={{ id: 1, name: "月度盘点", description: null, status: "OPEN", startedAt: new Date(), completedAt: null }} records={[]} />);
    expect(screen.queryByRole("button", { name: "选择 Excel 并上传" })).not.toBeInTheDocument();
  });

  it("settings：有 employee.import + asset.component.create 时显示两个导入按钮", async () => {
    const user = userEvent.setup();
    authPerms.granted = new Set(["employee.import", "asset.component.create"]);
    render(<SettingsClient initialDepartments={[]} initialAssetCategories={[]} initialComponentCategories={[]} />);

    await user.click(screen.getByRole("tab", { name: "数据导入导出" }));
    expect(screen.getByRole("button", { name: "导入员工" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入配件型号" })).toBeInTheDocument();
  });

  it("settings：无导入权限时隐藏两个导入按钮（导出不受限）", async () => {
    const user = userEvent.setup();
    authPerms.granted = new Set();
    render(<SettingsClient initialDepartments={[]} initialAssetCategories={[]} initialComponentCategories={[]} />);

    await user.click(screen.getByRole("tab", { name: "数据导入导出" }));
    expect(screen.queryByRole("button", { name: "导入员工" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入配件型号" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出员工列表" })).toBeInTheDocument();
  });

  it("settings：仅有 employee.import 时只显示「导入员工」", async () => {
    const user = userEvent.setup();
    authPerms.granted = new Set(["employee.import"]);
    render(<SettingsClient initialDepartments={[]} initialAssetCategories={[]} initialComponentCategories={[]} />);

    await user.click(screen.getByRole("tab", { name: "数据导入导出" }));
    expect(screen.getByRole("button", { name: "导入员工" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入配件型号" })).not.toBeInTheDocument();
  });
});