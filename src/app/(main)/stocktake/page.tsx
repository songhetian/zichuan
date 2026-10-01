import type { Metadata } from "next";
export const dynamic = 'force-dynamic';

import { getStocktakeSessions } from "@/actions/stocktake.actions";
import { StocktakeListClient } from "./stocktake-list-client";

export const metadata: Metadata = { title: "库存盘点" };

export default async function StocktakePage() {
  const result = await getStocktakeSessions();
  const sessions = result.success ? result.data : [];

  return <StocktakeListClient sessions={sessions} />;
}
