import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { ExecuteClient } from "./execute-client";

export const metadata: Metadata = { title: "待执行变更" };

export default async function ExecutePage() {
  return <ExecuteClient />;
}