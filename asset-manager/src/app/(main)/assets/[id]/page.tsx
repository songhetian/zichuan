import { getAssetById } from "@/actions/asset.actions";
import { getComponentModels } from "@/actions/component-model.actions";
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

  const [assetResult, modelsResult] = await Promise.all([
    getAssetById(id),
    getComponentModels(),
  ]);

  if (!assetResult.success) {
    notFound();
  }

  const componentModels = modelsResult.success ? modelsResult.data : [];

  return <AssetDetailClient asset={assetResult.data} componentModels={componentModels} />;
}
