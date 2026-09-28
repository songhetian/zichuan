"use server";

import { prisma } from "@/lib/prisma";
import { cleanErrorMessage } from "@/lib/sanitize-error";
import { generateAssetNo } from "@/lib/asset-numbering";
import { consumeBomStock, INSUFFICIENT_STOCK_PREFIX } from "@/lib/bom-stock";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { guardPermission, resolveAssetScope, resolveEmployeeScope } from "@/lib/permissions";
import { getMyHandledRecords, getMyCcRecords, type HandledRecordQuery, type CcRecordQuery } from "@/actions/approval.actions";
import { getStatusLabel } from "@/lib/status-labels";

export async function exportAssetsToExcel(
  selectedFields?: string[],
  assetIds?: number[]
): Promise<ActionResult<{ buffer: number[]; fileName: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.device.export", "没有导出设备的权限");
  if (denied) return denied;

  // 数据范围过滤（统一口径）：显式选中的 id 也叠加范围，防止越权导出
  const scope = await resolveAssetScope(user.id);
  const assets = await prisma.asset.findMany({
    where: {
      ...(assetIds && assetIds.length > 0 ? { id: { in: assetIds } } : {}),
      ...(scope ?? {}),
    },
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

  const allFields: Record<string, (a: any) => string> = {
    assetNo: (a) => a.assetNo,
    name: (a) => a.name,
    categoryName: (a) => a.template?.category?.name ?? "",
    templateName: (a) => a.template?.name ?? "",
    brand: (a) => a.brand ?? "",
    model: (a) => a.model ?? "",
    serialNo: (a) => a.serialNo ?? "",
    status: (a) => getStatusLabel(a.status),
    employeeName: (a) => a.employee?.name ?? "",
    departmentName: (a) => a.employee?.department?.name ?? "",
    location: (a) => a.location ?? "",
  };

  const fieldLabels: Record<string, string> = {
    assetNo: "设备编号",
    name: "设备名称",
    categoryName: "分类",
    templateName: "模板",
    brand: "品牌",
    model: "型号",
    serialNo: "序列号",
    status: "状态",
    employeeName: "使用人",
    departmentName: "部门",
    location: "位置",
  };

  const fieldsToExport = selectedFields && selectedFields.length > 0
    ? selectedFields
    : Object.keys(allFields);

  const rows = assets.map((a) => {
    const row: Record<string, string> = {};
    for (const field of fieldsToExport) {
      const getter = allFields[field];
      if (getter) {
        row[fieldLabels[field] ?? field] = getter(a);
      }
    }
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "设备档案");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Array.from(buf),
      fileName: `设备档案_${formatDate()}.xlsx`,
    },
  };
}

export async function exportComponentsToExcel(): Promise<
  ActionResult<{ buffer: number[]; fileName: string }>
> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.component.view", "没有查看/导出配件的权限");
  if (denied) return denied;

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
      buffer: Array.from(buf),
      fileName: `配件型号_${formatDate()}.xlsx`,
    },
  };
}

const EMPLOYEE_FIELDS: Record<string, { label: string; get: (e: any) => string | number }> = {
  employeeNo: { label: "工号", get: (e) => e.employeeNo },
  name: { label: "姓名", get: (e) => e.name },
  departmentName: { label: "部门", get: (e) => e.department?.name ?? "" },
  phone: { label: "电话", get: (e) => e.phone ?? "" },
  email: { label: "邮箱", get: (e) => e.email ?? "" },
};

export async function exportEmployeesToExcel(
  selectedFields?: string[]
): Promise<ActionResult<{ buffer: number[]; fileName: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "employee.view", "没有查看/导出员工的权限");
  if (denied) return denied;

  // 数据范围过滤（统一口径）：仅导出可见部门员工
  const scope = await resolveEmployeeScope(user.id);
  const emps = await prisma.employee.findMany({
    where: scope,
    orderBy: { employeeNo: "asc" },
    include: {
      department: { select: { name: true } },
    },
  });

  const fieldsToExport =
    selectedFields && selectedFields.length > 0 ? selectedFields : Object.keys(EMPLOYEE_FIELDS);

  const rows = emps.map((e) => {
    const row: Record<string, string | number> = {};
    for (const field of fieldsToExport) {
      const def = EMPLOYEE_FIELDS[field];
      if (def) row[def.label] = def.get(e);
    }
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "员工列表");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Array.from(buf),
      fileName: `员工列表_${formatDate()}.xlsx`,
    },
  };
}

// 「我办理的记录」导出（/approvals/done）
// "use server" 文件只能导出 async 函数，中文文案映射在文件内本地定义
const HANDLED_BIZ_LABEL: Record<string, string> = {
  ASSET_UPGRADE: "升级",
  ASSET_SCRAP: "报废",
  ASSET_RETURN: "退回",
  ASSET_REPLACE: "更换",
  ASSET_REPAIR: "维修",
  ASSET_DEPART: "离职",
  ASSET_PURCHASE: "加购",
};

const HANDLED_STATUS_LABEL: Record<string, string> = {
  PENDING: "审批中",
  APPROVED: "已通过",
  REJECTED: "已驳回",
  CANCELLED: "已撤销",
};

const HANDLED_ACTION_LABEL: Record<string, string> = {
  APPROVE: "审批通过",
  REJECT: "驳回",
  EXECUTE: "执行",
};

export async function exportHandledRecordsToExcel(
  query?: HandledRecordQuery
): Promise<ActionResult<{ buffer: number[]; fileName: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "approval.done.export", "没有导出办理记录的权限");
  if (denied) return denied;

  const res = await getMyHandledRecords(query);
  if (!res.success) return { success: false, error: res.error };

  const rows = res.data.map((r) => ({
    "单号": r.requestNo,
    "申请标题": r.title,
    "业务类型": HANDLED_BIZ_LABEL[r.businessType] ?? r.businessType,
    "状态": HANDLED_STATUS_LABEL[r.status] ?? r.status,
    "发起人": r.initiatorName,
    "部门": r.departmentName ?? "",
    "配件类型": r.componentCategoryName ?? "",
    "我的动作": r.actions.map((a) => HANDLED_ACTION_LABEL[a] ?? a).join("、"),
    "办理时间": formatDateTime(r.lastActedAt),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "办理记录");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Array.from(buf),
      fileName: `办理记录_${formatDate()}.xlsx`,
    },
  };
}

// 「我的抄送」导出（/approvals/cc）
export async function exportCcRecordsToExcel(
  query?: CcRecordQuery
): Promise<ActionResult<{ buffer: number[]; fileName: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "approval.cc.export", "没有导出抄送记录的权限");
  if (denied) return denied;

  const res = await getMyCcRecords(query);
  if (!res.success) return { success: false, error: res.error };

  const rows = res.data.map((r) => ({
    "单号": r.requestNo,
    "申请标题": r.title,
    "业务类型": HANDLED_BIZ_LABEL[r.businessType] ?? r.businessType,
    "状态": HANDLED_STATUS_LABEL[r.status] ?? r.status,
    "发起人": r.initiatorName,
    "部门": r.departmentName ?? "",
    "配件类型": r.componentCategoryName ?? "",
    "抄送时间": formatDateTime(r.ccAt),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "抄送记录");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Array.from(buf),
      fileName: `抄送记录_${formatDate()}.xlsx`,
    },
  };
}

function formatDateTime(d: Date | string | null): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 去掉库存不足的机器编码前缀（导入错误行直接展示给用户，只留中文文案） */
function stripStockPrefix(message: unknown): unknown {
  if (typeof message !== "string") return message;
  return message.startsWith(INSUFFICIENT_STOCK_PREFIX)
    ? message.slice(INSUFFICIENT_STOCK_PREFIX.length)
    : message;
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
  const user = await requireAuth();
  // 导入员工会批量创建登录账号（登录名=工号、默认密码），仅限拥有账号管理模块「导入员工」权限的账号
  const denied = await guardPermission(user, "employee.import", "导入员工需要账号管理权限");
  if (denied) return denied;

  try {
    const wb = XLSX.read(input.buffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

    // 缓存部门名 → ID 映射
    const allDepts = await prisma.department.findMany({ select: { id: true, name: true } });
    const deptMap = new Map(allDepts.map((d) => [d.name, d.id]));

    // 导入员工默认角色：普通员工（EMPLOYEE）
    const empRole = await prisma.role.findUnique({ where: { key: "EMPLOYEE" } });
    const defaultEmpRoleId = empRole?.id ?? null;

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
        await prisma.$transaction(async (tx) => {
          const emp = await tx.employee.create({
            data: { employeeNo, name, departmentId, phone, email },
          });
          // 导入即自动创建登录账号：登录名=工号、默认密码 123456、首登强制改密
          const hashed = await bcrypt.hash("123456", 10);
          await tx.admin.create({
            data: {
              username: employeeNo,
              password: hashed,
              roleId: defaultEmpRoleId,
              displayName: name,
              employeeId: emp.id,
              mustChangePassword: true,
            },
          });
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
  input: { buffer: number[] }
): Promise<ActionResult<{ importedCount: number; errors: string[] }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.import.execute", "没有设备导入权限");
  if (denied) return denied;

  try {
    const fileBuffer = Buffer.from(input.buffer);
    const wb = XLSX.read(fileBuffer);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

    // 预缓存模板名 -> ID 映射（包含分类的 numberingRule 和 BOM 配件）
    const allTemplates = await prisma.deviceTemplate.findMany({
      include: {
        category: { select: { id: true, code: true, numberingRule: true } },
        components: { include: { model: { select: { name: true } } } },
      },
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

        // 使用人填了但查不到：不允许静默降级为闲置（会造成「想分配却入库」的数据错位），整行报错跳过
        let employeeId: number | undefined;
        if (employeeName) {
          const found = employeeMap.get(employeeName);
          if (!found) {
            errors.push(`第${i + 2}行: 使用人"${employeeName}"不存在`);
            continue;
          }
          employeeId = found;
        }

        // 使用事务保证编号生成与资产创建的原子性，并尊重模板分类的 numberingRule
        await prisma.$transaction(async (tx) => {
          // 按模板 BOM 出库配件（与「新建设备」同一语义：库存不足则本行跳过）
          await consumeBomStock(tx, template, 1, user.username);

          const prefix = template.category?.code ?? "EQ";
          const assetNo = await generateAssetNo(
            tx,
            prefix,
            template.category?.numberingRule
          );
          // 与「新建设备」同一口径：没填使用人即入闲置池
          const status = employeeId ? "IN_USE" : "IDLE";

          const createdAsset = await tx.asset.create({
            data: {
              assetNo,
              name,
              templateId: template.id,
              status,
              employeeId: employeeId ?? null,
            },
          });

          // 复制模板 BOM 配件到设备（配件已在上面按 BOM 出库扣减）
          if (template.components && template.components.length > 0) {
            await tx.assetComponent.createMany({
              data: template.components.map((bom) => ({
                assetId: createdAsset.id,
                modelId: bom.modelId,
                quantity: bom.quantity,
              })),
            });
          }

          // 如果有使用人，记录生命周期日志
          if (employeeId) {
            await tx.lifecycleLog.create({
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
            await tx.lifecycleLog.create({
              data: {
                assetId: createdAsset.id,
                action: "CREATED",
                toStatus: "IDLE",
                operator: "admin",
                remark: "Excel 导入创建",
              },
            });
          }
        });

        importedCount++;
      } catch (e: any) {
        errors.push(`第${i + 2}行: ${cleanErrorMessage(stripStockPrefix(e?.message))}`);
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
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.component.create", "导入配件型号需要新增配件权限");
  if (denied) return denied;

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
      const brand = row["品牌"]?.trim() || undefined;
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
