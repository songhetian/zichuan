/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AssetQrCode } from "@/components/features/asset-qr-code";

afterEach(() => cleanup());

describe("资产二维码标签", () => {
  it("绘制二维码并展示资产编号文本", () => {
    const { container } = render(<AssetQrCode assetNo="DN-0001" />);
    const box = container.querySelector('[data-testid="asset-qr"]');
    expect(box).toBeInTheDocument();
    // 二维码以 SVG 输出
    expect(box!.querySelector("svg")).toBeInTheDocument();
    // 编号文本同时可见，便于人工核对
    expect(screen.getByText("DN-0001")).toBeInTheDocument();
  });

  it("label=false 时不显示编号文本，仅保留二维码", () => {
    const { container } = render(<AssetQrCode assetNo="WL-0007" label={false} />);
    const box = container.querySelector('[data-testid="asset-qr"]')!;
    expect(box.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByText("WL-0007")).not.toBeInTheDocument();
  });
});