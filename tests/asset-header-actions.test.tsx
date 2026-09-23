/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AssetHeaderActions } from "@/app/(main)/assets/asset-header-actions";

// mock 权限判定，按用例控制返回值
vi.mock("@/hooks/use-permission", () => ({
  usePermission: vi.fn().mockReturnValue(true),
}));
import { usePermission } from "@/hooks/use-permission";

const noop = () => {};

function renderActions() {
  return render(
    <AssetHeaderActions
      hasSelection={false}
      exportLoading={false}
      importLoading={false}
      autoImportLoading={false}
      onCreate={noop}
      onExportAll={noop}
      onExportSelected={noop}
      onImportClick={noop}
      onAutoImportClick={noop}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("设备顶部操作栏 — 细粒度按钮权限门控（f5）", () => {
  it("拥有 create/export 权限时显示导出与新建设备按钮", () => {
    (usePermission as any).mockReturnValue(true);
    renderActions();

    expect(screen.getByRole("button", { name: "新建设备" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 Excel" })).toBeInTheDocument();
  });

  it("无 create/export 权限时不渲染导出与新建设备按钮（导入不受限）", () => {
    (usePermission as any).mockReturnValue(false);
    renderActions();

    expect(screen.queryByRole("button", { name: "新建设备" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出 Excel" })).not.toBeInTheDocument();
    // 导入无对应操作点，登录即可见
    expect(screen.getByRole("button", { name: "导入 Excel" })).toBeInTheDocument();
  });

  it("无选中设备时不显示“导出选中”按钮", () => {
    (usePermission as any).mockReturnValue(true);
    renderActions();

    expect(screen.queryByRole("button", { name: /导出选中/ })).not.toBeInTheDocument();
  });

  it("有选中设备时显示“导出选中”按钮", () => {
    (usePermission as any).mockReturnValue(true);
    render(
      <AssetHeaderActions
        hasSelection={true}
        exportLoading={false}
        importLoading={false}
        autoImportLoading={false}
        onCreate={noop}
        onExportAll={noop}
        onExportSelected={noop}
        onImportClick={noop}
        onAutoImportClick={noop}
      />
    );

    expect(screen.getByRole("button", { name: /导出选中/ })).toBeInTheDocument();
  });
});