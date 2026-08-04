import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { createAssetCategory } from "@/actions/asset-category.actions";
import { createComponentCategory } from "@/actions/component-category.actions";
import { createComponentModel } from "@/actions/component-model.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { batchCreateAssets, getAssets } from "@/actions/asset.actions";
import { unwrap } from "./helpers";

// ============================================================
// 测试 seam：getAssets 分页
// ============================================================

let _counter = 0;

async function setupWithAssets(count: number) {
  const assetCat = await createAssetCategory({
    name: `分页测试_${Date.now()}_${++_counter}`,
    code: `PG_${Date.now()}_${_counter}`,
  });
  const cat = unwrap(assetCat);

  const compCat = await createComponentCategory({ name: `CPU_${Date.now()}_${++_counter}` });
  const cpuCat = unwrap(compCat);
  const cpu = await createComponentModel({
    name: "i5-12400",
    brand: "Intel",
    categoryId: cpuCat.id,
  });
  const cpuModel = unwrap(cpu);
  await purchaseStockIn({ modelId: cpuModel.id, quantity: 100, operator: "admin" });

  const template = await prisma.deviceTemplate.create({
    data: {
      name: `分页模板_${Date.now()}_${_counter}`,
      categoryId: cat.id,
      components: {
        create: [{ modelId: cpuModel.id, quantity: 1 }],
      },
    },
  });

  await batchCreateAssets({
    templateId: template.id,
    count,
    operator: "admin",
  });
}

describe("getAssets 分页", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("默认不传分页参数时返回全部数据", async () => {
    await setupWithAssets(5);

    const result = await getAssets();
    const data = unwrap(result);

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(5);
  });

  it("page=1 pageSize=3 返回前 3 条", async () => {
    await setupWithAssets(5);

    const result = await getAssets({ page: 1, pageSize: 3 });
    const data = unwrap(result);

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("page=2 pageSize=3 返回第 4-6 条", async () => {
    await setupWithAssets(5);

    const result = await getAssets({ page: 2, pageSize: 3 });
    const data = unwrap(result);

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("超出范围的分页返回空数组", async () => {
    await setupWithAssets(3);

    const result = await getAssets({ page: 99, pageSize: 10 });
    const data = unwrap(result);

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });
});