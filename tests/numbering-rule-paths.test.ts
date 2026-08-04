import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { createAsset, batchCreateAssets } from "@/actions/asset.actions";
import { importAssetsAuto } from "@/actions/auto-import.actions";
import { importAssetsFromExcel } from "@/actions/excel.actions";
import { unwrap } from "./helpers";
import * as XLSX from "xlsx";

// ============================================================
// 测试 seam：编号规则在所有设备创建路径中都应被尊重
// 路径：1) createAsset  2) batchCreateAssets  3) importAssetsAuto（硬件扫描）
//       4) importAssetsFromExcel（Excel 导入）
// 用户报告：已设置 numberingRule 但仍生成 PC-0001 旧格式
// ============================================================

function today(): { y: string; m: string; d: string } {
  const t = new Date();
  return {
    y: t.getFullYear().toString(),
    m: String(t.getMonth() + 1).padStart(2, "0"),
    d: String(t.getDate()).padStart(2, "0"),
  };
}

function createExcelBuffer(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("编号规则在所有路径生效", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("createAsset 尊重分类的 numberingRule", async () => {
    // 创建分类并设置日期规则
    const cat = await prisma.assetCategory.create({
      data: {
        name: `规则分类_create_${Date.now()}`,
        code: "PC",
        numberingRule: "{prefix}-{YYYY}{MM}{DD}-{####}",
      },
    });
    const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
    const cpu = await prisma.componentModel.create({
      data: { name: "i5-12400", brand: "Intel", categoryId: compCat.id },
    });
    const template = await prisma.deviceTemplate.create({
      data: {
        name: "测试模板",
        categoryId: cat.id,
        components: { create: [{ modelId: cpu.id, quantity: 1 }] },
      },
    });

    const result = await createAsset({
      templateId: template.id,
      name: "测试设备",
      operator: "admin",
    });

    const { y, m, d } = today();
    expect(unwrap(result).assetNo).toBe(`PC-${y}${m}${d}-0001`);
  });

  it("batchCreateAssets 尊重分类的 numberingRule", async () => {
    const cat = await prisma.assetCategory.create({
      data: {
        name: `规则分类_batch_${Date.now()}`,
        code: "PC",
        numberingRule: "{prefix}-{YYYY}{MM}{DD}-{####}",
      },
    });
    const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
    const cpu = await prisma.componentModel.create({
      data: { name: "i5-12400", brand: "Intel", categoryId: compCat.id },
    });
    const template = await prisma.deviceTemplate.create({
      data: {
        name: "测试模板",
        categoryId: cat.id,
        components: { create: [{ modelId: cpu.id, quantity: 1 }] },
      },
    });

    const result = await batchCreateAssets({
      templateId: template.id,
      count: 2,
      operator: "admin",
    });
    const assets = unwrap(result);

    const { y, m, d } = today();
    expect(assets[0].assetNo).toBe(`PC-${y}${m}${d}-0001`);
    expect(assets[1].assetNo).toBe(`PC-${y}${m}${d}-0002`);
  });

  it("importAssetsAuto（硬件扫描）尊重已存在分类的 numberingRule", async () => {
    // 用户已通过 UI 创建了 "电脑主机" 分类（code=PC）并设置了 numberingRule
    await prisma.assetCategory.create({
      data: {
        name: "电脑主机",
        code: "PC",
        numberingRule: "{prefix}-{YYYY}{MM}{DD}-{####}",
      },
    });

    const result = await importAssetsAuto({
      assets: [
        {
          employeeName: "张三",
          departmentName: "技术部",
          deviceName: "张三的电脑",
          categoryName: "电脑主机", // 与已存在分类同名
          categoryCode: "PC",
          components: [{ category: "CPU", name: "i7-12700", brand: "Intel" }],
        },
      ],
    });

    const { y, m, d } = today();
    expect(unwrap(result).details[0].assetNo).toBe(`PC-${y}${m}${d}-0001`);
  });

  it("importAssetsFromExcel 尊重模板分类的 numberingRule", async () => {
    // 创建带规则分类的模板
    const cat = await prisma.assetCategory.create({
      data: {
        name: `Excel规则分类_${Date.now()}`,
        code: "PC",
        numberingRule: "{prefix}-{YYYY}{MM}{DD}-{####}",
      },
    });
    const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
    const cpu = await prisma.componentModel.create({
      data: { name: "i5-12400", brand: "Intel", categoryId: compCat.id },
    });
    const template = await prisma.deviceTemplate.create({
      data: {
        name: "Excel导入模板",
        categoryId: cat.id,
        components: { create: [{ modelId: cpu.id, quantity: 1 }] },
      },
    });

    const buffer = createExcelBuffer([
      { "设备名称": "测试设备", "设备模板": "Excel导入模板", "使用人": "" },
    ]);

    const result = await importAssetsFromExcel({ buffer: Array.from(buffer) });

    expect(result.success).toBe(true);
    const asset = await prisma.asset.findFirst({
      where: { name: "测试设备" },
    });
    expect(asset).not.toBeNull();
    const { y, m, d } = today();
    expect(asset!.assetNo).toBe(`PC-${y}${m}${d}-0001`);
  });
});
