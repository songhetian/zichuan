/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AssetHeaderActions } from "@/app/(main)/assets/asset-header-actions";

// key-aware 权限 mock：granted 集合中存在的权限 key 才放行
const authPerms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/hooks/use-permission", () => ({
  usePermission: (key?: string) => !key || authPerms.granted.has(key),
}));

const noop = () => {};

function renderActions(overrides: Partial<React.ComponentProps<typeof AssetHeaderActions>> = {}) {
  return render(
    <AssetHeaderActions
      hasSelection={overrides.hasSelection ?? false}
      exportLoading={false}
      importLoading={false}
      autoImportLoading={false}
      onCreate={noop}
      onExportAll={noop}
      onExportSelected={noop}
      onImportClick={noop}
      onAutoImportClick={noop}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("设备顶部操作栏 — 细粒度按钮权限门控（f5）", () => {
  it("拥有 create/export/import 权限时显示全部操作按钮", () => {
    authPerms.granted = new Set(["asset.device.create", "asset.device.export", "asset.import.execute"]);
    renderActions();

    expect(screen.getByRole("button", { name: "新建设备" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "硬件扫描导入" })).toBeInTheDocument();
  });

  it("无任何操作权限时不渲染导出/新建/导入按钮", () => {
    authPerms.granted = new Set();
    renderActions();

    expect(screen.queryByRole("button", { name: "新建设备" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出 Excel" })).not.toBeInTheDocument();
    // 导入已按 asset.import.execute 门控，无权限时一并隐藏
    expect(screen.queryByRole("button", { name: "导入 Excel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "硬件扫描导入" })).not.toBeInTheDocument();
  });

  it("仅有 create/export 而无 import 权限时隐藏导入相关按钮", () => {
    authPerms.granted = new Set(["asset.device.create", "asset.device.export"]);
    renderActions();

    expect(screen.getByRole("button", { name: "新建设备" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 Excel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入 Excel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "硬件扫描导入" })).not.toBeInTheDocument();
  });

  it("仅有 import 权限时只显示导入相关按钮", () => {
    authPerms.granted = new Set(["asset.import.execute"]);
    renderActions();

    expect(screen.getByRole("button", { name: "导入 Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "硬件扫描导入" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建设备" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出 Excel" })).not.toBeInTheDocument();
  });

  it("无选中设备时不显示“导出选中”按钮", () => {
    authPerms.granted = new Set(["asset.device.create", "asset.device.export", "asset.import.execute"]);
    renderActions({ hasSelection: false });

    expect(screen.queryByRole("button", { name: /导出选中/ })).not.toBeInTheDocument();
  });

  it("有选中设备且拥有 export 权限时显示“导出选中”按钮", () => {
    authPerms.granted = new Set(["asset.device.create", "asset.device.export", "asset.import.execute"]);
    renderActions({ hasSelection: true });

    expect(screen.getByRole("button", { name: /导出选中/ })).toBeInTheDocument();
  });

  it("有选中设备但无 export 权限时仍不显示“导出选中”按钮", () => {
    authPerms.granted = new Set(["asset.import.execute"]);
    renderActions({ hasSelection: true });

    expect(screen.queryByRole("button", { name: /导出选中/ })).not.toBeInTheDocument();
  });
});