import type { Metadata } from "next";
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "系统设置" };

export default function SettingsPage() {
  redirect("/settings/departments")
}