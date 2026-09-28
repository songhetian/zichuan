import type { Prisma } from "@prisma/client";

/**
 * 按模板 BOM 出库配件 —— 共享事务体。
 *
 * 被建档入口复用：
 *  - `createAsset`（新建设备，按数量批量建档）；
 *  - `importAssetsFromExcel`（Excel 导入，逐行建档）。
 *
 * 内部完成：汇总每台用量 → 算可建台数并定位瓶颈 → 原子扣减 `componentStock`
 * → 写 `ASSET_BUILD`(组装设备出库) 流水。
 *
 * 约定（测试断言依赖，勿改）：
 *  - 必须在 Prisma 事务内调用；
 *  - 库存不足即抛 `INSUFFICIENT_STOCK:` 前缀错误，由调用方转成用户可见文案 —— 整单拒绝，不产生半台设备；
 *  - 无 BOM 的模板（显示器等外设）不受配件约束，直接放行。
 */
export interface BomTemplate {
  name: string;
  components: { modelId: number; quantity: number; model: { name: string } }[];
}

export const INSUFFICIENT_STOCK_PREFIX = "INSUFFICIENT_STOCK:";

/**
 * 按「模板每台用量 × 数量」扣减配件库存并写 ASSET_BUILD 流水。
 *
 * 提示停留在模板口径：报错说的是"这个模板最多还能建几台、卡在哪个配件上"，
 * 而不是"某配件还差几件"——操作者建的是设备，不该被拽到配件账本上。
 */
export async function consumeBomStock(
  tx: Prisma.TransactionClient,
  template: BomTemplate,
  quantity: number,
  operator: string
): Promise<void> {
  // 汇总每台的配件用量（同一型号可能出现在多行 BOM）
  const perDevice = new Map<number, { modelId: number; name: string; perDevice: number }>();
  for (const bom of template.components) {
    const item = perDevice.get(bom.modelId);
    if (item) item.perDevice += bom.quantity;
    else
      perDevice.set(bom.modelId, {
        modelId: bom.modelId,
        name: bom.model.name,
        perDevice: bom.quantity,
      });
  }
  // 无 BOM 的外设模板不受配件库存约束
  if (perDevice.size === 0) return;

  const shortage = (maxBuildable: number, bottleneck: string) =>
    `${INSUFFICIENT_STOCK_PREFIX}「${template.name}」最多可建 ${maxBuildable} 台，本次要建 ${quantity} 台（受 ${bottleneck} 库存限制）`;

  // 1) 按「配件库存 ÷ 每台用量」算出最多可建台数，并定位瓶颈配件
  let maxBuildable = Number.POSITIVE_INFINITY;
  let bottleneck = "";
  for (const item of perDevice.values()) {
    const stock = await tx.componentStock.findUnique({ where: { modelId: item.modelId } });
    const buildable = Math.floor((stock?.quantity ?? 0) / item.perDevice);
    if (buildable < maxBuildable) {
      maxBuildable = buildable;
      bottleneck = item.name;
    }
  }
  if (maxBuildable < quantity) {
    throw new Error(shortage(maxBuildable, bottleneck));
  }

  // 2) 原子扣减库存并记录组装出库流水（quantity:{gte} 防并发超卖）
  for (const item of perDevice.values()) {
    const required = item.perDevice * quantity;
    const updated = await tx.componentStock.updateMany({
      where: { modelId: item.modelId, quantity: { gte: required } },
      data: { quantity: { decrement: required } },
    });
    if (updated.count === 0) {
      // 并发下被抢走库存：回落到该配件自己的口径
      throw new Error(shortage(maxBuildable, item.name));
    }
    await tx.componentStockLog.create({
      data: {
        modelId: item.modelId,
        type: "ASSET_BUILD",
        quantity: -required,
        operator,
        remark: `组装设备出库：按模板 ${template.name} 生成 ${quantity} 台`,
      },
    });
  }
}
