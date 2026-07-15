import { getStockLogs } from "@/actions/component-stock.actions";
import { getComponentModels } from "@/actions/component-model.actions";
import { StockLogClient } from "./stock-log-client";

export default async function StockLogPage() {
  const [logsResult, modelsResult] = await Promise.all([
    getStockLogs({}),
    getComponentModels({}),
  ]);

  const logs = logsResult.success
    ? logsResult.data.map((log) => ({
        ...log,
        modelName: modelsResult.success
          ? modelsResult.data.find((m) => m.id === log.modelId)?.name ?? ""
          : "",
      }))
    : [];

  const componentModels = modelsResult.success
    ? modelsResult.data.map((m) => ({
        id: m.id,
        name: m.name,
        brand: m.brand,
      }))
    : [];

  return <StockLogClient logs={logs} componentModels={componentModels} />;
}