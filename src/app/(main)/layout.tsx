import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import MainLayoutClient from "./layout-client";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <MainLayoutClient username={user.username}>{children}</MainLayoutClient>;
}
