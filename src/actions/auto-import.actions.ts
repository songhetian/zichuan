"use server";

import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { generateAssetNo } from "@/lib/asset-numbering";
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
  categoryCode: string;     // 设备分类编号前缀
  components: HardwareComponent[];
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
  code: string
): Promise<{ id: number; code: string; numberingRule: string | null }> {
  const existing = await tx.assetCategory.findUnique({ where: { name } });
  if (existing) return { id: existing.id, code: existing.code, numberingRule: existing.numberingRule };

  const codeExists = await tx.assetCategory.findUnique({ where: { code } });
  const finalCode = codeExists ? `${code}_${Date.now()}` : code;

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
  const existing = await tx.componentModel.findUnique({
    where: { categoryId_name_brand: { categoryId, name, brand: brand || "" } },
  });
  if (existing) return existing.id;

  const created = await tx.componentModel.create({
    data: {
      name,
      brand: brand || undefined,
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

  let finalName = templateName;
  let counter = 2;
  while (
    await tx.deviceTemplate.findFirst({
      where: { categoryId, name: finalName },
    })
  ) {
    finalName = `${templateName} (${counter})`;
    counter++;
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
  await requireAuth();

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
          },
        });

        // 7.5 复制模板 BOM 配件到设备（记录配置，不扣减库存）
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
      errors.push(`第${rowNum}行 (${row.deviceName}): ${message}`);
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
  "CPU型号": string;
  "CPU品牌": string;
  "内存型号": string;
  "内存品牌": string;
  "硬盘型号": string;
  "硬盘品牌": string;
  "主板型号": string;
  "主板品牌": string;
  "显卡型号": string;
  "显卡品牌": string;
  // 多列格式支持
  [key: string]: string;
}

// 解析多列格式的配件（如 内存1型号/内存1品牌, 内存2型号/内存2品牌）
function parseMultiColumnComponents(
  row: Record<string, string>,
  category: string
): HardwareComponent[] {
  const components: HardwareComponent[] = [];

  // 先检查单列格式
  const singleModel = String(row[`${category}型号`] ?? "").trim();
  const singleBrand = String(row[`${category}品牌`] ?? "").trim();
  if (singleModel) {
    components.push({ category, name: singleModel, brand: singleBrand });
  }

  // 再检查多列格式（1, 2, 3...）
  for (let i = 1; i <= 10; i++) {
    const model = String(row[`${category}${i}型号`] ?? "").trim();
    const brand = String(row[`${category}${i}品牌`] ?? "").trim();
    if (model) {
      components.push({ category, name: model, brand });
    }
  }

  return components;
}

export async function importAssetsFromExcelAuto(
  input: { buffer: number[] }
): Promise<ActionResult<ImportResult>> {
  await requireAuth();

  try {
    const fileBuffer = Buffer.from(input.buffer);
    const wb = XLSX.read(fileBuffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<ExcelAssetRow>(ws);

    if (rows.length === 0) {
      return { success: false, error: "Excel文件为空" };
    }

    const hardwareAssets: HardwareAssetInput[] = [];

    for (const row of rows) {
      const employeeName = String(row["使用人"] ?? "").trim();
      const departmentName = String(row["部门"] ?? "").trim();
      const deviceName = String(row["设备名称"] ?? "").trim();
      const categoryName = String(row["设备分类"] ?? "电脑主机").trim();
      const categoryCode = String(row["设备分类编号"] ?? "PC").trim();

      if (!employeeName || !departmentName) {
        continue;
      }

      const components: HardwareComponent[] = [];

      const rowRecord = row as Record<string, string>;

      const cpuModel = String(rowRecord["CPU型号"] ?? "").trim();
      const cpuBrand = String(rowRecord["CPU品牌"] ?? "").trim();
      if (cpuModel) {
        components.push({ category: "CPU", name: cpuModel, brand: cpuBrand });
      }

      components.push(...parseMultiColumnComponents(rowRecord, "内存"));
      components.push(...parseMultiColumnComponents(rowRecord, "硬盘"));
      components.push(...parseMultiColumnComponents(rowRecord, "显示器"));

      const mbModel = String(rowRecord["主板型号"] ?? "").trim();
      const mbBrand = String(rowRecord["主板品牌"] ?? "").trim();
      if (mbModel) {
        components.push({ category: "主板", name: mbModel, brand: mbBrand });
      }

      const gpuModel = String(rowRecord["显卡型号"] ?? "").trim();
      const gpuBrand = String(rowRecord["显卡品牌"] ?? "").trim();
      if (gpuModel) {
        components.push({ category: "显卡", name: gpuModel, brand: gpuBrand });
      }

      hardwareAssets.push({
        employeeName,
        departmentName,
        deviceName: deviceName || `${employeeName}的电脑主机`,
        categoryName,
        categoryCode,
        components,
      });
    }

    if (hardwareAssets.length === 0) {
      const emptyRows = rows.filter(
        (r) => !String(r["使用人"] ?? "").trim() || !String(r["部门"] ?? "").trim()
      ).length;
      if (emptyRows === rows.length) {
        return { success: false, error: "所有行的使用人或部门字段为空，请检查Excel文件" };
      } else {
        return { success: false, error: `共 ${rows.length} 行，其中 ${emptyRows} 行使用人或部门为空，无法导入` };
      }
    }

    return importAssetsAuto({ assets: hardwareAssets });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Excel文件解析失败";
    return { success: false, error: message };
  }
}
