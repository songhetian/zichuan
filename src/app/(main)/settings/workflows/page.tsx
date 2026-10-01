import type { Metadata } from "next";
export const dynamic = 'force-dynamic';

import { getWorkflowDefinitions } from "@/actions/workflow.actions";
import { WorkflowsClient } from "./workflows-client";

export const metadata: Metadata = { title: "流程配置" };

export default async function WorkflowsPage() {
  const res = await getWorkflowDefinitions("ASSET_UPGRADE");
  const definitions = res.success
    ? res.data.map((d) => ({
        ...d,
        publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
      }))
    : [];

  return <WorkflowsClient initialDefinitions={definitions} />;
}
