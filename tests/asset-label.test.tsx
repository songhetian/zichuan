/**
 * AssetLabel —— 标签打印页的单个标签视觉。
 *
 * 产品约定（2026-10-14 用户要求）：
 *   1. 标签上【只显示设备编号】—— 名称、部门、使用人在列表/详情里看得到，
 *      印到实物标签上只会挤占编号的可读性；
 *   2. 内容【居中】展示 —— 标签是小尺寸实物，居中比左对齐更整齐；
 *   3. 编号要【看得清楚】—— 标签缩小后字号仍要够大，且不能被截断。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AssetLabel,
  CODE_STYLE,
  type AssetLabelData,
} from "@/components/features/asset-label";
import { LABEL_CODE_FONT_CQW } from "@/lib/label-size";

const label: AssetLabelData = {
  id: 1,
  assetNo: "DN-0001",
  name: "联想主机",
  employeeName: "张三",
  departmentName: "技术部",
};

describe("AssetLabel", () => {
  it("展示设备编号", () => {
    render(<AssetLabel label={label} />);

    expect(screen.getByText("DN-0001")).toBeInTheDocument();
  });

  it("不展示名称、使用人与部门", () => {
    render(<AssetLabel label={label} />);

    expect(screen.queryByText("联想主机")).not.toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
    expect(screen.queryByText("技术部")).not.toBeInTheDocument();
  });

  it("编号用等宽 + 特粗字重突出显示", () => {
    render(<AssetLabel label={label} />);
    const no = screen.getByText("DN-0001");

    expect(no.className).toContain("font-mono");
    expect(no.className).toContain("font-black");
  });

  it("标签里只有编号一行文本", () => {
    const { container } = render(<AssetLabel label={label} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.children.length).toBe(1);
    expect(root.textContent?.trim()).toBe("DN-0001");
  });

  it("内容居中：容器纵向/水平居中且文本居中", () => {
    const { container } = render(<AssetLabel label={label} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toContain("items-center");
    expect(root.className).toContain("justify-center");
    expect(root.className).toContain("text-center");
  });

  it("打印版（compact）同样只有编号且居中", () => {
    const { container } = render(<AssetLabel label={label} compact />);
    const root = container.firstElementChild as HTMLElement;

    expect(screen.getByText("DN-0001")).toBeInTheDocument();
    expect(screen.queryByText("联想主机")).not.toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
    expect(screen.queryByText("技术部")).not.toBeInTheDocument();
    expect(root.children.length).toBe(1);
    expect(root.className).toContain("items-center");
    expect(root.className).toContain("justify-center");
    expect(root.className).toContain("text-center");
  });

  it("外层套一圈虚线，内层是实线框", () => {
    const { container } = render(<AssetLabel label={label} />);
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    expect(outer.className).toContain("border-dashed");
    expect(inner.className).toContain("border");
    expect(inner.className).not.toContain("border-dashed");
    expect(inner.textContent?.trim()).toBe("DN-0001");
  });

  it("打印版的外层同样有虚线框", () => {
    const { container } = render(<AssetLabel label={label} compact />);
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    expect(outer.className).toContain("border-dashed");
    expect(inner.className).not.toContain("border-dashed");
  });

  it("外层是 inline-size 容器，编号字号用 cqw 随容器自适应（打印不截断）", () => {
    const preview = render(<AssetLabel label={label} />);
    const previewOuter = preview.container.firstElementChild as HTMLElement;
    const previewNo = preview.getByText("DN-0001") as HTMLElement;
    preview.unmount();

    const print = render(<AssetLabel label={label} compact />);
    const printOuter = print.container.firstElementChild as HTMLElement;
    const printNo = print.getByText("DN-0001") as HTMLElement;

    // 外层声明 container-type: inline-size，cqw 才有参照
    expect(previewOuter.className).toContain("container-type");
    expect(printOuter.className).toContain("container-type");

    // 字号是 cqw 而非固定 px：容器大就大、小就小，永远不会溢出被截断。
    // jsdom 不认识 cqw 单位，渲染后的 DOM 上读不到该声明（React 序列化时
    // 即被丢弃），因此改为断言组件实际导出的样式对象 —— 预览与打印共用。
    expect(CODE_STYLE.fontSize).toBe(`${LABEL_CODE_FONT_CQW}cqw`);
    expect(CODE_STYLE.fontSize).toMatch(/cqw$/);
  });
});
