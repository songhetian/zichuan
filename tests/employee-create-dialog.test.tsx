/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
