import { getAssetById } from "@/actions/asset.actions";
import { getComponentModels } from "@/actions/component-model.actions";
import { getEmployees } from "@/actions/employee.actions";
import { notFound } from "next/navigation";
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

  return <AssetDetailClient asset={assetResult.data} componentModels={componentModels} employees={employees} />;
}
