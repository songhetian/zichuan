/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RolesClient } from "@/app/(main)/settings/roles/roles-client";
import { PERMISSION_MODULES } from "@/lib/permissions";
import * as adminActions from "@/actions/admin.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/actions/admin.actions", () => ({
  getRoles: vi.fn(),
  updateRolePermissions: vi.fn(),
}));

const modules = PERMISSION_MODULES;

const roles = [
  {
    id: 1,
    key: "SUPER_ADMIN",
    name: "超级管理员",
    isSystem: true,
    permissions: ["system.account.manage"],
  },
  {
    id: 2,
    key: "EMPLOYEE",
    name: "普通员工",
    isSystem: true,
    permissions: ["approval.submit", "asset.view.own"],
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("角色权限管理界面", () => {
  it("渲染角色及其权限点名称", async () => {
    const user = userEvent.setup();
    render(<RolesClient initialRoles={roles} modules={modules} />);

    expect(screen.getByText("普通员工")).toBeInTheDocument();
    await user.click(screen.getAllByTitle("编辑权限")[0]);
    expect(screen.getByText("提交审批申请")).toBeInTheDocument();
    expect(screen.getByText("查看本人资产与申请单")).toBeInTheDocument();
  });

  it("编辑权限：取消勾选后保存，调用 updateRolePermissions 并刷新", async () => {
    const user = userEvent.setup();
    (adminActions.updateRolePermissions as any).mockResolvedValue({
      success: true,
      data: { id: 2 },
    });
    (adminActions.getRoles as any).mockResolvedValue({ success: true, data: roles });
    render(<RolesClient initialRoles={roles} modules={modules} />);

    await user.click(screen.getAllByTitle("编辑权限")[1]);

    // 取消「提交审批申请」，保留「查看本人资产与申请单」
    await user.click(
      screen.getByRole("checkbox", { name: /提交审批申请/ })
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(adminActions.updateRolePermissions).toHaveBeenCalledWith(2, [
        "asset.view.own",
      ]);
    });
    expect(adminActions.getRoles).toHaveBeenCalled();
  });
});
