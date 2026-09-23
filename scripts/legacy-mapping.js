// ============================================================
// 旧库 → 新库 数据迁移的「纯逻辑」共享模块
//
// 只负责两件事，不连接数据库：
//   1. parseLegacyDump(sqlText)：解析 mysqldump，把每张表的
//      `INSERT INTO `T` VALUES (...)` 拆成「列名 + 行数组」。
//   2. buildRows(model, dump)：按当前 Prisma model 的字段，
//      产出可直接传给 prisma[model].upsert 的 create 数据数组。
//
// 这样 scripts/import-legacy.mjs（真实写入）与
// tests/legacy-mapping.test.ts（纯逻辑单测）可以共用同一套映射，
// 保证 CI 不连库也能校验映射正确性。
// ============================================================

// ---------- 通用值转换 ----------
// MySQL datetime "YYYY-MM-DD HH:MM:SS[.fff]" -> ISO-8601（UTC，保留原钟面读数）
function toISO(v) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) {
    return v.replace(" ", "T") + "Z";
  }
  return v;
}

function unescapeSqlString(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1]) {
      const c = s[i + 1];
      if (c === "'" || c === '"' || c === "\\") { out += c; i++; }
      else if (c === "n") { out += "\n"; i++; }
      else if (c === "r") { out += "\r"; i++; }
      else if (c === "0") { out += "\0"; i++; }
      else { out += s[i] + s[i + 1]; i++; }
    } else out += s[i];
  }
  return out;
}

function unquoteValue(v) {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "NULL" || t === "") return null;
  if (t === "DEFAULT") return "DEFAULT"; // generated/默认列占位
  if (t[0] === "'") {
    if (t.length >= 2 && t[t.length - 1] === "'") return toISO(unescapeSqlString(t.slice(1, -1)));
    return t.slice(1);
  }
  return t;
}

function findClosingParen(text, openIdx) {
  let depth = 0;
  let inStr = false;
  for (let j = openIdx; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (c === "\\") { j++; continue; }
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return { start: openIdx, end: j }; }
  }
  throw new Error("unbalanced paren in SQL");
}

function parseTuple(tupleText) {
  const values = [];
  let cur = "";
  let inStr = false;
  for (let j = 0; j < tupleText.length; j++) {
    const c = tupleText[j];
    if (inStr) {
      if (c === "\\") { cur += c; if (tupleText[j + 1]) { cur += tupleText[j + 1]; j++; } continue; }
      if (c === "'") { inStr = false; cur += "'"; continue; }
      cur += c; continue;
    }
    if (c === "'") { inStr = true; cur += "'"; continue; }
    if (c === ",") { values.push(unquoteValue(cur)); cur = ""; continue; }
    cur += c;
  }
  values.push(unquoteValue(cur));
  return values;
}

function parseValuesList(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "(") {
      const { start, end } = findClosingParen(text, i);
      rows.push(parseTuple(text.slice(start + 1, end)));
      i = end + 1;
    } else i++;
  }
  return rows;
}

/**
 * 解析 mysqldump。返回 { [表名]: { columns: string[], rows: any[][] } }
 * columns 为 CREATE TABLE 里按物理顺序出现的列名（保证与 INSERT 逐值位置对齐）。
 * rows 的某一行 = 该表一行数据，按 columns 顺序排列。
 */
export function parseLegacyDump(sqlText) {
  const content = String(sqlText);
  const result = {};

  // 1) 抓 CREATE TABLE 的列名（物理顺序）
  const createRe = /CREATE TABLE\s+`(\w+)`\s*\(([\s\S]*?)\)\s*ENGINE\s*=/g;
  let cm;
  while ((cm = createRe.exec(content)) !== null) {
    const table = cm[1];
    const body = cm[2];
    const cols = [];
    for (const line of body.split("\n")) {
      const m = line.match(/^\s*`(\w+)`\s/);
      if (m) cols.push(m[1]);
      // 不抓 KEY/INDEX/CONSTRAINT/PRIMARY 等其它行
    }
    if (!result[table]) result[table] = { columns: cols, rows: [] };
  }

  // 2) 抓 INSERT 数据，按列名逐行赋值
  const insRe = /INSERT INTO\s+`(\w+)`\s+VALUES\s+(.+?);?\s*(?:--|$)/g;
  let im;
  while ((im = insRe.exec(content)) !== null) {
    const table = im[1];
    const rows = parseValuesList(im[2]);
    if (!result[table]) result[table] = { columns: [], rows: [] };
    result[table].rows.push(...rows);
  }

  return result;
}

// ---------- 值类型辅助 ----------
const num = (v) => (v === null || v === undefined || v === "DEFAULT" ? null : Number(v));
// 数字字符串可能带引号（数字列被写成 '123'），统一取整
const int = (v) => {
  const n = num(v);
  return n === null || Number.isNaN(n) ? null : n;
};
const str = (v) => (v === null || v === undefined || v === "DEFAULT" ? null : v);
const bool = (v) => v === 1 || v === "1" || v === true;

/**
 * 取当前行指定列的值；列不存在时返回 undefined（旧表缺列 → 由映射决定补充默认值）。
 */
function get(record, columns, name) {
  const i = columns.indexOf(name);
  return i === -1 ? undefined : record[i];
}

// ---------- 每张表的「旧→新」数据映射 ----------
// 每项：{ model, table, build(record, cols) -> 新 model 的 create 数据 }
//
// 补默认值原则（对应 schema）：
//   * 旧表缺失、新 model 为可空/有默认的字段 → 填 null / 默认值，不丢数据。
//   * 新增 int 关联字段（managerId / operatorId / requestId / employeeId 等）全部补 null。
//   * Admin.isActive 必填默认 true → 补 true。
export const MAPPING = [
  {
    model: "admin",
    table: "Admin",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      username: get(r, cols, "username") ?? "",
      password: get(r, cols, "password") ?? "",
      displayName: null,
      roleId: null,
      employeeId: null,
      isActive: true, // 旧表无 isActive，新 model 必填默认 true → 补
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "asset",
    table: "Asset",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      assetNo: get(r, cols, "assetNo") ?? "",
      name: get(r, cols, "name") ?? "",
      templateId: int(get(r, cols, "templateId")),
      status: get(r, cols, "status") ?? "IDLE", // 旧值均为新枚举合法子集
      employeeId: int(get(r, cols, "employeeId")), // 旧可空
      location: str(get(r, cols, "location")),
      purchaseDate: get(r, cols, "purchaseDate"),
      warrantyMonths: int(get(r, cols, "warrantyMonths")),
      notes: str(get(r, cols, "notes")),
      // 新增审批预占列：旧表不存在 → 补 null
      reservedByRequestId: null,
      reservedFromStatus: null,
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "assetCategory",
    table: "AssetCategory",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      name: get(r, cols, "name") ?? "",
      code: get(r, cols, "code") ?? "",
      unique: bool(get(r, cols, "is_unique")), // 旧列 is_unique → 新 model unique
      parentId: int(get(r, cols, "parentId")),
      numberingRule: str(get(r, cols, "numberingRule")),
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "assetComponent",
    table: "AssetComponent",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      assetId: int(get(r, cols, "assetId")),
      modelId: int(get(r, cols, "modelId")),
      quantity: int(get(r, cols, "quantity")) ?? 1,
    }),
  },
  {
    model: "componentCategory",
    table: "ComponentCategory",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      name: get(r, cols, "name") ?? "",
      parentId: int(get(r, cols, "parentId")),
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "componentModel",
    table: "ComponentModel",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      name: get(r, cols, "name") ?? "",
      brand: str(get(r, cols, "brand")) ?? "",
      categoryId: int(get(r, cols, "categoryId")),
    }),
  },
  {
    model: "componentStock",
    table: "ComponentStock",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      modelId: int(get(r, cols, "modelId")),
      quantity: int(get(r, cols, "quantity")) ?? 0,
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "componentStockLog",
    table: "ComponentStockLog",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      modelId: int(get(r, cols, "modelId")),
      type: get(r, cols, "type"),
      quantity: int(get(r, cols, "quantity")),
      operator: get(r, cols, "operator") ?? "",
      remark: str(get(r, cols, "remark")),
      createdAt: get(r, cols, "createdAt"),
    }),
  },
  {
    model: "department",
    table: "Department",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      name: get(r, cols, "name") ?? "",
      managerId: null, // 旧表无部门主管 → 补 null（后续可手填 / 由员工回填）
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "deviceTemplate",
    table: "DeviceTemplate",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      name: get(r, cols, "name") ?? "",
      categoryId: int(get(r, cols, "categoryId")),
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
      // normalizedName 是旧表生成的冗余列，新 model 已去掉 → 忽略
    }),
  },
  {
    model: "employee",
    table: "Employee",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      employeeNo: get(r, cols, "employeeNo") ?? "",
      name: get(r, cols, "name") ?? "",
      departmentId: int(get(r, cols, "departmentId")),
      managerId: null, // 旧表无直属主管 → 补 null
      phone: str(get(r, cols, "phone")),
      email: str(get(r, cols, "email")), // 旧表已有邮箱
      createdAt: get(r, cols, "createdAt"),
      updatedAt: get(r, cols, "updatedAt"),
    }),
  },
  {
    model: "lifecycleLog",
    table: "LifecycleLog",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      assetId: int(get(r, cols, "assetId")),
      action: get(r, cols, "action"),
      fromStatus: str(get(r, cols, "fromStatus")),
      toStatus: str(get(r, cols, "toStatus")),
      employeeId: int(get(r, cols, "employeeId")),
      fromEmployeeId: int(get(r, cols, "fromEmployeeId")),
      operator: get(r, cols, "operator") ?? "",
      // 新增列：旧表无操作账号 / 关联申请单 → 补 null
      operatorId: null,
      requestId: null,
      remark: str(get(r, cols, "remark")),
      createdAt: get(r, cols, "createdAt"),
    }),
  },
  {
    model: "stocktakeRecord",
    table: "StocktakeRecord",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      sessionId: int(get(r, cols, "sessionId")),
      assetId: int(get(r, cols, "assetId")),
      expectedStatus: get(r, cols, "expectedStatus"),
      actualStatus: get(r, cols, "actualStatus"),
      remark: str(get(r, cols, "remark")),
    }),
  },
  {
    model: "stocktakeSession",
    table: "StocktakeSession",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      name: get(r, cols, "name") ?? "",
      description: str(get(r, cols, "description")),
      status: get(r, cols, "status") ?? "OPEN",
      startedAt: get(r, cols, "startedAt"),
      completedAt: get(r, cols, "completedAt"),
    }),
  },
  {
    model: "systemLog",
    table: "SystemLog",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      module: get(r, cols, "module") ?? "",
      action: get(r, cols, "action") ?? "",
      detail: get(r, cols, "detail") ?? "",
      operator: get(r, cols, "operator") ?? "",
      createdAt: get(r, cols, "createdAt"),
    }),
  },
  {
    model: "templateComponent",
    table: "TemplateComponent",
    build: (r, cols) => ({
      id: int(get(r, cols, "id")),
      templateId: int(get(r, cols, "templateId")),
      modelId: int(get(r, cols, "modelId")),
      quantity: int(get(r, cols, "quantity")) ?? 1,
    }),
  },
];

/** model 名 → 映射项 */
export const mappingByModel = Object.fromEntries(MAPPING.map((m) => [m.model, m]));

/**
 * 从 dump 数据中，为指定 model 生成「可直接 upsert 的 create 数据数组」。
 * 若旧 dump 缺少该表，返回空数组。
 * @param {string} model Prisma model 名（小驼峰，如 "asset"、"admin"）
 * @param {{[table:string]:{columns:string[],rows:any[][]}}} dump parseLegacyDump 的输出
 */
export function buildRows(model, dump) {
  const def = mappingByModel[model];
  if (!def) throw new Error(`未知 model: ${model}`);
  const t = dump[def.table];
  if (!t || !t.rows.length) return [];
  return t.rows.map((row) => def.build(row, t.columns));
}

/**
 * 迁移顺序：严格按外键依赖，被引用表先插入（主键 id 全保留，FK 值原样沿用即成立）。
 * 跳过的 10 张审批/权限/通知新表由 seed 负责，不在此列。
 */
export const IMPORT_ORDER = [
  "assetCategory",       // 无外键（自引用 parentId 可选）
  "componentCategory",   // 同分类树，自引用
  "componentModel",      // → componentCategory
  "componentStock",      // → componentModel
  "componentStockLog",   // → componentModel
  "deviceTemplate",      // → assetCategory
  "templateComponent",   // → deviceTemplate, componentModel
  "department",          // 无外键
  "employee",            // → department（managerId 补 null，无自引用依赖）
  "admin",               // → (employeeId=null)
  "asset",               // → deviceTemplate, employee
  "assetComponent",      // → asset, componentModel
  "lifecycleLog",        // → asset, employee（operatorId/requestId=null 不依赖 admin）
  "stocktakeSession",    // 无外键
  "stocktakeRecord",     // → stocktakeSession, asset
  "systemLog",           // 无外键
];

/** 旧库 16 张业务表名（用于断言 16 表全覆盖） */
export const LEGACY_TABLES = MAPPING.map((m) => m.table);