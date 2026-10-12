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

function employee(over: Partial<Record<string, unknown>>) {
  return {
    employeeNo: "EMP0000",
    phone: null,
    email: null,
    assetCount: 0,
    assetNos: [] as string[],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as never;
}

/** 张三在用 DT-7KF3WX；李四没有设备；王五在用 DT-CWQX8W */
const employees = [
  employee({ id: 1, employeeNo: "EMP0001", name: "张三", departmentId: 1, departmentName: "技术部", assetCount: 1, assetNos: ["DT-7KF3WX"] }),
  employee({ id: 2, employeeNo: "EMP0002", name: "李四", departmentId: 2, departmentName: "财务部" }),
  employee({ id: 3, employeeNo: "EMP0003", name: "王五", departmentId: 2, departmentName: "财务部", assetCount: 1, assetNos: ["DT-CWQX8W"] }),
];

afterEach(() => {
  cleanup();
});

describe("员工管理：按设备编码搜使用人", () => {
  it("输入设备编码后，只剩正在使用该设备的员工", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    expect(screen.getByText("李四")).toBeInTheDocument();

    await user.type(screen.getByLabelText("按设备编码搜索"), "DT-7KF3WX");

    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
      expect(screen.queryByText("李四")).toBeNull();
      expect(screen.queryByText("王五")).toBeNull();
    });
  });

  it("把命中的设备编码标在员工名字旁边，方便确认是哪台设备", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByLabelText("按设备编码搜索"), "CWQX8W");

    await waitFor(() => {
      // 王五命中 DT-CWQX8W，编码以标签形式渲染在行内
      expect(screen.getByText("DT-CWQX8W")).toBeInTheDocument();
    });
  });

  it("点「重置」后设备编码搜索被清空，列表恢复全部员工", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByLabelText("按设备编码搜索"), "DT-7KF3WX");
    await waitFor(() => expect(screen.queryByText("李四")).toBeNull());

    await user.click(screen.getByRole("button", { name: "重置" }));

    await waitFor(() => {
      expect(screen.getByText("李四")).toBeInTheDocument();
      expect(screen.getByText("王五")).toBeInTheDocument();
    });
  });

  it("设备编码与关键字是「与」的关系，两个条件不可能同时满足时列表为空", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    // DT-7KF3WX 的使用人是张三，再叠加关键字「王五」就没有结果
    await user.type(screen.getByLabelText("按设备编码搜索"), "DT-7KF3WX");
    await user.type(screen.getByPlaceholderText("搜索工号、姓名..."), "王五");

    await waitFor(() => {
      expect(screen.queryByText("张三")).toBeNull();
      expect(screen.queryByText("王五")).toBeNull();
      // 这时不能说「没有员工正在使用 DT-7KF3WX」——明明有人用，是被关键字筛掉的
      expect(screen.getByText("没有同时满足这些条件的员工")).toBeInTheDocument();
    });
  });

  it("搜的编码没人持有时，空状态说清楚「没有员工在使用这台设备」", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByLabelText("按设备编码搜索"), "DT-NOPE");

    await waitFor(() => {
      expect(screen.getByText("没有员工正在使用「DT-NOPE」")).toBeInTheDocument();
    });
  });
});
