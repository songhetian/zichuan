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

// 张三用 DN-0012、XS-0007；李四用 XS-0009（李四的设备编码与 DN-0012 无关）
const employees = [
  {
    id: 1,
    employeeNo: "EMP0001",
    name: "张三",
    departmentId: 1,
    departmentName: "技术部",
    phone: null,
    email: null,
    assetCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    assetNos: ["DN-0012", "XS-0007"],
  },
  {
    id: 2,
    employeeNo: "EMP0002",
    name: "李四",
    departmentId: 2,
    departmentName: "财务部",
    phone: null,
    email: null,
    assetCount: 1,
    createdAt: "2026-01-02T00:00:00.000Z",
    assetNos: ["XS-0009"],
  },
];

const SEARCH_PLACEHOLDER = "搜索工号、姓名、设备编码...";

afterEach(() => {
  cleanup();
});

describe("员工管理：按设备编码搜索到使用人", () => {
  it("输入设备编码后，只留下正在使用该设备的员工，且名字旁不显示设备标签", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), "DN-0012");

    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
      expect(screen.queryByText("李四")).toBeNull();
    });

    // 名字列保持纯净：命中设备不再以标签形式挂在姓名旁（用户反馈样式干扰）
    expect(screen.queryByText(/设备\s/)).toBeNull();
  });

  it("按姓名搜到时不标设备（设备标签只在设备编码命中时出现）", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), "张三");

    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
      expect(screen.queryByText("李四")).toBeNull();
    });
    expect(screen.queryByText(/设备\s/)).toBeNull();
  });

  it("姓名 / 工号仍可搜索（回归）", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), "EMP0002");

    await waitFor(() => {
      expect(screen.getByText("李四")).toBeInTheDocument();
      expect(screen.queryByText("张三")).toBeNull();
    });
  });

  it("清空关键词后恢复完整列表", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    const box = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    await user.type(box, "DN-0012");
    await waitFor(() => expect(screen.queryByText("李四")).toBeNull());

    await user.clear(box);

    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
      expect(screen.getByText("李四")).toBeInTheDocument();
    });
  });

  it("设备编码对不上任何设备时不显示任何人", async () => {
    const user = userEvent.setup();
    render(<EmployeeListClient employees={employees} departments={departments} />);

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), "ZZ-9999");

    await waitFor(() => {
      expect(screen.queryByText("张三")).toBeNull();
      expect(screen.queryByText("李四")).toBeNull();
    });
  });
});
