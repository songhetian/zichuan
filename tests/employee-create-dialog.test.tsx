/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeListClient } from "@/app/(main)/employees/employee-list-client";
import { createEmployeesBatch } from "@/actions/employee.actions";

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

afterEach(() => {
  cleanup();
});

describe("EmployeeListClient 新建员工工号", () => {
  it("新建员工弹窗中工号为自动生成（只读），无需手动填写", async () => {
    const user = userEvent.setup();
    render(
      <EmployeeListClient employees={[]} departments={[{ id: 1, name: "技术部" }]} canManageAccounts />
    );

    await user.click(screen.getByRole("button", { name: "新建员工" }));

    // 工号输入框只读显示「自动生成」
    const noInput = screen.getByDisplayValue("自动生成");
    expect(noInput).toBeDisabled();
    // 不再出现可手动填写的工号输入框
    expect(screen.queryByPlaceholderText("请输入工号")).toBeNull();
  });
});

describe("EmployeeListClient 批量生成临时员工", () => {
  function makeCreated(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: 100 + i,
      employeeNo: `EMP010${i + 1}`,
      name: `双立人-${2000 + i}`,
      departmentId: 1,
      departmentName: "双立人",
      phone: null,
      email: null,
      assetCount: 0,
      createdAt: "2026-10-12T00:00:00.000Z",
    }));
  }

  it("切换到批量模式后，按部门 + 数量调用批量创建，生成的员工立即出现在列表", async () => {
    const user = userEvent.setup();
    (createEmployeesBatch as any).mockResolvedValue({ success: true, data: makeCreated(3) });

    render(
      <EmployeeListClient employees={[]} departments={[{ id: 1, name: "双立人" }]} canManageAccounts />
    );

    await user.click(screen.getByRole("button", { name: "新建员工" }));

    // 切换到批量生成模式
    await user.click(screen.getByRole("tab", { name: "批量生成" }));

    // 选部门
    await user.click(screen.getByRole("combobox", { name: "选择部门" }));
    await user.click(screen.getByRole("option", { name: "双立人" }));

    // 填数量
    const countInput = screen.getByLabelText("生成数量");
    await user.clear(countInput);
    await user.type(countInput, "3");

    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(createEmployeesBatch).toHaveBeenCalledWith({ departmentId: 1, count: 3 });

    // 生成的员工立即出现在列表中
    await waitFor(() => {
      expect(screen.getByText("双立人-2000")).toBeInTheDocument();
      expect(screen.getByText("双立人-2002")).toBeInTheDocument();
    });
  });

  it("批量模式下不显示姓名输入框（姓名由系统生成）", async () => {
    const user = userEvent.setup();
    render(
      <EmployeeListClient employees={[]} departments={[{ id: 1, name: "双立人" }]} canManageAccounts />
    );

    await user.click(screen.getByRole("button", { name: "新建员工" }));
    await user.click(screen.getByRole("tab", { name: "批量生成" }));

    expect(screen.queryByPlaceholderText("请输入姓名")).toBeNull();
    expect(screen.getByLabelText("生成数量")).toHaveValue(1);
  });
});
