/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeListClient } from "@/app/(main)/employees/employee-list-client";
import { Toaster } from "@/components/ui/toaster";
import * as adminActions from "@/actions/admin.actions";
import * as employeeActions from "@/actions/employee.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/actions/admin.actions", () => ({
  setAdminActive: vi.fn(),
  setAccountDepartmentScope: vi.fn(),
}));

vi.mock("@/actions/employee.actions", () => ({
  createEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  resetEmployeePassword: vi.fn(),
  getEmployeeAssets: vi.fn(),
}));

vi.mock("@/actions/excel.actions", () => ({
  exportEmployeesToExcel: vi.fn(),
  importEmployeesFromExcel: vi.fn(),
}));

vi.mock("@/actions/system-log.actions", () => ({
  getSystemLogs: vi.fn(),
}));

// 导入员工按钮按 employee.import 权限门控（与后端一致）
const authPerms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/hooks/use-permission", () => ({
  usePermission: (key?: string) => !key || authPerms.granted.has(key),
}));

const departments = [
  { id: 1, name: "技术部" },
  { id: 2, name: "财务部" },
];

const roles = [
  { id: 1, key: "SUPER_ADMIN", name: "超级管理员" },
  { id: 2, key: "EMPLOYEE", name: "普通员工" },
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
    account: {
      id: 10,
      username: "EMP0001",
      displayName: "张三",
      isActive: true,
      role: { key: "EMPLOYEE", name: "普通员工" },
      departmentScope: "ALL",
      departmentIds: [],
    },
  },
  {
    id: 2,
    employeeNo: "EMP0002",
    name: "李四",
    departmentId: 2,
    departmentName: "财务部",
    phone: null,
    email: null,
    assetCount: 0,
    createdAt: "2026-01-02T00:00:00.000Z",
    account: null,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("员工管理页账号功能（整合员工管理）", () => {
  it("无账号管理权限时不显示账号列与账号操作，并弹出权限说明", async () => {
    authPerms.granted = new Set();
    // 先挂载 Toaster 并等待其完成订阅，再渲染页面组件（否则 toast 在订阅前丢失）
    render(<Toaster />);
    await new Promise((r) => setTimeout(r, 0));
    render(<EmployeeListClient employees={employees} departments={departments} />);

    expect(screen.queryByRole("columnheader", { name: "账号" })).toBeNull();
    expect(screen.queryByTitle("设置数据范围")).toBeNull();
    expect(screen.queryByTitle("重置密码")).toBeNull();
    expect(screen.queryByTitle("停用账号")).toBeNull();
    // 导入员工会批量创建登录账号，无权限时导入按钮一并隐藏
    expect(screen.queryByText("导入 Excel")).toBeNull();
    // 无权限说明 toast
    expect(await screen.findByText("账号功能不可用")).toBeInTheDocument();
  });

  it("有账号管理权限时显示账号信息列（账号/角色/数据范围/状态）与账号操作", () => {
    authPerms.granted = new Set(["employee.import"]);
    render(<EmployeeListClient employees={employees} departments={departments} canManageAccounts roles={roles} />);

    expect(screen.getByRole("columnheader", { name: "账号" })).toBeInTheDocument();
    expect(screen.getAllByText("EMP0001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("普通员工").length).toBeGreaterThan(0);
    expect(screen.getByText("本部门")).toBeInTheDocument();
    expect(screen.getByText("启用")).toBeInTheDocument();
    // 已绑定账号的员工行出现账号操作
    expect(screen.getAllByTitle("设置数据范围").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("重置密码").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("停用账号").length).toBeGreaterThan(0);
    // 未创建账号的员工行无账号操作按钮
    expect(screen.queryByTitle("启用账号")).toBeNull();
  });

  it("编辑员工时可修改账号角色（调用 updateEmployee 同步角色）", async () => {
    const user = userEvent.setup();
    (employeeActions.updateEmployee as any).mockResolvedValue({ success: true, data: { id: 1 } });
    render(<EmployeeListClient employees={employees} departments={departments} canManageAccounts roles={roles} />);

    // 定位张三所在行（表格默认按创建时间倒序，直接取按钮可能命中李四）
    const zhangsanRow = screen.getAllByText("张三")[0].closest("tr");
    expect(zhangsanRow).not.toBeNull();
    await user.click(within(zhangsanRow as HTMLElement).getByTitle("编辑"));
    const dialog = screen.getByRole("dialog");
    // 部门 SearchableSelect + 角色 Select 共 2 个 combobox；角色为第 2 个
    await user.click(within(dialog).getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "超级管理员" }));
    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(employeeActions.updateEmployee).toHaveBeenCalledWith(1, {
        employeeNo: "EMP0001",
        name: "张三",
        departmentId: 1,
        phone: undefined,
        email: undefined,
        roleId: 1, // SUPER_ADMIN
      });
    });
  });

  it("数据范围：选择扩展部门并保存后调用 setAccountDepartmentScope", async () => {
    const user = userEvent.setup();
    (adminActions.setAccountDepartmentScope as any).mockResolvedValue({ success: true, data: { id: 10 } });
    render(<EmployeeListClient employees={employees} departments={departments} canManageAccounts roles={roles} />);

    await user.click(screen.getAllByTitle("设置数据范围")[0]);
    await user.click(screen.getByLabelText("数据范围-扩展其他部门"));
    await user.click(screen.getByLabelText("范围部门-财务部"));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(adminActions.setAccountDepartmentScope).toHaveBeenCalledWith(10, {
        scope: "SPEC",
        departmentIds: [2],
      });
    });
  });

  it("新建员工：自动创建登录账号（登录名=工号），角色默认普通员工", async () => {
    const user = userEvent.setup();
    (employeeActions.createEmployee as any).mockResolvedValue({
      success: true,
      data: { id: 3, employeeNo: "EMP0003", name: "王五" },
    });
    render(<EmployeeListClient employees={[]} departments={departments} canManageAccounts roles={roles} />);

    await user.click(screen.getByRole("button", { name: "新建员工" }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByPlaceholderText("请输入姓名"), "王五");
    // 部门（SearchableSelect）：打开后搜索并选择
    await user.click(within(dialog).getAllByRole("combobox")[0]);
    await user.type(screen.getByPlaceholderText("搜索..."), "技术");
    await user.click(await screen.findByText("技术部"));
    // 角色默认普通员工（EMPLOYEE），无需手动选择
    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(employeeActions.createEmployee).toHaveBeenCalledWith({
        name: "王五",
        departmentId: 1,
        phone: undefined,
        email: undefined,
        roleId: 2, // EMPLOYEE 角色 id（默认）
      });
    });
  });

  it("重置密码：确认后调用 resetEmployeePassword（重置为 123456）", async () => {
    const user = userEvent.setup();
    (employeeActions.resetEmployeePassword as any).mockResolvedValue({ success: true, data: { id: 10 } });
    render(<EmployeeListClient employees={employees} departments={departments} canManageAccounts roles={roles} />);

    await user.click(screen.getAllByTitle("重置密码")[0]);
    await user.click(screen.getByRole("button", { name: "重置" }));

    await waitFor(() => {
      expect(employeeActions.resetEmployeePassword).toHaveBeenCalledWith(1);
    });
  });

  it("停用账号：确认后调用 setAdminActive(false)", async () => {
    const user = userEvent.setup();
    (adminActions.setAdminActive as any).mockResolvedValue({ success: true, data: { id: 10, isActive: false } });
    render(<EmployeeListClient employees={employees} departments={departments} canManageAccounts roles={roles} />);

    await user.click(screen.getAllByTitle("停用账号")[0]);
    await user.click(screen.getByRole("button", { name: "确认停用" }));

    await waitFor(() => {
      expect(adminActions.setAdminActive).toHaveBeenCalledWith(10, false);
    });
  });
});
