import type { Metadata } from "next";
export const dynamic = 'force-dynamic';

import { getComponentCategories } from "@/actions/component-category.actions";
import { ComponentCategoriesClient } from "./component-categories-client";

export const metadata: Metadata = { title: "配件分类" };

export default async function ComponentCategoriesPage() {
  const result = await getComponentCategories();
  const categories = result.success ? result.data : [];

  return <ComponentCategoriesClient initialCategories={categories} />;
}