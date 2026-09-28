export const dynamic = "force-dynamic";

import { listPurchaseRecords } from "@/actions/purchase.actions";
import { getComponentCategories } from "@/actions/component-category.actions";
import { PurchaseRecordsClient } from "./purchase-records-client";

export default async function PurchaseRecordsPage() {
  const [recs, cats] = await Promise.all([
    listPurchaseRecords({}),
    getComponentCategories(),
  ]);

  return (
    <PurchaseRecordsClient
      initialItems={recs.success ? recs.data.items : []}
      categories={cats.success ? cats.data : []}
    />
  );
}