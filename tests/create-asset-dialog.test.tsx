/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateAssetDialog } from "@/app/(main)/assets/create-asset-dialog";
import { createAsset } from "@/actions/asset.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/actions/asset.actions", () => ({
  createAsset: vi.fn(),
}));

const categories = [
  { id: 10, name: "计算机设备", parentId: null },
  { id: 1, name: "电脑主机", parentId: 10 },
  { id: 2, name: "显示器", parentId: null },
];

const templates = [
  {
    id: 1,
    name: "办公台式机",
    categoryId: 1,
    brand: "戴尔",
    model: "OptiPlex 7010",
    components: [{ modelId: 11, modelName: "i7-12700F", modelBrand: "Intel", quantity: 1 }],
  },
  { id: 2, name: "设计工作站", categoryId: 1, brand: null, model: null, components: [] },
  { id: 3, name: "会议显示器", categoryId: 2, brand: "AOC", model: "Q27G2S", components: [] },
];

const employees = [
  { id: 101, name: "张三", departmentName: "技术部" },
  { id: 102, name: "李四", departmentName: "市场部" },
];

function renderDialog() {
  return render(
    <CreateAssetDialog
      open
      onOpenChange={vi.fn()}
      templates={templates}
      categories={categories}
      employees={employees}
    />
  );
}

function categoryTrigger() {
  return screen.getByRole("combobox", { name: "设备分类" });
}

function employeeTrigger() {
  return screen.getByRole("combobox", { name: "使用人" });
}

function templateTrigger() {
  return screen.getByRole("combobox", { name: "设备模板" });
}

function quantityInput() {
  return screen.getByLabelText("数量");
}

function serialInput() {
  return screen.getByLabelText("序列号");
}

/** 选中一个设备分类（下拉项文案与分类名一致） */
async function pickCategory(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(categoryTrigger());
  await user.click(screen.getByText(name));
}

/** 选中一个设备模板 */
async function pickTemplate(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(templateTrigger());
  await user.click(screen.getByText(name));
}

describe("CreateAssetDialog 设备分类 / 设备模板下拉", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("下拉框内置搜索输入区，可按模板名称模糊过滤", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategory(user, "电脑主机");
    await user.click(templateTrigger());

    // 初始显示该分类下全部模板
    expect(screen.getByText("办公台式机")).toBeInTheDocument();
    expect(screen.getByText("设计工作站")).toBeInTheDocument();

    // 搜索输入区存在（默认占位符）
    const searchInput = screen.getByPlaceholderText("搜索...");
    await user.type(searchInput, "办公");

    await waitFor(() => {
      expect(screen.getByText("办公台式机")).toBeInTheDocument();
      expect(screen.queryByText("设计工作站")).toBeNull();
    });
  });

  it("搜索后选择模板：选中值回填到触发按钮，并显示配置预览", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategory(user, "电脑主机");
    await user.click(templateTrigger());
    const searchInput = screen.getByPlaceholderText("搜索...");
    await user.type(searchInput, "办公");
    await user.click(screen.getByText("办公台式机"));

    // 下拉关闭后触发按钮回显所选模板名
    await waitFor(() => {
      expect(templateTrigger()).toHaveTextContent("办公台式机");
    });
    // 配置预览出现对应配件
    expect(screen.getByText("i7-12700F")).toBeInTheDocument();
    expect(screen.getByText("× 1")).toBeInTheDocument();
  });

  it("触发按钮均为全宽", () => {
    renderDialog();

    expect(categoryTrigger()).toHaveClass("w-full");
    expect(templateTrigger()).toHaveClass("w-full");
  });

  it("分类下拉只列叶子分类，父级分组节点不可选", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(categoryTrigger());

    // 叶子分类可选
    expect(screen.getByText("电脑主机")).toBeInTheDocument();
    expect(screen.getByText("显示器")).toBeInTheDocument();
    // 父级分组节点（有子分类）不可选：挂设备会产出编号正确但语义错误的"垃圾分类"设备
    expect(screen.queryByText("计算机设备")).toBeNull();
  });

  it("模板按所选分类过滤，不跨分类出现", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategory(user, "电脑主机");
    await user.click(templateTrigger());

    expect(screen.getByText("办公台式机")).toBeInTheDocument();
    expect(screen.queryByText("会议显示器")).toBeNull();
  });

  it("切换分类后清空已选模板，避免张冠李戴", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickCategory(user, "电脑主机");
    await pickTemplate(user, "办公台式机");
    await waitFor(() => expect(templateTrigger()).toHaveTextContent("办公台式机"));

    await pickCategory(user, "显示器");

    // 原模板不属于新分类，应被清空并回落到占位提示
    await waitFor(() => {
      expect(templateTrigger()).toHaveTextContent("选择设备模板");
    });
  });

  it("选中模板后自动带出所属分类", async () => {
    const user = userEvent.setup();
    renderDialog();

    // 不先选分类，直接从全部模板中挑「会议显示器」
    await pickTemplate(user, "会议显示器");

    await waitFor(() => {
      expect(categoryTrigger()).toHaveTextContent("显示器");
    });
  });
});

describe("CreateAssetDialog 名称自动生成与批量数量", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("不再显示设备名称输入框（名称由系统维护）", () => {
    renderDialog();

    expect(screen.queryByPlaceholderText("请输入设备名称")).toBeNull();
    expect(screen.queryByText("设备名称")).toBeNull();
  });

  it("模板为必选项：未选模板时拦截提交，不调用创建接口", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(screen.getByText("请选择设备模板")).toBeInTheDocument();
    });
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("数量默认 1，填写 3 后按数量批量创建", async () => {
    const user = userEvent.setup();
    vi.mocked(createAsset).mockResolvedValue({ success: true, data: [] as never });

    renderDialog();

    expect(quantityInput()).toHaveValue(1);

    await pickTemplate(user, "办公台式机");
    await user.clear(quantityInput());
    await user.type(quantityInput(), "3");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(createAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createAsset).mock.calls[0][0]).toMatchObject({
      templateId: 1,
      quantity: 3,
    });
  });

  it("品牌 / 型号不再手填，选中模板后只读展示模板带出的值", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickTemplate(user, "办公台式机");

    // 没有可编辑的品牌 / 型号输入框
    expect(screen.queryByPlaceholderText("选填，如 戴尔")).toBeNull();
    expect(screen.queryByPlaceholderText("选填，如 U2723QE")).toBeNull();
    // 只读展示模板带出的品牌 / 型号，建档时随设备落库
    expect(screen.getByText("品牌：戴尔")).toBeInTheDocument();
    expect(screen.getByText("型号：OptiPlex 7010")).toBeInTheDocument();
  });

  it("数量大于 1 时序列号不可填（一机一号），并清空已填内容", async () => {
    const user = userEvent.setup();
    renderDialog();

    await pickTemplate(user, "办公台式机");
    await user.type(serialInput(), "SN-0001");
    expect(serialInput()).not.toBeDisabled();

    await user.clear(quantityInput());
    await user.type(quantityInput(), "3");

    await waitFor(() => expect(serialInput()).toBeDisabled());
    expect(serialInput()).toHaveValue("");
  });

  it("使用人为选填：不选则不带 employeeId，生成「闲置」设备", async () => {
    const user = userEvent.setup();
    vi.mocked(createAsset).mockResolvedValue({ success: true, data: [] as never });

    renderDialog();
    await pickTemplate(user, "办公台式机");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(createAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createAsset).mock.calls[0][0].employeeId).toBeUndefined();
  });

  it("填了使用人则提交 employeeId，建档即分配", async () => {
    const user = userEvent.setup();
    vi.mocked(createAsset).mockResolvedValue({ success: true, data: [] as never });

    renderDialog();
    await pickTemplate(user, "办公台式机");
    await user.click(employeeTrigger());
    await user.click(screen.getByText("张三（技术部）"));
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(createAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createAsset).mock.calls[0][0]).toMatchObject({
      templateId: 1,
      employeeId: 101,
    });
  });
});
