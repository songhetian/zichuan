/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersClient } from "@/app/(main)/settings/users/users-client";
import * as adminActions from "@/actions/admin.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/actions/admin.actions", () => ({
  getAdmins: vi.fn(),
  getRoles: vi.fn(),
  createAdmin: vi.fn(),
  updateAdminRole: vi.fn(),
  setAdminActive: vi.fn(),
}));

const roles = [
  { id: 1, key: "SUPER_ADMIN", name: "超级管理员", isSystem: true, permissions: [] },
  { id: 2, key: "EMPLOYEE", name: "普通员工", isSystem: true, permissions: [] },
];

const initialAdmins = [
  {
    id: 1,
    username: "admin",
    displayName: "系统管理员",
    isActive: true,
    role: { key: "SUPER_ADMIN", name: "超级管理员" },
    employee: null,
  },
  {
    id: 2,
    username: "zhangsan",
    displayName: "张三",
    isActive: false,
    role: { key: "EMPLOYEE", name: "普通员工" },
    employee: null,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("用户管理界面", () => {
  it("渲染账号列表：用户名/显示名/角色/停用状态", async () => {
    render(<UsersClient initialAdmins={initialAdmins} roles={roles} />);

    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("系统管理员")).toBeInTheDocument();
    expect(screen.getByText("超级管理员")).toBeInTheDocument();
    // 「停用」出现两处：admin 行的操作按钮 + 张三行的状态徽标
    expect(screen.getAllByText("停用")).toHaveLength(2);
  });

  it("新建账号：填写并提交后调用 createAdmin 并刷新列表", async () => {
    const user = userEvent.setup();
    (adminActions.createAdmin as any).mockResolvedValue({
      success: true,
      data: { id: 3, username: "lisi" },
    });
    (adminActions.getAdmins as any).mockResolvedValue({
      success: true,
      data: initialAdmins,
    });
    render(<UsersClient initialAdmins={initialAdmins} roles={roles} />);

    await user.click(screen.getByRole("button", { name: /新建账号/ }));
    await user.type(screen.getByPlaceholderText("请输入用户名"), "lisi");
    await user.type(screen.getByPlaceholderText("请输入密码"), "123456");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(adminActions.createAdmin).toHaveBeenCalledWith({
        username: "lisi",
        password: "123456",
        roleId: undefined,
        displayName: undefined,
      });
    });
    expect(adminActions.getAdmins).toHaveBeenCalled();
  });

  it("分配角色：选择角色后调用 updateAdminRole", async () => {
    const user = userEvent.setup();
    (adminActions.updateAdminRole as any).mockResolvedValue({
      success: true,
      data: { id: 2 },
    });
    (adminActions.getAdmins as any).mockResolvedValue({
      success: true,
      data: initialAdmins,
    });
    render(<UsersClient initialAdmins={initialAdmins} roles={roles} />);

    await user.click(screen.getAllByTitle("分配角色")[0]);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "普通员工" }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(adminActions.updateAdminRole).toHaveBeenCalledWith(1, 2);
    });
    expect(adminActions.getAdmins).toHaveBeenCalled();
  });

  it("停用账号：确认后调用 setAdminActive(false)", async () => {
    const user = userEvent.setup();
    (adminActions.setAdminActive as any).mockResolvedValue({
      success: true,
      data: { id: 1, isActive: false },
    });
    (adminActions.getAdmins as any).mockResolvedValue({
      success: true,
      data: initialAdmins,
    });
    render(<UsersClient initialAdmins={initialAdmins} roles={roles} />);

    await user.click(screen.getByTitle("停用"));
    await user.click(screen.getByRole("button", { name: "确认停用" }));

    await waitFor(() => {
      expect(adminActions.setAdminActive).toHaveBeenCalledWith(1, false);
    });
  });
});
