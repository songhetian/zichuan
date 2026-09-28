/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepartmentsClient } from "@/app/(main)/settings/departments/departments-client";
import * as deptActions from "@/actions/department.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/actions/department.actions", () => ({
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
}));

const departments = [
  { id: 1, name: "技术部", managerId: null, manager: null },
  { id: 2, name: "人事部", managerId: 5, manager: { id: 5, name: "李雷" } },
];

const employees = [
  { id: 5, employeeNo: "E001", name: "李雷" },
  { id: 6, employeeNo: "E002", name: "韩梅梅" },
];

beforeEach(() => {
  vi.clearAllMocks();
  (deptActions.updateDepartment as any).mockResolvedValue({
    success: true,
    data: { id: 1, name: "技术部", managerId: 6, manager: { id: 6, name: "韩梅梅" } },
  });
});

afterEach(() => {
  cleanup();
});

describe("部门管理 · 设置部门负责人", () => {
  it("负责人列展示当前管理员，未设置显示占位", () => {
    render(<DepartmentsClient initialDepartments={departments} employees={employees} />);
    const rows = screen.getAllByRole("row");
    // 技术部（未设置）
    const techRow = rows.find((r) => within(r).queryByText("技术部"));
    expect(techRow && within(techRow!).getByText("未设置")).toBeInTheDocument();
    // 人事部（李雷）
    const hrRow = rows.find((r) => within(r).queryByText("人事部"));
    expect(hrRow && within(hrRow!).getByText("李雷")).toBeInTheDocument();
  });

  it("点击设置负责人选中员工后调用 updateDepartment(id,{managerId})", async () => {
    const user = userEvent.setup();
    render(<DepartmentsClient initialDepartments={departments} employees={employees} />);

    const rows = screen.getAllByRole("row");
    const techRow = rows.find((r) => within(r).queryByText("技术部"))!;
    await user.click(within(techRow).getByRole("button", { name: /设置负责人/ }));

    // 弹窗中选择员工韩梅梅（选项以「姓名+工号」两行展示）
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /韩梅梅/ }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(deptActions.updateDepartment).toHaveBeenCalledWith(1, { managerId: 6 });
    });
  });
});