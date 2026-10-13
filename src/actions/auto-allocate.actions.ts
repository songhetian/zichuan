"use server";

import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { generateEmployeeNo } from "@/lib/employee-no";
import {
  planAllocation,
  type AllocationAsset,
  type AllocationEmployee,
} from "@/lib/allocation";
import { getStatusLabel } from "@/lib/status-labels";
import { allocateAssetsToEmployees, type AllocateSkipped } from "./lifecycle.actions";
import * as XLSX from "xlsx";

// ============================================================
// Excel 列定义（导出模板与导入解析共用，避免两边写不一致）
// ============================================================

const COL_NAME = "姓名";
const COL_DEPT = "部门";
/** 「设备编号」前缀：同时匹配「设备编号」「设备编号01」「设备编号02」等横向多列 */
const ASSET_NO_PREFIX = "设备编号";
const COL_ERROR_REASON = "错误原因";
const SHEET_NAME = "待分配清单";
const ERROR_SHEET_NAME = "错误明细";

/** 横向清单里的设备编号列名：第 1 列叫「设备编号01」，第 2 列叫「设备编号02」… */
function assetNoColumnLabel(index: number): string {
  return `${ASSET_NO_PREFIX}${String(index + 1).padStart(2, "0")}`;
}

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// ============================================================
// 导出空白导入模板
// ============================================================

/** 模板里预留的「设备编号」列数（一名员工最多填这么多台设备） */
const TEMPLATE_ASSET_COLUMNS = 5;
/** 模板里预留的空行数，主管直接在空行里填写即可 */
const TEMPLATE_BLANK_ROWS = 10;

/**
 * 导出空白导入模板：表头「姓名 | 部门 | 设备编号01 | 设备编号02 …」+ 若干空行。
 *
 * 无需先挑选设备，主管直接在一行里填「姓名」「部门」并横向填该员工持有的设备编号，
 * 导回后按编号自动分配；姓名/部门不存在会自动创建，编号写错的行会被标出并跳过。
 */
export async function exportAllocationTemplate(): Promise<
  ActionResult<{ buffer: number[]; fileName: string }>
> {
  await requireAuth();

  const assetNoColumns = Array.from({ length: TEMPLATE_ASSET_COLUMNS }, (_, i) =>
    assetNoColumnLabel(i)
  );
  const header = [COL_NAME, COL_DEPT, ...assetNoColumns];
  const blankRow = header.map(() => "");
  const grid = [header, ...Array.from({ length: TEMPLATE_BLANK_ROWS }, () => [...blankRow])];

  const ws = XLSX.utils.aoa_to_sheet(grid);
  // 给编号列留足列宽，避免单元格里显示不下时视觉换行
  ws["!cols"] = [{ wch: 10 }, { wch: 14 }, ...assetNoColumns.map(() => ({ wch: 18 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Array.from(buf),
      fileName: `分配导入模板_${formatDate()}.xlsx`,
    },
  };
}

// ============================================================
// 导出错误明细（编号写错等不可分配的行，修正后可再导入）
// ============================================================

export interface AllocationErrorRow {
  employeeName: string;
  departmentName: string;
  assetNo: string;
  reason: string;
}

/**
 * 把不可分配的行（含错误原因）导出成 Excel，供主管下载修正。
 *
 * 表头与清单保持一致（姓名 | 部门 | 设备编号01）并追加「错误原因」列，
 * 因此导出的文件本身仍能被 `previewAllocationImport` 解析 —— 改正编号后可直接重新导入。
 */
export async function exportAllocationErrors(input: {
  rows: AllocationErrorRow[];
}): Promise<ActionResult<{ buffer: number[]; fileName: string; count: number }>> {
  await requireAuth();

  const rows = (input.rows ?? []).filter(
    (r) => r && (r.employeeName?.trim() || r.assetNo?.trim() || r.reason?.trim())
  );
  if (rows.length === 0) {
    return { success: false, error: "没有错误行可导出" };
  }

  const header = [COL_NAME, COL_DEPT, assetNoColumnLabel(0), COL_ERROR_REASON];
  const grid = [
    header,
    ...rows.map((r) => [
      r.employeeName ?? "",
      r.departmentName ?? "",
      r.assetNo ?? "",
      r.reason ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), ERROR_SHEET_NAME);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return {
    success: true,
    data: {
      buffer: Array.from(buf),
      fileName: `待分配错误明细_${formatDate()}.xlsx`,
      count: rows.length,
    },
  };
}

// ============================================================
// 解析清单（跳过表头，兼容一行多台设备编号）
// ============================================================

/**
 * 把跨 server action 边界传过来的文件数据统一成 Buffer。
 *
 * 浏览器端按项目约定传 number[]（`Array.from(new Uint8Array(...))`），
 * 但也兼容被序列化成 Uint8Array / Node Buffer / `{type:"Buffer",data:[...]}` 的情况。
 */
function toFileBuffer(input: unknown): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (Array.isArray(input)) return Buffer.from(input as number[]);
  if (input && typeof input === "object") {
    const o = input as { type?: string; data?: number[] };
    if (o.type === "Buffer" && Array.isArray(o.data)) return Buffer.from(o.data);
  }
  throw new Error("未收到文件数据，请重新选择文件");
}

interface ParsedRow {
  /** Excel 行号（1 起，含表头） */
  rowIndex: number;
  employeeName: string;
  departmentName: string;
  assetNo: string;
}

/**
 * 读取清单：定位表头行（含「姓名」的第一行）→ 跳过它 → 逐行取 姓名 / 部门 / 各「设备编号*」列。
 * 一行若带多个设备编号，会展开成多条记录（同一姓名、同一部门）。
 */
function parseSheet(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const grid = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(ws, {
    header: 1,
    blankrows: false,
    raw: false,
  });

  // 找表头行：第一处含「姓名」的行
  let headerIdx = -1;
  let nameIdx = -1;
  let deptIdx = -1;
  let assetIdxs: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    if (cells.includes(COL_NAME)) {
      headerIdx = i;
      nameIdx = cells.indexOf(COL_NAME);
      deptIdx = cells.indexOf(COL_DEPT);
      assetIdxs = cells
        .map((h, idx) => (h.startsWith(ASSET_NO_PREFIX) ? idx : -1))
        .filter((idx) => idx >= 0);
      break;
    }
  }
  if (headerIdx < 0) return [];

  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    const cell = (idx: number) => (idx >= 0 ? String(raw[idx] ?? "").trim() : "");
    const employeeName = cell(nameIdx);
    const departmentName = cell(deptIdx);
    const assetNos = assetIdxs.map(cell).filter(Boolean);

    if (!employeeName && !departmentName && assetNos.length === 0) continue;

    if (assetNos.length === 0) {
      rows.push({ rowIndex: i + 1, employeeName, departmentName, assetNo: "" });
      continue;
    }
    for (const assetNo of assetNos) {
      rows.push({ rowIndex: i + 1, employeeName, departmentName, assetNo });
    }
  }
  return rows;
}

// ============================================================
// 预览导入结果
// ============================================================

export interface AllocationImportRow {
  /** Excel 行号（含表头，从 2 开始） */
  rowIndex: number;
  employeeName: string;
  /** 清单里填写的部门 */
  departmentName: string;
  /** 已存在员工才有 */
  employeeId: number | null;
  /** 归属部门：已存在员工取现有部门，待创建取填写的部门 */
  employeeDept: string | null;
  /** 该姓名在系统中不存在，确认时会自动创建员工 */
  willCreateEmployee: boolean;
  /** 该部门在系统中不存在，确认时会自动创建部门 */
  willCreateDepartment: boolean;
  assetNo: string;
  assetId: number | null;
  assetCategory: string | null;
  assetStatus: string | null;
  ok: boolean;
  reason: string | null;
}

interface AssetWithCategory {
  id: number;
  assetNo: string;
  status: string;
  employeeId: number | null;
  template: {
    categoryId: number;
    category: { name: string; unique: boolean } | null;
  } | null;
}

/**
 * 解析主管回填的清单，逐行匹配姓名 / 部门 / 设备并给出可分配与否。
 * 姓名不存在 → 标记「将自动创建员工」；部门不存在 → 标记「将自动创建部门」。
 * 唯一性冲突用落库同一个 `planAllocation` 复核，保证「预览能分」= 「落库能分」。
 */
export async function previewAllocationImport(input: {
  buffer: number[] | Uint8Array | Buffer;
}): Promise<ActionResult<{ rows: AllocationImportRow[]; assignableCount: number }>> {
  await requireAuth();

  try {
    const parsed = parseSheet(toFileBuffer(input?.buffer));
    if (parsed.length === 0) {
      return { success: false, error: "Excel 文件没有可识别的数据行（需包含「姓名」表头行）" };
    }

    // 员工：按姓名建索引；重名会被视为歧义，需人工处理
    const employees = await prisma.employee.findMany({
      include: { department: { select: { name: true } } },
    });
    const byName = new Map<string, typeof employees>();
    for (const e of employees) {
      const list = byName.get(e.name) ?? [];
      list.push(e);
      byName.set(e.name, list);
    }

    const deptNames = new Set(
      (await prisma.department.findMany({ select: { name: true } })).map((d) => d.name)
    );

    // 设备：按编号
    const assetNos = [...new Set(parsed.map((r) => r.assetNo).filter(Boolean))];
    const assets = await prisma.asset.findMany({
      where: { assetNo: { in: assetNos } },
      include: {
        template: {
          select: {
            categoryId: true,
            category: { select: { name: true, unique: true } },
          },
        },
      },
    });
    const assetByNo = new Map<string, AssetWithCategory>(
      assets.map((a) => [a.assetNo, a as AssetWithCategory])
    );

    const rows: AllocationImportRow[] = [];
    const seenAssetNos = new Set<string>();

    for (const p of parsed) {
      const row: AllocationImportRow = {
        rowIndex: p.rowIndex,
        employeeName: p.employeeName,
        departmentName: p.departmentName,
        employeeId: null,
        employeeDept: null,
        willCreateEmployee: false,
        willCreateDepartment: false,
        assetNo: p.assetNo,
        assetId: null,
        assetCategory: null,
        assetStatus: null,
        ok: false,
        reason: null,
      };

      if (!p.employeeName) {
        row.reason = "未填写姓名";
        rows.push(row);
        continue;
      }

      const matches = byName.get(p.employeeName);
      if (matches && matches.length > 1) {
        row.reason = `存在 ${matches.length} 名同名员工，请人工确认`;
        rows.push(row);
        continue;
      }
      if (matches && matches.length === 1) {
        const emp = matches[0];
        row.employeeId = emp.id;
        row.employeeDept = emp.department?.name ?? null;
      } else {
        // 姓名不存在：确认时会自动建档，需要先知道部门
        row.willCreateEmployee = true;
        if (!p.departmentName) {
          row.reason = "未填写部门，无法自动创建员工";
          rows.push(row);
          continue;
        }
        row.employeeDept = p.departmentName;
        row.willCreateDepartment = !deptNames.has(p.departmentName);
      }

      if (!p.assetNo) {
        row.reason = "缺少设备编号";
        rows.push(row);
        continue;
      }
      const asset = assetByNo.get(p.assetNo);
      if (!asset) {
        row.reason = "未找到该设备编号";
        rows.push(row);
        continue;
      }
      row.assetId = asset.id;
      row.assetCategory = asset.template?.category?.name ?? null;
      row.assetStatus = getStatusLabel(asset.status);

      if (seenAssetNos.has(p.assetNo)) {
        row.reason = "该设备编号在清单中重复出现";
        rows.push(row);
        continue;
      }
      seenAssetNos.add(p.assetNo);

      if (asset.status !== "IDLE" && asset.status !== "IN_STOCK") {
        row.reason = `设备状态为「${getStatusLabel(asset.status)}」，不可分配`;
        rows.push(row);
        continue;
      }

      // 基础匹配通过 → 暂标可分配，唯一性冲突稍后统一复核
      row.ok = true;
      rows.push(row);
    }

    await markUniqueConflicts(
      rows.filter((r) => r.ok && r.assetId != null && r.employeeId != null),
      assetByNo
    );

    return {
      success: true,
      data: { rows, assignableCount: rows.filter((r) => r.ok).length },
    };
  } catch (e) {
    // 把真实原因带出来，避免只显示「解析失败」而不知道错在哪
    const detail = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Excel 解析失败：${detail}` };
  }
}

/** 用 planAllocation 复核唯一分类占用，命中者就地标为不可分配 */
async function markUniqueConflicts(
  candidateRows: AllocationImportRow[],
  assetByNo: Map<string, AssetWithCategory>
): Promise<void> {
  if (candidateRows.length === 0) return;

  const employeeIds = [...new Set(candidateRows.map((r) => r.employeeId!))];

  const ownedRows = await prisma.asset.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
      template: { category: { unique: true } },
    },
    select: { employeeId: true, template: { select: { categoryId: true } } },
  });
  const ownedByEmployee = new Map<number, number[]>();
  for (const row of ownedRows) {
    if (row.employeeId == null) continue;
    const list = ownedByEmployee.get(row.employeeId) ?? [];
    if (!list.includes(row.template.categoryId)) list.push(row.template.categoryId);
    ownedByEmployee.set(row.employeeId, list);
  }

  const byEmployee = new Map<number, AllocationImportRow[]>();
  for (const r of candidateRows) {
    const list = byEmployee.get(r.employeeId!) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId!, list);
  }

  for (const [employeeId, group] of byEmployee) {
    const planAssets: AllocationAsset[] = group.map((r) => {
      const a = assetByNo.get(r.assetNo)!;
      return {
        id: a.id,
        assetNo: a.assetNo,
        status: a.status,
        categoryId: a.template!.categoryId,
        categoryName: a.template!.category!.name,
        categoryUnique: a.template!.category!.unique,
        employeeId: a.employeeId,
      };
    });

    const employee: AllocationEmployee = {
      id: employeeId,
      name: group[0].employeeName,
      employeeNo: "",
      departmentId: 0,
      departmentName: group[0].employeeDept ?? "",
      ownedUniqueCategoryIds: ownedByEmployee.get(employeeId) ?? [],
    };

    const plan = planAllocation(planAssets, [employee]);
    const conflictByAssetId = new Map(plan.conflicts.map((c) => [c.assetId, c.reason]));
    for (const r of group) {
      const reason = r.assetId != null ? conflictByAssetId.get(r.assetId) : undefined;
      if (reason) {
        r.ok = false;
        r.reason = reason;
      }
    }
  }
}

// ============================================================
// 确认分配
// ============================================================

export interface AllocationConfirmItem {
  employeeName: string;
  /** 姓名在系统中不存在时用于建档的部门 */
  departmentName: string | null;
  assetId: number;
}

/**
 * 确认落库：先补建缺失的部门与员工（工号自动生成），再把可行子集交给
 * `allocateAssetsToEmployees`（同样按员工分组走 planAllocation），落库口径与预览一致。
 */
export async function confirmAllocationImport(input: {
  items: AllocationConfirmItem[];
}): Promise<
  ActionResult<{
    allocatedCount: number;
    skipped: AllocateSkipped[];
    createdDepartments: number;
    createdEmployees: number;
  }>
> {
  const user = await requireAuth();

  const items = (input.items ?? []).filter(
    (i) => i.employeeName?.trim() && i.assetId != null
  );
  if (items.length === 0) {
    return { success: false, error: "没有可分配的数据" };
  }

  const names = [...new Set(items.map((i) => i.employeeName.trim()))];

  const existing = await prisma.employee.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  const employeeIdByName = new Map(existing.map((e) => [e.name, e.id]));

  // 需要新建员工的行 → 需要的部门名
  const neededDeptNames = [
    ...new Set(
      items
        .filter((i) => !employeeIdByName.has(i.employeeName.trim()))
        .map((i) => (i.departmentName ?? "").trim())
        .filter(Boolean)
    ),
  ];

  let createdDepartments = 0;
  let createdEmployees = 0;

  await prisma.$transaction(async (tx) => {
    // 部门：不存在则创建
    const deptIdByName = new Map(
      (
        await tx.department.findMany({
          where: { name: { in: neededDeptNames } },
          select: { id: true, name: true },
        })
      ).map((d) => [d.name, d.id])
    );
    for (const name of neededDeptNames) {
      if (!deptIdByName.has(name)) {
        const d = await tx.department.create({ data: { name } });
        deptIdByName.set(name, d.id);
        createdDepartments++;
      }
    }

    // 员工：不存在则创建（工号自动生成）
    const usedNos = new Set(
      (await tx.employee.findMany({ select: { employeeNo: true } })).map((e) => e.employeeNo)
    );
    for (const item of items) {
      const name = item.employeeName.trim();
      if (employeeIdByName.has(name)) continue;
      const departmentId = deptIdByName.get((item.departmentName ?? "").trim());
      if (!departmentId) continue; // 无部门可用则跳过（预览已拦截）
      const employeeNo = generateEmployeeNo([...usedNos]);
      usedNos.add(employeeNo);
      const emp = await tx.employee.create({ data: { employeeNo, name, departmentId } });
      employeeIdByName.set(name, emp.id);
      createdEmployees++;
    }
  });

  const assignments: { assetId: number; employeeId: number }[] = [];
  for (const item of items) {
    const employeeId = employeeIdByName.get(item.employeeName.trim());
    if (employeeId == null) continue;
    assignments.push({ assetId: item.assetId, employeeId });
  }

  if (assignments.length === 0) {
    return { success: false, error: "没有可分配的数据" };
  }

  const result = await allocateAssetsToEmployees({
    assignments,
    operator: user.username,
    remark: "Excel 批量分配",
  });
  if (!result.success) return result;

  return {
    success: true,
    data: {
      allocatedCount: result.data.allocatedCount,
      skipped: result.data.skipped,
      createdDepartments,
      createdEmployees,
    },
  };
}