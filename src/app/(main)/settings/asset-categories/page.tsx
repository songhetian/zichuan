export const dynamic = 'force-dynamic';

import { getAssetCategories } from "@/actions/asset-category.actions";
import { AssetCategoriesClient } from "./asset-categories-client";

export default async function AssetCategoriesPage() {
  const result = await getAssetCategories();
  const categories = result.success ? result.data : [];

  return <AssetCategoriesClient initialCategories={categories} />;
}