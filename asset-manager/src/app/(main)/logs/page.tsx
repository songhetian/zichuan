import { getSystemLogs } from "@/actions/system-log.actions";
import { LogListClient } from "./log-list-client";

interface LogsPageProps {
  searchParams: { module?: string };
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const result = await getSystemLogs({
    module: searchParams.module,
  });

  const logs = result.success ? result.data : [];

  return <LogListClient logs={logs} currentModule={searchParams.module ?? ""} />;
}
