"use server";

import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function exportAssetsToExcel(): Promise<
  ActionResult<{ buffer: Buffer; fileName: string }>
> {
  const assets = await prisma.asset.findMany({
    orderBy: { assetNo: "asc" },
    include: {
      template: {
        select: {
          name: true,
          category: { select: { name: true } },
        },
      },
      employee: {
        select: {
          name: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  const rows = assets.map((a) => ({
    "设备编号": a.assetNo,
    "设备名称": a.name,
    "分类": a.template?.category?.name ?? "",
    "模板": a.template?.name ?? "",
    "状态": mapStatus(a.status),
    "使用人": a.employee?.name ?? "",
    "部门": a.employee?.department?.name ?? "",
    "位置": a.location ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "设备档案");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Buffer.from(buf),
      fileName: `设备档案_${formatDate()}.xlsx`,
    },
  };
}

export async function exportComponentsToExcel(): Promise<
  ActionResult<{ buffer: Buffer; fileName: string }>
> {
  const models = await prisma.componentModel.findMany({
    orderBy: { id: "asc" },
    include: {
      category: { select: { name: true } },
      stock: { select: { quantity: true } },
    },
  });

  const rows = models.map((m) => ({
    "型号名称": m.name,
    "品牌": m.brand ?? "",
    "分类": m.category?.name ?? "",
    "库存数量": m.stock?.quantity ?? 0,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "配件型号");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Buffer.from(buf),
      fileName: `配件型号_${formatDate()}.xlsx`,
    },
  };
}

export async function exportEmployeesToExcel(): Promise<
  ActionResult<{ buffer: Buffer; fileName: string }>
> {
  const emps = await prisma.employee.findMany({
    orderBy: { employeeNo: "asc" },
    include: {
      department: { select: { name: true } },
    },
  });

  const rows = emps.map((e) => ({
    "工号": e.employeeNo,
    "姓名": e.name,
    "部门": e.department?.name ?? "",
    "电话": e.phone ?? "",
    "邮箱": e.email ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "员工列表");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Buffer.from(buf),
      fileName: `员工列表_${formatDate()}.xlsx`,
    },
  };
}

function mapStatus(status: string): string {
  const map: Record<string, string> = {
    IDLE: "闲置",
    IN_USE: "在用",
    IN_MAINTENANCE: "维修中",
    SCRAPPED: "报废",
  };
  return map[status] ?? status;
}

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// ============================================================
// Excel 导入
// ============================================================

export async function importEmployeesFromExcel(
  input: { buffer: Buffer }
): Promise<ActionResult<{ importedCount: number; errors: string[] }>> {
  try {
    const wb = XLSX.read(input.buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

    // 缓存部门名 → ID 映射
    const allDepts = await prisma.department.findMany({ select: { id: true, name: true } });
    const deptMap = new Map(allDepts.map((d) => [d.name, d.id]));

    let importedCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const employeeNo = row["工号"]?.trim();
      const name = row["姓名"]?.trim();
      const deptName = row["部门"]?.trim();
      const phone = row["电话"]?.trim() || null;
      const email = row["邮箱"]?.trim() || null;

      if (!employeeNo || !name || !deptName) {
        errors.push(`缺少必填字段：${JSON.stringify(row)}`);
        continue;
      }

      const departmentId = deptMap.get(deptName);
      if (!departmentId) {
        errors.push(`部门不存在：${deptName}`);
        continue;
      }

      // 检查工号是否已存在
      const existing = await prisma.employee.findUnique({ where: { employeeNo } });
      if (existing) {
        errors.push(`工号已存在：${employeeNo}`);
        continue;
      }

      try {
        await prisma.employee.create({
          data: { employeeNo, name, departmentId, phone, email },
        });
        importedCount++;
      } catch (e) {
        errors.push(`创建失败 ${employeeNo}`);
      }
    }

    return { success: true, data: { importedCount, errors } };
  } catch (e) {
    return { success: false, error: "Excel 文件解析失败" };
  }
}

// ============================================================
// 设备导入
// ============================================================

export async function importAssetsFromExcel(
  input: { buffer: Buffer }
): Promise<ActionResult<{ importedCount: number; errors: string[] }>> {
  try {
    const wb = XLSX.read(input.buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

    // 预缓存模板名 -> ID 映射
    const allTemplates = await prisma.deviceTemplate.findMany({
      select: { id: true, name: true, categoryId: true },
      include: { category: { select: { id: true, code: true } } },
    });
    const templateMap = new Map(allTemplates.map((t) => [t.name, t]));

    // 预缓存员工名 -> ID 映射
    const allEmployees = await prisma.employee.findMany({
      select: { id: true, name: true },
    });
    const employeeMap = new Map(allEmployees.map((e) => [e.name, e.id]));

    let importedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const name = String(row["设备名称"] ?? row["name"] ?? "").trim();
        if (!name) {
          errors.push(`第${i + 2}行: 设备名称为空`);
          continue;
        }

        const templateName = String(row["设备模板"] ?? row["模板"] ?? "").trim();
        const employeeName = String(row["使用人"] ?? "").trim();

        // 模板是必填的
        if (!templateName) {
          errors.push(`第${i + 2}行: 设备模板为空`);
          continue;
        }

        const template = templateMap.get(templateName);
        if (!template) {
          errors.push(`第${i + 2}行: 模板"${templateName}"不存在`);
          continue;
        }

        const employeeId = employeeName ? (employeeMap.get(employeeName) ?? undefined) : undefined;

        // 生成编号：使用模板所属分类的 code 作为前缀
        const categoryCode = template.category?.code ?? "EQ";
        const prefix = categoryCode.substring(0, 2).toUpperCase();
        const lastAsset = await prisma.asset.findFirst({
          where: { assetNo: { startsWith: prefix + "-" } },
          orderBy: { id: "desc" },
        });
        let nextNum = 1;
        if (lastAsset) {
          const match = lastAsset.assetNo.match(new RegExp(`^${prefix}-(\\d+)$`));
          if (match) {
            nextNum = parseInt(match[1], 10) + 1;
          }
        }
        const assetNo = `${prefix}-${String(nextNum).padStart(4, "0")}`;

        const status = employeeId ? "IN_USE" : "IDLE";

        const createdAsset = await prisma.asset.create({
          data: {
            assetNo,
            name,
            templateId: template.id,
            status,
            employeeId: employeeId ?? null,
          },
        });

        // 如果有使用人，记录生命周期日志
        if (employeeId) {
          await prisma.lifecycleLog.create({
            data: {
              assetId: createdAsset.id,
              action: "ALLOCATED",
              fromStatus: "IDLE",
              toStatus: "IN_USE",
              employeeId,
              operator: "admin",
              remark: "Excel 导入分配",
            },
          });
        } else {
          // 记录创建日志
          await prisma.lifecycleLog.create({
            data: {
              assetId: createdAsset.id,
              action: "CREATED",
              toStatus: "IDLE",
              operator: "admin",
              remark: "Excel 导入创建",
            },
          });
        }

        importedCount++;
      } catch (e: any) {
        errors.push(`第${i + 2}行: ${e.message}`);
      }
    }

    return { success: true, data: { importedCount, errors } };
  } catch (e) {
    return { success: false, error: "Excel 文件解析失败" };
  }
}

export async function importComponentModelsFromExcel(
  input: { buffer: Buffer }
): Promise<ActionResult<{ importedCount: number; errors: string[] }>> {
  try {
    const wb = XLSX.read(input.buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

    const allCats = await prisma.componentCategory.findMany({ select: { id: true, name: true } });
    const catMap = new Map(allCats.map((c) => [c.name, c.id]));

    let importedCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const name = row["型号名称"]?.trim();
      const brand = row["品牌"]?.trim() || null;
      const catName = row["分类"]?.trim();

      if (!name || !catName) {
        errors.push(`缺少必填字段：${JSON.stringify(row)}`);
        continue;
      }

      const categoryId = catMap.get(catName);
      if (!categoryId) {
        errors.push(`分类不存在：${catName}`);
        continue;
      }

      try {
        await prisma.componentModel.create({
          data: {
            name,
            brand,
            categoryId,
            stock: { create: { quantity: 0 } },
          },
        });
        importedCount++;
      } catch (e) {
        errors.push(`创建失败 ${name}`);
      }
    }

    return { success: true, data: { importedCount, errors } };
  } catch (e) {
    return { success: false, error: "Excel 文件解析失败" };
  }
}
