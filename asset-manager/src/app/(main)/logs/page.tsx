import { getSystemLogs } from "@/actions/system-log.actions";
import { getLifecycleLogs } from "@/actions/lifecycle-log.actions";
import { LogListClient } from "./log-list-client";

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