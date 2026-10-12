/**
 * 员工管理页两处改动：
 *  1. 点击员工行 → 弹窗展示 TA 正在使用的设备（不再需要点小箭头展开）。
 *  2. 「批量创建」按钮 → 弹窗按部门 + 数量批量造人（姓名 = 部门名-随机编号）。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeListClient } from "@/app/(main)/employees/employee-list-client";
import { createEmployeesBatch, getEmployeeAssets } from "@/actions/employee.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/actions/employee.actions", () => ({
  createEmployee: vi.fn(),
  createEmployeesBatch: vi.fn(),
  deleteEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  getEmployeeAssets: vi.fn(),
}));

vi.mock("@/actions/excel.actions", () => ({
  exportEmployeesToExcel: vi.fn(),
  importEmployeesFromExcel: vi.fn(),
}));

vi.mock("@/actions/system-log.actions", () => ({
  getSystemLogs: vi.fn(),
}));

const departments = [
  { id: 1, name: "技术部" },
  { id: 2, name: "财务部" },
];

function makeEmployee(overrides: Partial<{
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  departmentName: string;
  assetCount: number;
}> = {}) {
  return {
    id: 1,
    employeeNo: "EMP0001",
    name: "张三",
    departmentId: 1,
    departmentName: "技术部",
    phone: null,
    email: null,
    assetCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getEmployeeAssets).mockReset();
  vi.mocked(createEmployeesBatch).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("点击员工查看在用设备", () => {
  it("点击整行弹出弹窗，列出该员工的设备", async () => {
    const user = userEvent.setup();
    vi.mocked(getEmployeeAssets).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          assetNo: "PC-0001",
          name: "研发主机",
          status: "IN_USE",
          templateName: "标准机",
          categoryName: "电脑主机",
        },
      ],
    });

    render(<EmployeeListClient employees={[makeEmployee()]} departments={departments} />);

    await user.click(screen.getByText("张三"));

    expect(await screen.findByText("张三 的设备")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("PC-0001")).toBeInTheDocument();
    });
    expect(screen.getByText(/研发主机/)).toBeInTheDocument();
    expect(getEmployeeAssets).toHaveBeenCalledWith(1);
  });

  it("没有设备的员工也能打开，显示空态", async () => {
    const user = userEvent.setup();
    vi.mocked(getEmployeeAssets).mockResolvedValue({ success: true, data: [] });

    render(
      <EmployeeListClient
        employees={[makeEmployee({ id: 2, name: "李四", employeeNo: "EMP0002", assetCount: 0 })]}
        departments={departments}
      />
    );

    await user.click(screen.getByText("李四"));

    expect(await screen.findByText("李四 的设备")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("暂无分配设备")).toBeInTheDocument();
    });
  });

  it("点操作列的编辑按钮不会误触发设备弹窗", async () => {
    const user = userEvent.setup();
    vi.mocked(getEmployeeAssets).mockResolvedValue({ success: true, data: [] });

    render(<EmployeeListClient employees={[makeEmployee()]} departments={departments} />);

    await user.click(screen.getByTitle("编辑"));

    expect(screen.getByText("编辑员工")).toBeInTheDocument();
    expect(screen.queryByText("张三 的设备")).toBeNull();
    expect(getEmployeeAssets).not.toHaveBeenCalled();
  });
});

describe("批量创建员工", () => {
  it("弹窗按「部门 + 数量」创建，姓名规则写在说明里", async () => {
    const user = userEvent.setup();
    vi.mocked(createEmployeesBatch).mockResolvedValue({ success: true, data: [] });

    render(<EmployeeListClient employees={[]} departments={departments} />);

    await user.click(screen.getByRole("button", { name: /批量创建/ }));

    expect(screen.getByText("批量创建员工")).toBeInTheDocument();
    expect(screen.getByText(/部门名-随机编号/)).toBeInTheDocument();

    // 选部门
    await user.click(screen.getByRole("combobox", { name: "选择部门" }));
    await user.click(screen.getByText("技术部"));

    // 填数量
    const countInput = screen.getByPlaceholderText("数量");
    await user.clear(countInput);
    await user.type(countInput, "3");

    await user.click(screen.getByRole("button", { name: "创建 3 人" }));

    await waitFor(() => {
      expect(createEmployeesBatch).toHaveBeenCalledWith({ departmentId: 1, count: 3 });
    });
  });

  it("未选部门或数量非法时不能提交", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={[]} departments={departments} />);

    await user.click(screen.getByRole("button", { name: /批量创建/ }));

    // 没选部门，按钮禁用
    expect(screen.getByRole("button", { name: /创建 \d+ 人/ })).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "选择部门" }));
    await user.click(screen.getByText("技术部"));

    const countInput = screen.getByPlaceholderText("数量");
    await user.clear(countInput);
    await user.type(countInput, "0");

    expect(screen.getByRole("button", { name: /创建 \d+ 人/ })).toBeDisabled();
  });
});
