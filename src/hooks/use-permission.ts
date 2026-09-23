"use client";

import { useAuthStore } from "@/store/auth-store";

/**
 * 按钮级权限判断：返回当前账号是否拥有指定权限点。
 * permissions 为已展开的有效权限集合（父级含子级）。
 */
export function usePermission(perm?: string): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  if (!perm) return true;
  // 权限尚未加载完成时默认放行，加载后按实际判定（避免首屏闪烁）
  return permissions == null || permissions.includes(perm);
}