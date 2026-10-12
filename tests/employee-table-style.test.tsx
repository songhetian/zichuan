/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmployeeListClient } from "@/app/(main)/employees/employee-list-client";

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

const departments = [{ id: 1, name: "双立人" }];

const employees = [
  {
    id: 1,
    employeeNo: "EMP0138",
    name: "员工005",
    departmentId: 1,
    departmentName: "双立人",
    phone: null,
    email: null,
    assetCount: 0,
    createdAt: "2026-09-15T00:00:00.000Z",
    account: {
      id: 1,
      username: "EMP0138",
      displayName: "员工005",
      isActive: true,
      role: { key: "EMPLOYEE", name: "普通员工" },
      departmentScope: "DEPT",
      departmentIds: [],
    },
  },
];

describe("员工表样式收紧", () => {
  it("账号列单行显示登录名，displayName 不再重复渲染第二行", () => {
    render(
      <EmployeeListClient employees={employees} departments={departments} canManageAccounts />
    );

    // displayName 与姓名列同名：若账号列仍渲染第二行，「员工005」会出现 2 次
    expect(screen.getAllByText("员工005")).toHaveLength(1);
  });

  it("账号管理视角下可见列总宽收窄到一屏内（不出现横向滚动）", () => {
    render(
      <EmployeeListClient employees={employees} departments={departments} canManageAccounts />
    );

    const widths = screen
      .getAllByRole("columnheader")
      .map((th) => parseFloat((th as HTMLElement).style.width))
      .filter((n) => !Number.isNaN(n));

    expect(widths.length).toBeGreaterThan(5);
    // 主流 1440 视口（内容区约 1350px）下不触发横向滚动
    const total = widths.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(1350);
  });
});
