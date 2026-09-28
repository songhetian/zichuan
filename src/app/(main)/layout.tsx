import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import MainLayoutClient from "./layout-client";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // 首登强制改密：服务端守卫，禁止绕过 /force-password 直接进入系统
  if (user.mustChangePassword) {
    redirect("/force-password");
  }

  return <MainLayoutClient username={user.username} userId={user.id}>{children}</MainLayoutClient>;
}
