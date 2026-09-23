import { describe, it, expect } from "vitest";
import {
  can,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  ALL_PERMISSION_KEYS,
  expandEffective,
} from "@/lib/permissions";

describe("权限判定（纯函数）", () => {
  it("拥有该权限则放行", () => {
    expect(can(["asset.manage"], "asset.manage")).toBe(true);
  });

  it("不拥有该权限则拒绝", () => {
    expect(can(["asset.view.own"], "asset.manage")).toBe(false);
  });

  it("空集合 / 未登录一律拒绝", () => {
    expect(can([], "asset.manage")).toBe(false);
    expect(can(null, "asset.manage")).toBe(false);
    expect(can(undefined, "asset.manage")).toBe(false);
  });
});

describe("默认权限矩阵（与 docs/approval-flow-v1.md §6 对齐）", () => {
  it("超管拥有全部权限点", () => {
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(ALL_PERMISSION_KEYS);
  });

  it("四角色矩阵的关键权限点（含父级含子级展开）", () => {
    const eff = (k: string[]) => Array.from(expandEffective(k));
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(ALL_PERMISSION_KEYS);

    expect(ROLE_PERMISSION_MATRIX.ASSET_MANAGER).toEqual([
      "asset.manage",
      "dept.data.view",
      "approval.submit",
      "approval.approve",
      "asset.view.own",
      "asset.depart.view",
    ]);

    expect(ROLE_PERMISSION_MATRIX.DEPT_MANAGER).toEqual([
      "dept.data.view",
      "approval.submit",
      "approval.approve",
      "asset.view.own",
      // 部门主管需查看所属员工设备列表（发起/审批需选定设备）
      "asset.device.view",
    ]);

    expect(ROLE_PERMISSION_MATRIX.EMPLOYEE).toEqual([
      "approval.submit",
      "asset.view.own",
      // 员工需查看本人名下设备以发起升级/降级申请
      "asset.device.view",
    ]);

    // 父级含子级：勾选模块级点后应展开出对应页面/操作级点
    expect(eff(["approval.submit"])).toEqual([
      "approval.submit",
      "approval.new.view",
      "approval.my.view",
    ]);
    expect(eff(["asset.manage"])).toContain("asset.device.view");
  });

  it("矩阵引用的每个权限点都已定义", () => {
    const defined = new Set(PERMISSIONS.map((p) => p.key));
    for (const perms of Object.values(ROLE_PERMISSION_MATRIX)) {
      for (const p of perms) {
        expect(defined.has(p)).toBe(true);
      }
    }
  });
});
