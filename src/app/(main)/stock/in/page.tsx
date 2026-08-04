export const dynamic = 'force-dynamic';

import { getDeviceTemplates } from "@/actions/device-template.actions";
import { StockInClient } from "./stock-in-client";

export default async function StockInPage() {
  const templatesResult = await getDeviceTemplates({});

  const templates = templatesResult.success
    ? templatesResult.data.map((t) => ({
        id: t.id,
        name: t.name,
        components: t.components.map((c) => ({
          modelId: c.modelId,
          modelName: c.modelName,
          modelBrand: c.modelBrand,
          quantity: c.quantity,
        })),
      }))
    : [];

  return <StockInClient templates={templates} />;
}