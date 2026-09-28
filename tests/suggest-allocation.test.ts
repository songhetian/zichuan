import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { suggestAllocation } from "@/actions/stats.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupFifo() {
  const cat = await prisma.assetCategory.create({ data: { name: "计算机", code: "DN" } });
  const cat2 = await prisma.assetCategory.create({ data: { name: "网络设备", code: "WL" } });
  const tpl = await prisma.deviceTemplate.create({ data: { name: "标准电脑", categoryId: cat.id } });
  const tpl2 = await prisma.deviceTemplate.create({ data: { name: "交换机", categoryId: cat2.id } });
  const now = Date.now();

  const oldest = await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "最早建档", templateId: tpl.id, status: "IDLE", createdAt: new Date(now - 30 * 86400000) },
  });
  const newer = await prisma.asset.create({
    data: { assetNo: "DN-0002", name: "较晚建档", templateId: tpl.id, status: "IDLE", createdAt: new Date(now - 20 * 86400000) },
  });
  // 在用设备不可参与分配
  await prisma.asset.create({
    data: { assetNo: "DN-0003", name: "在用机", templateId: tpl.id, status: "IN_USE", createdAt: new Date(now - 5 * 86400000) },
  });
  // 其他分类设备不参与本分类建议
  await prisma.asset.create({
    data: { assetNo: "WL-0001", name: "交换机", templateId: tpl2.id, status: "IDLE", createdAt: new Date(now - 1 * 86400000) },
  });

  return { cat, tpl, oldest, newer };
}

describe("分配建议 FIFO", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("suggestAllocation", () => {
    it("按建档先后(FIFO)返回可分配资产，仅闲置态且限定分类，忽略在用设备", async () => {
      const { cat } = await setupFifo();

      const result = await suggestAllocation({ categoryId: cat.id });
      expect(result.success).toBe(true);
      const data = unwrap(result);

      // 只有同分类的两台可分配资产，且按建档时间升序
      expect(data.rows.map((r) => r.assetNo)).toEqual(["DN-0001", "DN-0002"]);
      expect(data.total).toBe(2);
    });

    it("不指定分类时返回全部可分配资产，仍按 FIFO 排序", async () => {
      await setupFifo();

      const result = await suggestAllocation();
      expect(result.success).toBe(true);
      const data = unwrap(result);

      // DN-0001(30d) < DN-0002(20d) < WL-0001(1d)；DN-0003 在用排除
      expect(data.rows.map((r) => r.assetNo)).toEqual(["DN-0001", "DN-0002", "WL-0001"]);
    });
  });
});