/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateAssetDialog } from "@/app/(main)/assets/create-asset-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/actions/asset.actions", () => ({
  createAsset: vi.fn(),
}));

const templates = [
  {
    id: 1,
    name: "办公笔记本电脑",
    components: [{ modelId: 11, modelName: "i7-12700F", modelBrand: "Intel", quantity: 1 }],
  },
  { id: 2, name: "设计工作站", components: [] },
  { id: 3, name: "会议显示器", components: [] },
];

async function openTemplateDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox"));
}

describe("CreateAssetDialog 设备模板下拉", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("下拉框内置搜索输入区，可按模板名称模糊过滤", async () => {
    const user = userEvent.setup();
    render(<CreateAssetDialog open onOpenChange={vi.fn()} templates={templates} />);

    await openTemplateDropdown(user);
    // 初始显示全部模板
    expect(screen.getByText("办公笔记本电脑")).toBeInTheDocument();
    expect(screen.getByText("设计工作站")).toBeInTheDocument();

    // 搜索输入区存在（占位符带「搜索」后缀）
    const searchInput = screen.getByPlaceholderText("选择设备模板（搜索）");
    await user.type(searchInput, "笔记本");

    await waitFor(() => {
      expect(screen.getByText("办公笔记本电脑")).toBeInTheDocument();
      expect(screen.queryByText("设计工作站")).toBeNull();
      expect(screen.queryByText("会议显示器")).toBeNull();
    });
  });

  it("搜索后选择模板：选中值回填到触发按钮，并显示配置预览", async () => {
    const user = userEvent.setup();
    render(<CreateAssetDialog open onOpenChange={vi.fn()} templates={templates} />);

    await openTemplateDropdown(user);
    const searchInput = screen.getByPlaceholderText("选择设备模板（搜索）");
    await user.type(searchInput, "办公");
    await user.click(screen.getByText("办公笔记本电脑"));

    // 下拉关闭后触发按钮回显所选模板名
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("办公笔记本电脑");
    });
    // 配置预览出现对应配件
    expect(screen.getByText("i7-12700F")).toBeInTheDocument();
    expect(screen.getByText("× 1")).toBeInTheDocument();
  });

  it("触发按钮为全宽，与原设备模板下拉宽度一致", () => {
    render(<CreateAssetDialog open onOpenChange={vi.fn()} templates={templates} />);

    expect(screen.getByRole("combobox")).toHaveClass("w-full");
  });
});
