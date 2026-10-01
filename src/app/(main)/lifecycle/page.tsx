import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { getAssetLifecycleView } from "@/actions/asset-lifecycle.actions";
import { AssetLifecycleClient } from "./lifecycle-client";

export const metadata: Metadata = { title: "设备生命周期" };

export default async function LifecyclePage() {
  const res = await getAssetLifecycleView();
  const initial = res.success
    ? res.data
    : { data: [], total: 0, page: 1, pageSize: 10, departments: [], employees: [], actionOptions: [] };

  return <AssetLifecycleClient initial={initial} />;
}