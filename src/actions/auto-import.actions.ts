"use server";

import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { cleanErrorMessage } from "@/lib/sanitize-error";
import { generateAssetNo } from "@/lib/asset-numbering";
import { BOM_SUFFIX_SEPARATOR, bomFingerprint } from "@/lib/template-normalize";
import { COMPONENT_LAYER_CATEGORIES } from "@/lib/constants";
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

// ============================================================
// 类型定义
// ============================================================

interface HardwareComponent {
  category: string;  // 配件分类名称，如 "CPU"
  name: string;      // 配件型号名称
  brand: string;     // 品牌
}

interface HardwareAssetInput {
  employeeName: string;     // 使用人姓名
  departmentName: string;   // 部门名称
  deviceName: string;       // 设备名称
  categoryName: string;     // 设备分类名称
  categoryCode?: string;    // 设备分类编号前缀；缺省时沿用已存在分类的 code，新建分类回退中性前缀
  components: HardwareComponent[];
  brand?: string;           // 设备品牌（落在 Asset 自身字段）
  model?: string;           // 设备型号（落在 Asset 自身字段）
  serialNo?: string;        // 设备序列号（落在 Asset 自身字段）
}

interface ImportResult {
  importedCount: number;
  errors: string[];
  details: Array<{
    row: number;
    assetNo: string;
    deviceName: string;
    employeeName: string;
    componentsCreated: number;
    templateName: string;
    templateIsNew: boolean;
  }>;
}

// ============================================================
// Helpers - 查找或创建（使用 Prisma TransactionClient）
// ============================================================

type Tx = Prisma.TransactionClient;

async function getOrCreateAssetCategory(
  tx: Tx,
  name: string,
  code?: string
): Promise<{ id: number; code: string; numberingRule: string | null }> {
  const existing = await tx.assetCategory.findUnique({ where: { name } });
  if (existing) return { id: existing.id, code: existing.code, numberingRule: existing.numberingRule };

  // 来源未提供编号前缀（Excel 缺「设备分类编号」列）时用中性前缀，
  // 不能写死「PC」——外设（显示器、打印机等）同样走设备层，挂到 PC 前缀上是错的
  const requestedCode = code?.trim() || "EQ";
  const codeExists = await tx.assetCategory.findUnique({ where: { code: requestedCode } });
  const finalCode = codeExists ? `${requestedCode}_${Date.now()}` : requestedCode;

  const created = await tx.assetCategory.create({
    data: { name, code: finalCode },
  });
  return { id: created.id, code: created.code, numberingRule: created.numberingRule };
}

async function getOrCreateComponentCategory(
  tx: Tx,
  name: string
): Promise<number> {
  const existing = await tx.componentCategory.findUnique({ where: { name } });
  if (existing) return existing.id;

  const created = await tx.componentCategory.create({
    data: { name },
  });
  return created.id;
}

async function getOrCreateComponentModel(
  tx: Tx,
  categoryId: number,
  name: string,
  brand: string
): Promise<number> {
  // 型号唯一键为 (categoryId, name, brand)：保留品牌维度，同规格不同品牌是两个型号
  // （对应迁移 20260917160000_restore_brand_dimension）
  const normalizedBrand = brand.trim();

  const existing = await tx.componentModel.findUnique({
    where: {
      categoryId_name_brand: { categoryId, name, brand: normalizedBrand },
    },
  });

  if (existing) return existing.id;

  // 迁移语义：自动导入新建的配件型号给一个名义库存 1（并记 PURCHASE_IN），
  // 而非真实采购入库；复用已有型号则完全不动库存。切勿改为「按 BOM 扣减」——见下方 7.5 说明。
  const created = await tx.componentModel.create({
    data: {
      name,
      brand: normalizedBrand,
      categoryId,
      stock: { create: { quantity: 1 } },
    },
  });

  await tx.componentStockLog.create({
    data: {
      modelId: created.id,
      type: "PURCHASE_IN",
      quantity: 1,
      operator: "system",
      remark: "自动导入创建",
    },
  });

  return created.id;
}

// ============================================================
// 模板名称生成 - 根据配件组合生成唯一模板名
// 规则：分类名 + 主要配置摘要（CPU/内存/硬盘）
// ============================================================

function generateTemplateName(
  categoryName: string,
  components: HardwareComponent[]
): string {
  const parts: string[] = [];

  // CPU：取第一个 CPU 的简短型号
  const cpu = components.find((c) => c.category === "CPU");
  if (cpu) {
    const shortName = cpu.name
      .replace(/12th Gen Intel\(R\) Core\(TM\) /i, "")
      .replace(/12th Gen Intel Core /i, "")
      .replace(/Intel\(R\) Core\(TM\) /i, "")
      .replace(/Intel Core /i, "")
      .trim()
      .split(" ")[0];
    if (shortName) parts.push(shortName);
  }

  // 内存：汇总所有内存组件的容量
  let totalMemoryGB = 0;
  for (const mem of components) {
    if (mem.category === "内存") {
      const match = mem.name.match(/(\d+)\s*GB/i);
      if (match) totalMemoryGB += parseInt(match[1], 10);
    }
  }
  if (totalMemoryGB > 0) parts.push(`${totalMemoryGB}GB`);

  // 硬盘：汇总所有硬盘组件的容量
  let totalDiskGB = 0;
  let hasSSD = false;
  let hasHDD = false;
  for (const disk of components) {
    if (disk.category === "硬盘") {
      const gbMatch = disk.name.match(/(\d+)\s*GB/i);
      if (gbMatch) totalDiskGB += parseInt(gbMatch[1], 10);
      const tbMatch = disk.name.match(/(\d+)\s*TB/i);
      if (tbMatch) totalDiskGB += parseInt(tbMatch[1], 10) * 1000;

      if (disk.name.toLowerCase().includes("ssd") || disk.name.toLowerCase().includes("nvme")) hasSSD = true;
      if (disk.name.toLowerCase().includes("hdd")) hasHDD = true;
    }
  }
  if (totalDiskGB > 0) {
    if (totalDiskGB >= 1000) {
      parts.push(`${(totalDiskGB / 1000).toFixed(totalDiskGB % 1000 === 0 ? 0 : 1)}TB`);
    } else {
      parts.push(`${totalDiskGB}GB`);
    }
    if (hasSSD && !hasHDD) parts.push("SSD");
    else if (hasHDD && !hasSSD) parts.push("HDD");
  }

  if (parts.length === 0) {
    return categoryName;
  }

  return `${categoryName} (${parts.join(" / ")})`;
}

function templateBomMatches(
  templateComponents: Array<{ modelId: number; quantity: number }>,
  componentMappings: Array<{ modelId: number; quantity: number }>
): boolean {
  if (templateComponents.length !== componentMappings.length) return false;

  const sortedA = [...templateComponents].sort((a, b) => a.modelId - b.modelId);
  const sortedB = [...componentMappings].sort((a, b) => a.modelId - b.modelId);

  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].modelId !== sortedB[i].modelId) return false;
    if (sortedA[i].quantity !== sortedB[i].quantity) return false;
  }

  return true;
}

async function findOrCreateDeviceTemplate(
  tx: Tx,
  categoryId: number,
  categoryName: string,
  components: HardwareComponent[],
  componentMappings: Array<{ modelId: number; quantity: number }>
): Promise<{ id: number; name: string; isNew: boolean }> {
  const templateName = generateTemplateName(categoryName, components);

  const sameNameTemplates = await tx.deviceTemplate.findMany({
    where: { categoryId, name: templateName },
    include: { components: true },
  });

  for (const tpl of sameNameTemplates) {
    if (templateBomMatches(tpl.components, componentMappings)) {
      return { id: tpl.id, name: tpl.name, isNew: false };
    }
  }

  const allCategoryTemplates = await tx.deviceTemplate.findMany({
    where: { categoryId },
    include: { components: true },
  });

  for (const tpl of allCategoryTemplates) {
    if (templateBomMatches(tpl.components, componentMappings)) {
      return { id: tpl.id, name: tpl.name, isNew: false };
    }
  }

  // 同名但 BOM 不同 → 不再用 " (2)" 后缀：
  // DeviceTemplate 上的 normalizedName 生成列会剥掉 " (数字)" 后缀，
  // 重名的 (2) 模板会被唯一约束拒绝（迁移 20260917140000 有意如此）。
  // 改用由 BOM 派生的确定性短码命名（同配置恒定 → 重复导入仍收敛到同一模板）。
  let finalName = templateName;
  let attempt = 0;
  while (
    await tx.deviceTemplate.findFirst({
      where: { categoryId, name: finalName },
    })
  ) {
    attempt++;
    finalName =
      templateName +
      BOM_SUFFIX_SEPARATOR +
      bomFingerprint(componentMappings, attempt === 1 ? "" : String(attempt));
  }

  const created = await tx.deviceTemplate.create({
    data: {
      name: finalName,
      categoryId,
    },
  });

  if (componentMappings.length > 0) {
    await tx.templateComponent.createMany({
      data: componentMappings.map((c) => ({
        templateId: created.id,
        modelId: c.modelId,
        quantity: c.quantity,
      })),
    });
  }

  return { id: created.id, name: finalName, isNew: true };
}

async function getOrCreateDepartment(
  tx: Tx,
  name: string
): Promise<number> {
  const existing = await tx.department.findUnique({ where: { name } });
  if (existing) return existing.id;

  const created = await tx.department.create({
    data: { name },
  });
  return created.id;
}

async function getOrCreateEmployee(
  tx: Tx,
  name: string,
  departmentId: number
): Promise<number> {
  const existing = await tx.employee.findFirst({
    where: { name, departmentId },
  });
  if (existing) return existing.id;

  const prefix = "EMP";
  const count = await tx.employee.count();
  const employeeNo = `${prefix}${String(count + 1).padStart(4, "0")}`;

  const created = await tx.employee.create({
    data: {
      employeeNo,
      name,
      departmentId,
    },
  });
  return created.id;
}

// ============================================================
// 核心导入逻辑
// ============================================================

export async function importAssetsAuto(
  input: { assets: HardwareAssetInput[] }
): Promise<ActionResult<ImportResult>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.import.execute", "自动导入资产需要执行导入权限");
  if (denied) return denied;

  if (!input.assets || input.assets.length === 0) {
    return { success: false, error: "没有要导入的设备数据" };
  }

  const errors: string[] = [];
  const details: ImportResult["details"] = [];
  let importedCount = 0;

  for (let i = 0; i < input.assets.length; i++) {
    const row = input.assets[i];
    const rowNum = i + 1;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. 设备分类（查找或创建）
        const category = await getOrCreateAssetCategory(
          tx,
          row.categoryName,
          row.categoryCode
        );

        // 2. 配件分类 + 配件型号 + 库存（查找或创建）
        const componentMappingsRaw: Array<{ modelId: number; quantity: number }> = [];
        const componentsCreated: string[] = [];

        for (const comp of row.components) {
          const compCategoryId = await getOrCreateComponentCategory(tx, comp.category);
          const modelId = await getOrCreateComponentModel(
            tx,
            compCategoryId,
            comp.name,
            comp.brand
          );
          componentMappingsRaw.push({ modelId, quantity: 1 });
          componentsCreated.push(comp.name);
        }

        // 合并相同 modelId 的映射（避免创建模板时违反唯一约束）
        const mergedMap = new Map<number, number>();
        for (const m of componentMappingsRaw) {
          mergedMap.set(m.modelId, (mergedMap.get(m.modelId) ?? 0) + m.quantity);
        }
        const componentMappings = Array.from(mergedMap.entries()).map(
          ([modelId, quantity]) => ({ modelId, quantity })
        );

        // 3. 设备模板 + BOM（按配件组合查找或创建）
        const templateResult = await findOrCreateDeviceTemplate(
          tx,
          category.id,
          row.categoryName,
          row.components,
          componentMappings
        );

        // 4. 部门（查找或创建）
        const departmentId = await getOrCreateDepartment(tx, row.departmentName);

        // 5. 员工（查找或创建）
        const employeeId = await getOrCreateEmployee(tx, row.employeeName, departmentId);

        // 6. 生成编号
        const assetNo = await generateAssetNo(tx, category.code, category.numberingRule);

        // 7. 创建设备（默认分配给使用人，状态为 IN_USE）
        const asset = await tx.asset.create({
          data: {
            assetNo,
            name: row.deviceName,
            templateId: templateResult.id,
            status: "IN_USE",
            employeeId,
            brand: row.brand || null,
            model: row.model || null,
            serialNo: row.serialNo || null,
          },
        });

        // 7.5 复制模板 BOM 配件到设备（记录配置，不扣减库存）
        // 【有意为之，勿改为扣减】自动导入定位为「存量数据迁移」：这些配件原本就不在库存系统里，
        // 若按 BOM 出库会遇到负库存并整批导入失败。故此处只落地配置，不写 ASSET_BUILD 流水。
        // 与之相对，正常建档 createAsset / 批量入库走严格 BOM 出库（负库存整单拒绝），两条入口口径不同。
        if (componentMappings.length > 0) {
          await tx.assetComponent.createMany({
            data: componentMappings.map((c) => ({
              assetId: asset.id,
              modelId: c.modelId,
              quantity: c.quantity,
            })),
          });
        }

        // 8. 记录生命周期日志
        await tx.lifecycleLog.create({
          data: {
            assetId: asset.id,
            action: "ALLOCATED",
            fromStatus: "IDLE",
            toStatus: "IN_USE",
            employeeId,
            operator: "system",
            remark: `自动导入分配给 ${row.employeeName}`,
          },
        });

        // 10. 记录系统日志
        await tx.systemLog.create({
          data: {
            module: "asset",
            action: "自动导入",
            detail: `创建设备 ${assetNo} (${row.deviceName})，分配给 ${row.employeeName}`,
            operator: "system",
          },
        });

        return {
          assetNo,
          deviceName: row.deviceName,
          employeeName: row.employeeName,
          componentsCreated: componentsCreated.length,
          templateName: templateResult.name,
          templateIsNew: templateResult.isNew,
        };
      });

      importedCount++;
      details.push({
        row: rowNum,
        assetNo: result.assetNo,
        deviceName: result.deviceName,
        employeeName: result.employeeName,
        componentsCreated: result.componentsCreated,
        templateName: result.templateName,
        templateIsNew: result.templateIsNew,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "未知错误";
      errors.push(`第${rowNum}行 (${row.deviceName}): ${cleanErrorMessage(message)}`);
    }
  }

  return {
    success: true,
    data: {
      importedCount,
      errors,
      details,
    },
  };
}

// ============================================================
// Excel 格式自动导入（从硬件扫描脚本生成的Excel导入）
// ============================================================

interface ExcelAssetRow {
  "使用人": string;
  "部门": string;
  "设备名称": string;
  "设备分类": string;
  "设备分类编号": string;
  "品牌": string;
  "型号": string;
  "序列号": string;
  // 配件列（{配件分类}型号 / {配件分类}N型号）与其余列均由白名单扫描读取
  [key: string]: string;
}

// 扫描配件列：只认配件层白名单 —— 列名形如「{配件分类}型号」「{配件分类}N型号」，
// 且 {配件分类} 命中 COMPONENT_LAYER_CATEGORIES 才算配件；
// 品牌取对应的「{配件分类}品牌」「{配件分类}N品牌」列（与列顺序一致，支持多内存/多硬盘）。
// 白名单之外的列一律跳过：设备层的「显示器型号」，以及「台式机型号」「规格型号」这类非配件列，
// 都不该在配件表里留下垃圾分类。
function parseComponentColumns(row: Record<string, string>): HardwareComponent[] {
  const components: HardwareComponent[] = [];

  for (const key of Object.keys(row)) {
    const match = key.match(/^(.+?)(\d*)型号$/);
    if (!match) continue;

    const [, category, index] = match;
    if (!COMPONENT_LAYER_CATEGORIES.includes(category)) continue;

    const name = String(row[key] ?? "").trim();
    if (!name) continue;

    const brand = String(row[`${category}${index}品牌`] ?? "").trim();
    components.push({ category, name, brand });
  }

  return components;
}

export async function importAssetsFromExcelAuto(
  input: { buffer: number[] }
): Promise<ActionResult<ImportResult>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.import.execute", "自动导入资产需要执行导入权限");
  if (denied) return denied;

  try {
    const fileBuffer = Buffer.from(input.buffer);
    const wb = XLSX.read(fileBuffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelAssetRow>(ws);

    if (rows.length === 0) {
      return { success: false, error: "Excel文件为空" };
    }

    const hardwareAssets: HardwareAssetInput[] = [];
    // 被跳过的行（缺使用人/部门、缺设备分类）统一收集，导入完成后回传给调用方展示
    const skipped: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      const employeeName = String(row["使用人"] ?? "").trim();
      const departmentName = String(row["部门"] ?? "").trim();
      const deviceName = String(row["设备名称"] ?? "").trim();
      // 设备分类必填：不再默认「电脑主机」（外设也能作为设备导入）
      const categoryName = String(row["设备分类"] ?? "").trim();
      // 编号前缀留空交由分类层决定：已存在的分类沿用自身 code，新建分类回退中性前缀
      const categoryCode = String(row["设备分类编号"] ?? "").trim();

      if (!employeeName || !departmentName) {
        skipped.push(`第${rowNum}行：缺少使用人或部门，已跳过`);
        continue;
      }
      if (!categoryName) {
        skipped.push(`第${rowNum}行：缺少设备分类，已跳过`);
        continue;
      }

      const rowRecord = row as Record<string, string>;
      const components = parseComponentColumns(rowRecord);

      hardwareAssets.push({
        employeeName,
        departmentName,
        deviceName: deviceName || `${employeeName}的${categoryName}`,
        categoryName,
        categoryCode,
        components,
        brand: String(rowRecord["品牌"] ?? "").trim(),
        model: String(rowRecord["型号"] ?? "").trim(),
        serialNo: String(rowRecord["序列号"] ?? "").trim(),
      });
    }

    if (hardwareAssets.length === 0) {
      return {
        success: false,
        error:
          skipped.length > 0
            ? `共 ${rows.length} 行，全部无法导入：${skipped.join("；")}`
            : `共 ${rows.length} 行，没有可导入的数据`,
      };
    }

    const result = await importAssetsAuto({ assets: hardwareAssets });
    if (result.success && skipped.length > 0) {
      return {
        success: true,
        data: { ...result.data, errors: [...skipped, ...result.data.errors] },
      };
    }
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Excel文件解析失败";
    return { success: false, error: cleanErrorMessage(message) };
  }
}
