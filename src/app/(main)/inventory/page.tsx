export const dynamic = "force-dynamic";

import {
  getAssetAgeStats,
  getStockReconciliation,
  suggestAllocation,
} from "@/actions/stats.actions";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const [ageRes, reconRes, allocRes] = await Promise.all([
    getAssetAgeStats(),
    getStockReconciliation(),
    suggestAllocation(),
  ]);

  return (
    <InventoryClient
      age={ageRes.success ? ageRes.data : null}
      recon={reconRes.success ? reconRes.data : null}
      alloc={allocRes.success ? allocRes.data : null}
    />
  );
}
