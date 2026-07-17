export const dynamic = 'force-dynamic';

import { getComponentModels } from "@/actions/component-model.actions";
import { getComponentCategories } from "@/actions/component-category.actions";
import { ModelsClient } from "./models-client";

export default async function ModelsPage() {
  const [modelsResult, categoriesResult] = await Promise.all([
    getComponentModels({}),
    getComponentCategories(),
  ]);

  const models = modelsResult.success ? modelsResult.data : [];
  const categories = categoriesResult.success ? categoriesResult.data : [];

  return <ModelsClient models={models} categories={categories} />;
}