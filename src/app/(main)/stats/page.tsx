import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "统计报表" };

export default function StatsPage() {
  redirect("/dashboard");
}