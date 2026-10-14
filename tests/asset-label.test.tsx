/**
 * AssetLabel —— 标签打印页的单个标签视觉。
 *
 * 两条产品约定（2026-10-14 用户要求）：
 *   1. 标签上【不显示部门】—— 部门在设备列表里看得到，打印到实物标签上属于噪声；
 *   2. 内容【居中】展示 —— 标签是小尺寸实物，居中比左对齐更整齐。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetLabel, type AssetLabelData } from "@/components/features/asset-label";

const label: AssetLabelData = {
  id: 1,
  assetNo: "DN-0001",
  name: "张三的电脑主机",
  employeeName: "张三",
  departmentName: "技术部",
};

describe("AssetLabel", () => {
  it("展示设备编号、名称与使用人", () => {
    render(<AssetLabel label={label} />);

    expect(screen.getByText("DN-0001")).toBeInTheDocument();
    expect(screen.getByText("张三的电脑主机")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("不展示部门", () => {
    render(<AssetLabel label={label} />);

    expect(screen.queryByText("技术部")).not.toBeInTheDocument();
  });

  it("未分配使用人时显示占位文案", () => {
    render(<AssetLabel label={{ ...label, employeeName: "" }} />);

    expect(screen.getByText("未分配")).toBeInTheDocument();
  });

  it("内容居中：容器纵向排列且水平居中、文本居中", () => {
    const { container } = render(<AssetLabel label={label} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toContain("items-center");
    expect(root.className).toContain("justify-center");
    expect(root.className).toContain("text-center");
  });

  it("打印版（compact）同样不显示部门且居中", () => {
    const { container } = render(<AssetLabel label={label} compact />);
    const root = container.firstElementChild as HTMLElement;

    expect(screen.queryByText("技术部")).not.toBeInTheDocument();
    expect(root.className).toContain("items-center");
    expect(root.className).toContain("text-center");
  });
});
