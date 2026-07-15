import { getDeviceTemplates } from "@/actions/device-template.actions";
import { getAssetCategories } from "@/actions/asset-category.actions";
import { getComponentModels } from "@/actions/component-model.actions";
import { TemplateListClient } from "./template-list-client";

export default async function TemplatesPage() {
  const [templatesResult, categoriesResult, componentModelsResult] =
    await Promise.all([
      getDeviceTemplates({}),
      getAssetCategories(),
      getComponentModels({}),
    ]);

  const templates = templatesResult.success ? templatesResult.data : [];
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const componentModels = componentModelsResult.success
    ? componentModelsResult.data
    : [];

  return (
    <TemplateListClient
      templates={templates}
      categories={categories}
      componentModels={componentModels}
    />
  );
}
