import type { Metadata } from "next";
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "配件库存" };

export default function ComponentsPage() {
  redirect("/components/models")
}