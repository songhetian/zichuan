import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { createAsset, updateAsset, getAssets } from "@/actions/asset.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

/**
 * 外设（显示器/打印机等）的品牌与型号挂在【设备模板】上：同类设备的品牌型号只登记一次，
 * 建档时自动带出到每台设备。序列号仍逐台登记（一机一号），设备层字段均可空。
 */

async function setupTemplate() {
  const assetCat = await prisma.assetCategory.create({
    data: { name: "显示设备", code: "XS" },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: "戴尔显示器", categoryId: assetCat.id, brand: "戴尔", model: "U2723QE" },
  });
  return { assetCat, template };
}

describe("设备品牌 / 型号 / 序列号", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("createAsset", () => {
    it("品牌 / 型号自动带出模板的值，序列号仍逐台登记", async () => {
      const { template } = await setupTemplate();

      const result = await createAsset({
        templateId: template.id,
        serialNo: "CN-0A1B2C3",
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result)[0].brand).toBe("戴尔");
      expect(unwrap(result)[0].model).toBe("U2723QE");
      expect(unwrap(result)[0].serialNo).toBe("CN-0A1B2C3");
    });

    it("批量建档时每台设备都带出模板品牌 / 型号", async () => {
      const { template } = await setupTemplate();

      const result = await createAsset({
        templateId: template.id,
        quantity: 2,
        operator: "admin",
      });

      const assets = unwrap(result);
      expect(assets).toHaveLength(2);
      expect(assets.every((a) => a.brand === "戴尔")).toBe(true);
      expect(assets.every((a) => a.model === "U2723QE")).toBe(true);
    });

    it("模板未填品牌 / 型号时设备为空（三个字段均可空）", async () => {
      const assetCat = await prisma.assetCategory.create({
        data: { name: "打印设备", code: "DY" },
      });
      const template = await prisma.deviceTemplate.create({
        data: { name: "通用打印机", categoryId: assetCat.id },
      });

      const result = await createAsset({
        templateId: template.id,
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result)[0].brand).toBeNull();
      expect(unwrap(result)[0].model).toBeNull();
      expect(unwrap(result)[0].serialNo).toBeNull();
    });
  });

  describe("updateAsset", () => {
    it("可以补录与修改品牌 / 型号 / 序列号", async () => {
      const { template } = await setupTemplate();
      const created = await createAsset({
        templateId: template.id,
        operator: "admin",
      });

      const result = await updateAsset(unwrap(created)[0].id, {
        brand: "AOC",
        model: "Q27G2S",
        serialNo: "SN-0001",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).brand).toBe("AOC");
      expect(unwrap(result).model).toBe("Q27G2S");
      expect(unwrap(result).serialNo).toBe("SN-0001");
    });

    it("传 null 可清空品牌 / 型号 / 序列号", async () => {
      const { template } = await setupTemplate();
      const created = await createAsset({
        templateId: template.id,
        serialNo: "CN-0A1B2C3",
        operator: "admin",
      });

      const result = await updateAsset(unwrap(created)[0].id, {
        brand: null,
        model: null,
        serialNo: null,
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).brand).toBeNull();
      expect(unwrap(result).model).toBeNull();
      expect(unwrap(result).serialNo).toBeNull();
    });
  });

  describe("getAssets 关键词搜索", () => {
    it("关键词可命中模板带出的品牌 / 型号，以及设备序列号", async () => {
      const { assetCat, template } = await setupTemplate();
      const aocTemplate = await prisma.deviceTemplate.create({
        data: { name: "AOC 显示器", categoryId: assetCat.id, brand: "AOC", model: "Q27G2S" },
      });

      await createAsset({
        templateId: template.id,
        serialNo: "CN-0A1B2C3",
        operator: "admin",
      });
      await createAsset({
        templateId: aocTemplate.id,
        serialNo: "SN-0002",
        operator: "admin",
      });

      expect(unwrap(await getAssets({ keyword: "戴尔" }))).toHaveLength(1);
      expect(unwrap(await getAssets({ keyword: "Q27G2S" }))).toHaveLength(1);
      expect(unwrap(await getAssets({ keyword: "CN-0A1B2C3" }))).toHaveLength(1);
      // 命中不同设备，验证没有串号
      expect(unwrap(await getAssets({ keyword: "戴尔" }))[0].serialNo).toBe("CN-0A1B2C3");
    });
  });
});
