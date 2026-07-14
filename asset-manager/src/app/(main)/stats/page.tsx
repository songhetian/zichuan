import { getAssetStats, getStockStats, getLifecycleTrend } from "@/actions/stats.actions";
import { StatsClient } from "./stats-client";

export default async function StatsPage() {
  const [assetStatsResult, stockStatsResult, trendResult] = await Promise.all([
    getAssetStats(),
    getStockStats(),
    getLifecycleTrend({ months: 6 }),
  ]);

  const assetStats = assetStatsResult.success ? assetStatsResult.data : null;
  const stockStats = stockStatsResult.success ? stockStatsResult.data : [];
  const trendData = trendResult.success ? trendResult.data : [];

  return <StatsClient assetStats={assetStats} stockStats={stockStats} trendData={trendData} />;
}
