"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useAuthStore } from "@/store/auth-store";
import { NotificationProvider } from "@/components/features/notification-provider";
import { NoAccess } from "@/components/layout/no-access";
import { resolveRoutePermission } from "@/components/layout/nav-config";

export default function MainLayoutClient({
  children,
  username,
  userId,
}: {
  children: React.ReactNode;
  username: string;
  userId: number;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { login, setPermissions, permissions } = useAuthStore();

  useEffect(() => {
    login(username);
  }, [username, login]);

  // 拉取当前账号权限，用于菜单裁剪与路由拦截
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getMyPermissions } = await import("@/actions/permission.actions");
      const res = await getMyPermissions();
      if (cancelled) return;
      if (res.success) {
        setPermissions(res.data.role, res.data.permissions);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [login, setPermissions]);

  // 路由权限拦截：未加载到权限时不拦截，加载后按需展示无权限
  const required = resolveRoutePermission(pathname);
  const denied = required != null && permissions != null && !permissions.includes(required);

  return (
    <div className="flex h-screen">
      <Sidebar mobileOpen={mobileMenuOpen} />
      <div className="flex flex-1 flex-col">
        <Header mobileMenuOpen={mobileMenuOpen} onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[1440px]">
            {denied ? <NoAccess /> : children}
          </div>
        </main>
      </div>
      <NotificationProvider userId={userId} />
      <div
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${
          mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />
    </div>
  );
}
