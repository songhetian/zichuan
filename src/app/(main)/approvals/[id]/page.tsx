import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { ApprovalDetailClient } from "./approval-detail-client";

export const metadata: Metadata = { title: "申请单详情" };

export default async function ApprovalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <ApprovalDetailClient requestId={Number(params.id)} />;
}
