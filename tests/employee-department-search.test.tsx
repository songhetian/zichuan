/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeListClient } from "@/app/(main)/employees/employee-list-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/actions/employee.actions", () => ({
  createEmployee: vi.fn(),
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

const employees = [
  {
    id: 1,
    employeeNo: "EMP0001",
    name: "张三",
    departmentId: 1,
    departmentName: "技术部",
    phone: null,
    email: null,
    assetCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

afterEach(() => {
  cleanup();
});

describe("员工弹窗部门下拉可搜索", () => {
  it("新建员工：部门下拉支持搜索过滤并回填", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={[]} departments={departments} canManageAccounts />);

    await user.click(screen.getByRole("button", { name: "新建员工" }));

    // 打开部门下拉，出现搜索输入区
    await user.click(screen.getByRole("combobox", { name: "部门" }));
    const searchInput = screen.getByPlaceholderText("搜索...");
    expect(searchInput).toBeInTheDocument();

    // 按名称模糊过滤
    await user.type(searchInput, "财务");
    await waitFor(() => {
      expect(screen.getByText("财务部")).toBeInTheDocument();
      expect(screen.queryByText("技术部")).toBeNull();
    });

    // 选中后回填到触发按钮
    await user.click(screen.getByText("财务部"));
    expect(screen.getByRole("combobox", { name: "部门" })).toHaveTextContent("财务部");
  });

  it("编辑员工：部门回显初始值，且可搜索切换", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} canManageAccounts />);

    await user.click(screen.getByTitle("编辑"));

    // 回显员工原部门
    expect(screen.getByRole("combobox", { name: "部门" })).toHaveTextContent("技术部");

    // 可搜索并切换到财务部
    await user.click(screen.getByRole("combobox", { name: "部门" }));
    const searchInput = screen.getByPlaceholderText("搜索...");
    await user.type(searchInput, "财务");
    await user.click(screen.getByText("财务部"));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "部门" })).toHaveTextContent("财务部");
    });
  });
});
