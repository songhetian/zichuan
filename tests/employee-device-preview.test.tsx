/**
 * @vitest-environment jsdom
 *
 * 员工在用设备预览页（/employees/[id]）。
 * 这是「查看某员工名下全部在用设备」的独立只读页，与设备管理里的资产详情页无关，不复用其组件。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeDevicePreview } from "@/components/features/employee-device-preview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const { getAssetComponentsMock } = vi.hoisted(() => ({ getAssetComponentsMock: vi.fn() }));
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

describe("员工在用设备预览页", () => {
  beforeEach(() => {
    getAssetComponentsMock.mockReset();
    getAssetComponentsMock.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    cleanup();
  });

  /** 按资产编号定位到那一行（避免 KPI 与卡片上同名标签互相干扰） */
  const rowOf = (assetNo: string) =>
    within(screen.getByText(assetNo).closest("li") as HTMLElement);

  it("展示员工身份与名下全部在用设备", () => {
    render(<EmployeeDevicePreview employee={employee} assets={assets} />);

    // 身份
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("张三");
    expect(screen.getByText("EMP0007")).toBeInTheDocument();
    expect(screen.getByText("技术部")).toBeInTheDocument();

    // 名下设备全部列出（编号 + 名称 + 状态）
    expect(rowOf("ZC-0001").getByText("MacBook Pro 14")).toBeInTheDocument();
    expect(rowOf("ZC-0001").getByText("在用")).toBeInTheDocument();

    expect(rowOf("ZC-0002").getByText("Dell U2723QE")).toBeInTheDocument();
    expect(rowOf("ZC-0002").getByText("维修中")).toBeInTheDocument();
  });

  it("每台设备提供进入资产详情的只读入口", () => {
    render(<EmployeeDevicePreview employee={employee} assets={assets} />);

    expect(rowOf("ZC-0001").getByRole("link", { name: "资产详情" })).toHaveAttribute(
      "href",
      "/assets/11"
    );
    expect(rowOf("ZC-0002").getByRole("link", { name: "资产详情" })).toHaveAttribute(
      "href",
      "/assets/12"
    );
  });

  it("按采购日期 + 保修月数给出保修结论，而不是只堆原始字段", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    try {
      render(<EmployeeDevicePreview employee={employee} assets={assets} />);

      // 2024-03-01 + 36 个月 = 2027-03-01 → 仍在保
      expect(rowOf("ZC-0001").getByText("在保")).toBeInTheDocument();
      expect(rowOf("ZC-0001").getByText(/剩 \d+ 天/)).toBeInTheDocument();

      // 2020-01-10 + 12 个月 = 2021-01-10 → 已过保
      expect(rowOf("ZC-0002").getByText("已过保")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("名下没有设备时给出空态说明，而不是留一片空白", () => {
    render(<EmployeeDevicePreview employee={employee} assets={[]} />);

    expect(screen.getByText("该员工名下暂无在用设备")).toBeInTheDocument();
  });

  it("给出设备概览：总数、状态分布与保修风险", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    try {
      render(<EmployeeDevicePreview employee={employee} assets={assets} />);

      const overview = screen.getByRole("region", { name: "设备概览" });
      const item = (label: string) =>
        within(overview).getByText(label).closest("div") as HTMLElement;

      expect(item("名下设备")).toHaveTextContent(/2\s*台/);
      expect(item("在用")).toHaveTextContent(/1\s*台/);
      expect(item("维修中")).toHaveTextContent(/1\s*台/);
      expect(item("已过保")).toHaveTextContent(/1\s*台/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("点开某台设备才按需拉取并展示配件明细", async () => {
    getAssetComponentsMock.mockResolvedValue({
      success: true,
      data: [{ modelName: "三星 DDR5 16G", modelBrand: "三星", categoryName: "内存", quantity: 2 }],
    });
    const user = userEvent.setup();
    render(<EmployeeDevicePreview employee={employee} assets={assets} />);

    // 未展开前不请求配件（避免一次性 N 次查询）
    expect(getAssetComponentsMock).not.toHaveBeenCalled();

    await user.click(rowOf("ZC-0001").getByRole("button", { name: /配件/ }));

    expect(await screen.findByText("三星 DDR5 16G")).toBeInTheDocument();
  });

  it("展示员工联系方式，便于核对设备配给了谁", () => {
    render(<EmployeeDevicePreview employee={employee} assets={assets} />);

    expect(screen.getByText("13800000000")).toBeInTheDocument();
    expect(screen.getByText("zhangsan@example.com")).toBeInTheDocument();
  });

  it("是只读预览：只有进入资产详情的链接，没有任何写操作入口", () => {
    render(<EmployeeDevicePreview employee={employee} assets={assets} />);

    // 页面上的全部链接都是只读下钻
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/assets/11",
      "/assets/12",
    ]);

    // 不提供分配 / 归还 / 调拨 / 送修 / 报废 / 编辑 / 删除
    for (const name of ["分配", "归还", "调拨", "送修", "报废", "编辑", "删除"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
