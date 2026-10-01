import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { getHandoverOrders } from "@/actions/approval-depart.actions";
import { HandoverListClient } from "./handover-list-client";

export const metadata: Metadata = { title: "交接对账" };

export default async function HandoverRecordsPage() {
  // 默认落「待对账」——资产管理员进这个页面的目的就是把待回收的单处理掉
  const res = await getHandoverOrders({ status: "PENDING" });
  return <HandoverListClient initial={res.success ? res.data : []} />;
}
