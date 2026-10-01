import type { Metadata } from "next";
export const dynamic = 'force-dynamic';

import { getSystemLogs } from "@/actions/system-log.actions";
import { getLifecycleLogs } from "@/actions/lifecycle-log.actions";
import { LogListClient } from "./log-list-client";

export const metadata: Metadata = { title: "操作日志" };

export default async function LogsPage() {
  const [systemResult, lifecycleResult] = await Promise.all([
    getSystemLogs(),
    getLifecycleLogs(),
  ]);

  return (
    <LogListClient
      initialLogs={systemResult.success ? systemResult.data : []}
      initialLifecycleLogs={lifecycleResult.success ? lifecycleResult.data : []}
    />
  );
}