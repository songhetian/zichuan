/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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

const departments = [{ id: 1, name: "技术部" }];

/** 25 名员工：默认按 createdAt 倒序 → 第 1 页 = 员工25..员工16，第 2 页 = 员工15..员工06 */
function makeEmployees() {
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return {
      id: n,
      employeeNo: `EMP${String(n).padStart(4, "0")}`,
      name: `员工${String(n).padStart(2, "0")}`,
      departmentId: 1,
      departmentName: "技术部",
      phone: null,
      email: null,
      assetCount: 0,
      createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    };
  });
}

afterEach(() => {
  cleanup();
});

describe("员工管理：分页停留在当前页", () => {
  it("点第 2 页后展示第 11-20 条（而不是第 1 页内容）", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={makeEmployees()} departments={departments} />);

    expect(screen.getByText("员工25")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "第 2 页" }));

    expect(screen.getByText("员工15")).toBeInTheDocument();
    expect(screen.queryByText("员工25")).toBeNull();
  });

  it("翻页后父级重渲染（对比刷新）不会把用户打回第 1 页", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EmployeeListClient employees={makeEmployees()} departments={departments} />
    );

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("员工15")).toBeInTheDocument();

    // 服务端重新下发同一批数据（新数组、内容相同）→ 不应重置分页
    rerender(<EmployeeListClient employees={makeEmployees()} departments={departments} />);
    // 让被排进微任务的「重置分页」有机会执行（若有）
    await act(async () => {});

    expect(screen.getByText("员工15")).toBeInTheDocument();
    expect(screen.queryByText("员工25")).toBeNull();
  });

  it("搜索条件变化时回到第 1 页（不停在可能已不存在的页码）", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={makeEmployees()} departments={departments} />);

    await user.click(screen.getByRole("button", { name: "第 2 页" }));
    expect(screen.getByText("员工15")).toBeInTheDocument();

    // 关键词变化 → 结果集变化 → 应回到第 1 页
    await user.type(screen.getByPlaceholderText("搜索工号、姓名、设备编码..."), "员");

    expect(screen.getByText("员工25")).toBeInTheDocument();
    expect(screen.queryByText("员工15")).toBeNull();
  });
});
