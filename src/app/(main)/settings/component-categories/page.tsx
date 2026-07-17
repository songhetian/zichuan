export const dynamic = 'force-dynamic';

import { getComponentCategories } from "@/actions/component-category.actions";
import { ComponentCategoriesClient } from "./component-categories-client";

export default async function ComponentCategoriesPage() {
  const result = await getComponentCategories();
  const categories = result.success ? result.data : [];

  return <ComponentCategoriesClient initialCategories={categories} />;
}