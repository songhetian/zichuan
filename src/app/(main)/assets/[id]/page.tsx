export const dynamic = 'force-dynamic';

import { getAssetById } from "@/actions/asset.actions";
import { getComponentModels } from "@/actions/component-model.actions";
import { getEmployees } from "@/actions/employee.actions";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AssetDetailClient } from "./asset-detail-client";

interface AssetDetailPageProps {
  params: { id: string };
}

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const id = Number(params.id);
  if (isNaN(id)) {
    notFound();
  }

  const [assetResult, modelsResult, employeesResult] = await Promise.all([
    getAssetById(id),
    getComponentModels(),
    getEmployees(),
  ]);

  if (!assetResult.success) {
    notFound();
  }

  const componentModels = modelsResult.success ? modelsResult.data : [];
  const employees = employeesResult.success ? employeesResult.data : [];

  // 调拨弹窗要显示该分类的分配规则（唯一 / 普通），这里取一次
  const category = await prisma.assetCategory.findUnique({
    where: { id: assetResult.data.categoryId },
    select: { name: true, unique: true },
  });

  return (
    <AssetDetailClient
      asset={assetResult.data}
      componentModels={componentModels}
      employees={employees}
      category={category ?? undefined}
    />
  );
}
