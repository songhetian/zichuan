export const dynamic = "force-dynamic";

import { ApprovalDetailClient } from "./approval-detail-client";

export default async function ApprovalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <ApprovalDetailClient requestId={Number(params.id)} />;
}
