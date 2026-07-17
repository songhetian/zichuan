"use server";

import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
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
): Promise<number> {
  const existing = await tx.assetCategory.findUnique({ where: { name } });
  if (existing) return existing.id;

  const codeExists = await tx.assetCategory.findUnique({ where: { code } });
  const finalCode = codeExists ? `${code}_${Date.now()}` : code;

  const created = await tx.assetCategory.create({
    data: { name, code: finalCode },
  });
  return created.id;
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
    where: { categoryId_name: { categoryId, name } },
  });
  if (existing) return existing.id;

  const created = await tx.componentModel.create({
    data: {
      name,
      brand: brand || null,
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
  const compMap = new Map(components.map((c) => [c.category, c]));

  const parts: string[] = [];

  const cpu = compMap.get("CPU");
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

  const memory = compMap.get("内存");
  if (memory) {
    const match = memory.name.match(/(\d+GB)/i);
    if (match) parts.push(match[1]);
  }

  const disk = compMap.get("硬盘");
  if (disk) {
    const match = disk.name.match(/(\d+GB|\d+TB)/i);
    if (match) parts.push(match[1]);
    if (disk.name.toLowerCase().includes("ssd")) parts.push("SSD");
    else if (disk.name.toLowerCase().includes("hdd")) parts.push("HDD");
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

async function generateAssetNo(
  tx: Tx,
  categoryId: number
): Promise<string> {
  const category = await tx.assetCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) throw new Error("分类不存在");

  const prefix = category.code;

  const lastAsset = await tx.asset.findFirst({
    where: { assetNo: { startsWith: prefix + "-" } },
    orderBy: { assetNo: "desc" },
  });

  let nextNum = 1;
  if (lastAsset) {
    const match = lastAsset.assetNo.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}-${String(nextNum).padStart(4, "0")}`;
}

// ============================================================
// 核心导入逻辑
// ============================================================

export async function importAssetsAuto(
  input: { assets: HardwareAssetInput[] }
): Promise<ActionResult<ImportResult>> {
  requireAuth();

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
        const categoryId = await getOrCreateAssetCategory(
          tx,
          row.categoryName,
          row.categoryCode
        );

        // 2. 配件分类 + 配件型号 + 库存（查找或创建）
        const componentMappings: Array<{ modelId: number; quantity: number }> = [];
        const componentsCreated: string[] = [];

        for (const comp of row.components) {
          const compCategoryId = await getOrCreateComponentCategory(tx, comp.category);
          const modelId = await getOrCreateComponentModel(
            tx,
            compCategoryId,
            comp.name,
            comp.brand
          );
          componentMappings.push({ modelId, quantity: 1 });
          componentsCreated.push(comp.name);
        }

        // 3. 设备模板 + BOM（按配件组合查找或创建）
        const templateResult = await findOrCreateDeviceTemplate(
          tx,
          categoryId,
          row.categoryName,
          row.components,
          componentMappings
        );

        // 4. 部门（查找或创建）
        const departmentId = await getOrCreateDepartment(tx, row.departmentName);

        // 5. 员工（查找或创建）
        const employeeId = await getOrCreateEmployee(tx, row.employeeName, departmentId);

        // 6. 生成编号
        const assetNo = await generateAssetNo(tx, categoryId);

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

        // 8. 创建设备配件配置（复制BOM）
        if (componentMappings.length > 0) {
          await tx.assetComponent.createMany({
            data: componentMappings.map((c) => ({
              assetId: asset.id,
              modelId: c.modelId,
              quantity: c.quantity,
            })),
          });
        }

        // 9. 记录生命周期日志
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
}

export async function importAssetsFromExcelAuto(
  input: { buffer: number[] }
): Promise<ActionResult<ImportResult>> {
  requireAuth();

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

      const cpuModel = String(row["CPU型号"] ?? "").trim();
      const cpuBrand = String(row["CPU品牌"] ?? "").trim();
      if (cpuModel) {
        components.push({ category: "CPU", name: cpuModel, brand: cpuBrand });
      }

      const memoryModel = String(row["内存型号"] ?? "").trim();
      const memoryBrand = String(row["内存品牌"] ?? "").trim();
      if (memoryModel) {
        components.push({ category: "内存", name: memoryModel, brand: memoryBrand });
      }

      const diskModel = String(row["硬盘型号"] ?? "").trim();
      const diskBrand = String(row["硬盘品牌"] ?? "").trim();
      if (diskModel) {
        components.push({ category: "硬盘", name: diskModel, brand: diskBrand });
      }

      const mbModel = String(row["主板型号"] ?? "").trim();
      const mbBrand = String(row["主板品牌"] ?? "").trim();
      if (mbModel) {
        components.push({ category: "主板", name: mbModel, brand: mbBrand });
      }

      const gpuModel = String(row["显卡型号"] ?? "").trim();
      const gpuBrand = String(row["显卡品牌"] ?? "").trim();
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
