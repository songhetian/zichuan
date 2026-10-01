/**
 * @vitest-environment jsdom
 *
 * 离职审批的「核对设备」面板（DepartureCheckPanel）。
 *
 * 场景：部门主管/资产管理员打开离职申请单，必须在点「通过」之前看清这名员工名下有哪些设备。
 * 面板就挂在审批操作区上方——「检查完毕 → 再通过」。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepartureCheckPanel } from "@/components/features/departure-check-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const { getDepartureCheckInfoMock, getAssetComponentsMock } = vi.hoisted(() => ({
  getDepartureCheckInfoMock: vi.fn(),
  getAssetComponentsMock: vi.fn(),
}));

vi.mock("@/actions/approval-depart.actions", () => ({
  getDepartureCheckInfo: getDepartureCheckInfoMock,
}));

vi.mock("@/actions/employee.actions", () => ({
  getAssetComponents: getAssetComponentsMock,
}));

const employee = {
  id: 7,
  employeeNo: "EMP0007",
  name: "张三",
  departmentId: 1,
  departmentName: "技术部",
  phone: "13800000000",
  email: "zhangsan@example.com",
  assetCount: 2,
  createdAt: "2025-01-05T00:00:00.000Z",
};

const assets = [
  {
    id: 11,
    assetNo: "ZC-0001",
    name: "MacBook Pro 14",
    status: "IN_USE",
    templateName: "MacBook Pro 14 英寸",
    categoryName: "笔记本电脑",
    location: "北京办公区",
    purchaseDate: "2024-03-01",
    warrantyMonths: 36,
    notes: null,
  },
  {
    id: 12,
    assetNo: "ZC-0002",
    name: "Dell U2723QE",
    status: "IN_MAINTENANCE",
    templateName: "Dell 27 显示器",
    categoryName: "显示器",
    location: null,
    purchaseDate: "2020-01-10",
    warrantyMonths: 12,
    notes: null,
  },
];

describe("离职核对设备面板", () => {
  beforeEach(() => {
    getDepartureCheckInfoMock.mockReset();
    getDepartureCheckInfoMock.mockResolvedValue({
      success: true,
      data: { employee, assets },
    });
    getAssetComponentsMock.mockReset();
    getAssetComponentsMock.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("默认就把「名下几台设备」摆出来，让审批人知道要不要去核对", async () => {
    render(<DepartureCheckPanel requestId={42} />);

    expect(await screen.findByText(/2\s*台/)).toBeInTheDocument();
    expect(getDepartureCheckInfoMock).toHaveBeenCalledWith(42);
  });

  it("点开后在弹窗里看到离职员工身份与名下全部设备（编号 / 名称 / 状态）", async () => {
    const user = userEvent.setup();
    render(<DepartureCheckPanel requestId={42} />);

    await user.click(await screen.findByRole("button", { name: /查看.*设备|核对.*设备/ }));

    // 身份
    expect(await screen.findByText("EMP0007")).toBeInTheDocument();
    expect(screen.getByText("技术部")).toBeInTheDocument();

    // 全部设备（按设备行作用域断言：「在用」「维修中」同时也是概览 KPI 的标签，全局匹配会歧义）
    const rowOf = (assetNo: string) =>
      within(screen.getByText(assetNo).closest("li") as HTMLElement);

    expect(rowOf("ZC-0001").getByText("MacBook Pro 14")).toBeInTheDocument();
    expect(rowOf("ZC-0001").getByText("在用")).toBeInTheDocument();
    expect(rowOf("ZC-0002").getByText("Dell U2723QE")).toBeInTheDocument();
    expect(rowOf("ZC-0002").getByText("维修中")).toBeInTheDocument();
  });

  it("名下没有设备时给出明确文案，而不是留一片空白", async () => {
    const user = userEvent.setup();
    getDepartureCheckInfoMock.mockResolvedValue({
      success: true,
      data: { employee: { ...employee, assetCount: 0 }, assets: [] },
    });
    render(<DepartureCheckPanel requestId={42} />);

    expect(await screen.findByText(/名下暂无设备|名下没有设备/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /查看.*设备|核对.*设备/ }));
    expect(await screen.findByText("该员工名下暂无在用设备")).toBeInTheDocument();
  });

  it("加载失败要出声（role=alert），不能静默留白", async () => {
    getDepartureCheckInfoMock.mockResolvedValue({ success: false, error: "申请单不存在" });
    render(<DepartureCheckPanel requestId={42} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("申请单不存在");
  });

  it("只读核对：弹窗里不得出现任何写操作入口", async () => {
    const user = userEvent.setup();
    render(<DepartureCheckPanel requestId={42} />);

    await user.click(await screen.findByRole("button", { name: /查看.*设备|核对.*设备/ }));
    expect(await screen.findByText("ZC-0001")).toBeInTheDocument();

    for (const label of ["分配", "归还", "调拨", "送修", "报废", "编辑", "删除"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});
