/**
 * 设备行操作菜单：不同状态下菜单里出现哪些操作。
 * 这一层是问题①的端到端证据 —— 库存设备必须能点出「分配」。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/actions/lifecycle.actions", () => ({
  returnAssets: vi.fn(),
  scrapAssets: vi.fn(),
  allocateAssets: vi.fn(),
  transferAssets: vi.fn(),
  maintenanceStart: vi.fn(),
  maintenanceComplete: vi.fn(),
}));

vi.mock("@/actions/asset.actions", () => ({
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  getAssets: vi.fn(),
}));

vi.mock("@/actions/excel.actions", () => ({
  exportAssetsToExcel: vi.fn(),
  importAssetsFromExcel: vi.fn(),
}));

vi.mock("@/actions/auto-import.actions", () => ({
  importAssetsFromExcelAuto: vi.fn(),
}));

vi.mock("@/actions/device-template.actions", () => ({
  getDeviceTemplates: vi.fn(),
}));

import { ActionButtons } from "@/app/(main)/assets/asset-list-client";

function makeAsset(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    assetNo: "DN-0001",
    name: "标准办公电脑",
    templateId: 1,
    templateName: "标准办公电脑",
    categoryId: 1,
    categoryName: "笔记本电脑",
    status,
    employeeId: null,
    employeeName: null,
    departmentName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    purchaseDate: null,
    warrantyMonths: null,
    location: null,
    notes: null,
    components: [],
    lifecycleLogs: [],
    ...overrides,
  };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle("更多操作"));
  await waitFor(() => {
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
}

describe("设备行操作菜单", () => {
  it("库存态设备菜单里有「分配」（批量入库后可直接分配）", async () => {
    const user = userEvent.setup();
    render(<ActionButtons asset={makeAsset("IN_STOCK") as never} employees={[]} />);

    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: "分配" })).toBeInTheDocument();
  });

  it("库存态设备不出现「归还」「调拨」「维修完成」（这些要求别的状态）", async () => {
    const user = userEvent.setup();
    render(<ActionButtons asset={makeAsset("IN_STOCK") as never} employees={[]} />);

    await openMenu(user);
    expect(screen.queryByRole("menuitem", { name: "归还" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "调拨" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "维修完成" })).toBeNull();
  });

  it("在用态设备菜单里是归还/调拨/送修/报废，没有分配", async () => {
    const user = userEvent.setup();
    render(<ActionButtons asset={makeAsset("IN_USE", { employeeId: 7 })} employees={[]} />);

    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: "归还" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "调拨" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "送修" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "分配" })).toBeNull();
  });

  it("已报废设备菜单里没有任何操作项", async () => {
    const user = userEvent.setup();
    render(<ActionButtons asset={makeAsset("SCRAPPED") as never} employees={[]} />);

    await openMenu(user);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("打开分配弹窗能看到设备编号、台数与该分类的分配规则", async () => {
    const user = userEvent.setup();
    render(
      <ActionButtons
        asset={makeAsset("IN_STOCK") as never}
        employees={[]}
        categories={[{ id: 1, name: "笔记本电脑", code: "DN", unique: true, parentId: null }]}
      />
    );

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "分配" }));

    // 上下文条：几台 + 编号 + 规则
    expect(await screen.findByText("DN-0001")).toBeInTheDocument();
    expect(screen.getByText("1 台")).toBeInTheDocument();
    expect(screen.getByText("笔记本电脑为「唯一」分类：每人仅限一台")).toBeInTheDocument();
  });
});
