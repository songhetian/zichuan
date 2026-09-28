import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ForcePasswordForm } from "./force-password-form";

export const dynamic = "force-dynamic";

export default async function ForcePasswordPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 非强制改密状态不允许访问（防止绕过），已改密则直接进入系统
  const admin = await prisma.admin.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true, displayName: true, employee: { select: { name: true } } },
  });
  if (!admin || !admin.mustChangePassword) {
    redirect("/dashboard");
  }

  const displayName = admin.displayName ?? admin.employee?.name ?? user.username;
  return <ForcePasswordForm displayName={displayName} />;
}
