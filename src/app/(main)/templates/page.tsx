export const dynamic = 'force-dynamic';

import { getDeviceTemplates } from "@/actions/device-template.actions";
import { getAssetCategories } from "@/actions/asset-category.actions";
import { getComponentModels } from "@/actions/component-model.actions";
import { getComponentCategories } from "@/actions/component-category.actions";
import { TemplateListClient } from "./template-list-client";

export default async function TemplatesPage() {
  const [templatesResult, categoriesResult, componentModelsResult, componentCategoriesResult] =
    await Promise.all([
      getDeviceTemplates({}),
      getAssetCategories(),
      getComponentModels({}),
      getComponentCategories(),
    ]);

  const templates = templatesResult.success ? templatesResult.data : [];
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const componentModelsRaw = componentModelsResult.success
    ? componentModelsResult.data
    : [];
  const componentCategories = componentCategoriesResult.success
    ? componentCategoriesResult.data
    : [];

  // 构建 categoryId → categoryName 映射，并 join 到配件型号数据中
  const categoryNameMap = new Map(componentCategories.map((c) => [c.id, c.name]));
  const componentModels = componentModelsRaw.map((m) => ({
    id: m.id,
    name: m.name,
    brand: m.brand || null,
    categoryId: m.categoryId,
    categoryName: categoryNameMap.get(m.categoryId) ?? "未分类",
  }));

  // 扁平化分类列表供 BomTable 使用
  const flatCategories = componentCategories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <TemplateListClient
      templates={templates}
      categories={categories}
      componentModels={componentModels}
      componentCategories={flatCategories}
    />
  );
}
