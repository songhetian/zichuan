export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PurchaseRequestClient } from "./purchase-request-client";

export default async function PurchaseRequestPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 仅授予「加购配件/采购留痕」权限点的角色可访问本页
  if (!(await hasPermission(user, "asset.purchase.view"))) {
    redirect("/dashboard");
  }

  const categories = await prisma.componentCategory.findMany({
    select: { id: true, name: true, parentId: true },
    orderBy: { id: "asc" },
  });

  const models = await prisma.componentModel.findMany({
    select: { id: true, name: true, brand: true, categoryId: true },
    orderBy: { name: "asc" },
  });

  return <PurchaseRequestClient categories={categories} models={models} />;
}