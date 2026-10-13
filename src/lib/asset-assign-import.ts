import * as XLSX from "xlsx";

/**
 * 「批量分配设备」Excel 导入 —— 纯解析层（无副作用、不连库，便于单测）。
 *
 * 模板形状（每行一个人，后面若干列是分配给该人的设备编号）：
 *   姓名 | 部门 | 设备编号01 | 设备编号02 | ...
 *
 * 解析约定：
 *   - 「姓名」列为空但填了设备编号 → 该编号记错误（无法确定分配对象）
 *   - 同一编号在文件中重复出现 → 仅首次保留，后续记错误
 *   - 整行空白、或有人但没填任何编号 → 静默忽略
 *   - 除「姓名 / 部门 / 设备编号*」外的列（如错误行回填的「错误原因」）一律忽略
 */

const NAME_KEY = "姓名";
const DEPT_KEY = "部门";
const DEVICE_COL = /设备编号/;

export interface AssignImportPerson {
  /** Excel 行号（含表头，从 2 开始） */
  rowNo: number;
  name: string;
  department: string;
  assetNos: string[];
}

export interface AssignImportIssue {
  /** Excel 行号（含表头，从 2 开始） */
  rowNo: number;
  name: string;
  department: string;
  assetNo: string;
  reason: string;
}

export interface AssignSheetParseResult {
  people: AssignImportPerson[];
  issues: AssignImportIssue[];
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** 解析导入表：行数组 → 人员分配意图 + 行级错误 */
export function parseAssignSheet(
  sheet: Record<string, unknown>[]
): AssignSheetParseResult {
  const people: AssignImportPerson[] = [];
  const issues: AssignImportIssue[] = [];
  /** 编号 → 首次出现的 Excel 行号（用于重复检测） */
  const firstSeenAt = new Map<string, number>();

  sheet.forEach((raw, index) => {
    const rowNo = index + 2;
    const name = toText(raw[NAME_KEY]);
    const department = toText(raw[DEPT_KEY]);

    // 表头行（被原样读进来时）：直接跳过
    if (name === NAME_KEY) return;

    const deviceValues: string[] = [];
    for (const key of Object.keys(raw)) {
      if (!DEVICE_COL.test(key)) continue;
      const value = toText(raw[key]);
      if (value) deviceValues.push(value);
    }

    // 整行空白：忽略
    if (!name && !department && deviceValues.length === 0) return;

    // 没有姓名：无法确定分配对象，逐编号报错
    if (!name) {
      for (const assetNo of deviceValues) {
        issues.push({
          rowNo,
          name,
          department,
          assetNo,
          reason: "缺少姓名，无法确定分配对象",
        });
      }
      return;
    }

    const assetNos: string[] = [];
    for (const assetNo of deviceValues) {
      const first = firstSeenAt.get(assetNo);
      if (first !== undefined) {
        issues.push({
          rowNo,
          name,
          department,
          assetNo,
          reason: `编号「${assetNo}」在文件中重复出现（第 ${first} 行已使用）`,
        });
        continue;
      }
      firstSeenAt.set(assetNo, rowNo);
      assetNos.push(assetNo);
    }

    // 有姓名但没有任何有效编号：无事可做
    if (assetNos.length === 0) return;

    people.push({ rowNo, name, department, assetNos });
  });

  return { people, issues };
}

/** 把错误清单生成为可下载、且能被本解析器直接再导入的错误行 Excel（buffer） */
export function buildAssignIssuesWorkbook(issues: AssignImportIssue[]): number[] {
  const rows = issues.map((issue) => ({
    姓名: issue.name,
    部门: issue.department,
    设备编号: issue.assetNo,
    错误原因: issue.reason,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["姓名", "部门", "设备编号", "错误原因"],
  });
  XLSX.utils.book_append_sheet(wb, ws, "错误行");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Array.from(buf);
}