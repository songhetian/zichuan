import type { Metadata } from "next";
export const dynamic = 'force-dynamic';

import { notFound } from "next/navigation";
import { getStocktakeSessionById } from "@/actions/stocktake.actions";
import { StocktakeDetailClient } from "./stocktake-detail-client";

interface PageProps {
  params: { id: string };
}

export const metadata: Metadata = { title: "盘点详情" };

export default async function StocktakeDetailPage({ params }: PageProps) {
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    notFound();
  }

  const result = await getStocktakeSessionById(id);
  if (!result.success) {
    notFound();
  }

  const { records, ...session } = result.data;

  return <StocktakeDetailClient session={session} records={records} />;
}
