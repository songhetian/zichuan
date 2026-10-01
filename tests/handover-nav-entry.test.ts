/**
 * 「交接对账」页面入口的守卫测试。
 *
 * 页面本身（HandoverListClient）与数据出口另有测试；这里只钉住两件事：
 * 菜单里必须有这个入口，且它挂的是 `asset.depart.handover.view`。
 * 一旦有人误删菜单项或改错权限点，资产管理员就会「拿得到权限却找不到页面」。
 */
import { describe, it, expect } from "vitest";
import { navItems, resolveRoutePermission } from "@/components/layout/nav-config";

describe("交接对账入口", () => {
  it("审批中心下有「交接对账」，权限点 = asset.depart.handover.view", () => {
    const approvals = navItems.find((n) => n.href === "/approvals");
    const entry = approvals?.children?.find((c) => c.href === "/approvals/handover");

    expect(entry).toBeTruthy();
    expect(entry?.label).toBe("交接对账");
    expect(entry?.perm).toBe("asset.depart.handover.view");
  });

  it("路由鉴权解析到同一权限点（不会被 /approvals 的兜底放行覆盖）", () => {
    expect(resolveRoutePermission("/approvals/handover")).toBe("asset.depart.handover.view");
  });
});
