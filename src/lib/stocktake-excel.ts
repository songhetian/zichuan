import * as XLSX from "xlsx";

// ============================================================
// Excel 盘点对账 — 纯解析逻辑（无 IO，可单测）
//  表头/结果值中文容错映射，见 Seam2 parseStocktakeExcel
// ============================================================

/** 解析后的一行：assetNo 必填，result 为归一化后的字符串 */
export interface StocktakeParsedRow {
  assetNo: string;
  result: string;
  remark?: string;
}

type HeaderKey = "assetNo" | "result" | "remark";

/** 表头容错映射：忽略大小写/去空格/含关键字 */
function classifyHeader(raw: unknown): HeaderKey | null {
  const h = String(raw ?? "").toLowerCase().replace(/\s+/g, "");
  if (/(资产编号|设备编号|设备编码|编号|编码|assetno)/.test(h)) return "assetNo";
  if (/(实际状态|盘点结果|状态|result)/.test(h)) return "result";
  if (/(备注|remark)/.test(h)) return "remark";
  return null;
}

/** 结果值中文容错：正常→NORMAL；盘亏→MISSING；盘盈→EXTRA；其它原样大写 */
export function normalizeResult(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return s;
  if (/(盘亏|缺失|没有|无|不在|不存在)/.test(s)) return "MISSING";
  if (/(盘盈|多余|异常)/.test(s)) return "EXTRA";
  if (/(正常|有|在)/.test(s)) return "NORMAL";
  return s.toUpperCase();
}

/** 生成异常报告用的一行数据（结构化，供 buildStocktakeAbnormalExcel 消费） */
export interface StocktakeAbnormalRow {
  assetNo: string;
  assetName: string;
  expectedStatus: string;
  actualStatus: string;
  remark?: string | null;
}

/** 预期/实际状态的中文展示 */
export const EXPECTED_STATUS_LABEL: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "已报废",
};

export const ACTUAL_RESULT_LABEL: Record<string, string> = {
  NORMAL: "正常",
  MISSING: "盘亏",
  EXTRA: "盘盈",
};

/**
 * 把结构化异常记录行转换为 xlsx 的 Buffer（不含中文表头的容错逻辑）
 * 列为：设备编号 / 设备名称 / 预期状态 / 实际状态 / 备注
 * fields: 可选，指定要导出的列 key；缺省导出全部列。
 */
export function buildStocktakeAbnormalExcel(
  rows: StocktakeAbnormalRow[],
  fields?: (keyof StocktakeAbnormalRow)[]
): Buffer {
  const selecteds = fields && fields.length > 0 ? fields : (Object.keys(resultColumns) as (keyof StocktakeAbnormalRow)[]);
  const data = rows.map((r) => {
    const row: Record<string, unknown> = {};
    for (const key of selecteds) {
      const col = resultColumns[key];
      if (col) row[col.label] = col.get(r);
    }
    return row;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "异常报告");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

const resultColumns: Record<keyof StocktakeAbnormalRow, { label: string; get: (r: StocktakeAbnormalRow) => unknown }> = {
  assetNo: { label: "设备编号", get: (r) => r.assetNo },
  assetName: { label: "设备名称", get: (r) => r.assetName },
  expectedStatus: { label: "预期状态", get: (r) => EXPECTED_STATUS_LABEL[r.expectedStatus] ?? r.expectedStatus },
  actualStatus: { label: "实际状态", get: (r) => ACTUAL_RESULT_LABEL[r.actualStatus] ?? r.actualStatus },
  remark: { label: "备注", get: (r) => r.remark ?? "" },
};

/** 读 Excel（第一个 sheet）为 JSON 行，做表头/结果值容错映射 */
export function parseStocktakeExcel(buffer: Buffer): StocktakeParsedRow[] {
  const wb = XLSX.read(buffer);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  if (rawRows.length === 0) return [];

  // 定位表头行：找到含「设备编号」与「实际状态/盘点结果」的列，其下为数据
  const colIndex = new Map<HeaderKey, number>();
  let bodyStart = 0;
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    for (let c = 0; c < row.length; c++) {
      const key = classifyHeader(row[c]);
      if (key && !colIndex.has(key)) colIndex.set(key, c);
    }
    if (colIndex.has("assetNo") && colIndex.has("result")) {
      bodyStart = i + 1;
      break;
    }
  }

  const assetNoCol = colIndex.get("assetNo");
  if (assetNoCol === undefined) return [];
  const resultCol = colIndex.get("result");
  const remarkCol = colIndex.get("remark");

  const out: StocktakeParsedRow[] = [];
  for (let i = bodyStart; i < rawRows.length; i++) {
    const row = rawRows[i];
    const assetNo = String(row[assetNoCol] ?? "").trim();
    if (!assetNo) continue; // 设备编号为空的行跳过

    const result = resultCol !== undefined ? normalizeResult(row[resultCol]) : "";
    const item: StocktakeParsedRow = { assetNo, result };

    if (remarkCol !== undefined) {
      const remark = String(row[remarkCol] ?? "").trim();
      if (remark) item.remark = remark;
    }
    out.push(item);
  }
  return out;
}