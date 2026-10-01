/**
 * @vitest-environment jsdom
 *
 * 员工列表 → 「员工在用设备」预览页的入口。
 * 入口挂在「在用设备数」这一列上：数字即链接，点进 /employees/[id]。
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
  deleteEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  getEmployeeAssets: vi.fn(),
  getAssetComponents: vi.fn(),
}));

vi.mock("@/actions/excel.actions", () => ({
  exportEmployeesToExcel: vi.fn(),
  importEmployeesFromExcel: vi.fn(),
}));

vi.mock("@/actions/system-log.actions", () => ({
  getSystemLogs: vi.fn(),
}));

const departments = [{ id: 1, name: "技术部" }];

const employees = [
  {
    id: 7,
    employeeNo: "EMP0007",
    name: "张三",
    departmentId: 1,
    departmentName: "技术部",
    phone: null,
    email: null,
    assetCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("员工在用设备预览页入口", () => {
  afterEach(() => {
    cleanup();
  });

  it("从员工列表「在用设备数」可进入该员工的在用设备预览页", () => {
    render(
      <EmployeeListClient employees={employees} departments={departments} canManageAccounts />
    );

    const entry = screen.getByRole("link", { name: /查看 张三 的在用设备/ });
    expect(entry).toHaveAttribute("href", "/employees/7");
    expect(entry).toHaveTextContent("3");
  });
});
