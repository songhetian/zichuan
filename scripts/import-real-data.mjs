// ============================================================
// 导入真实项目数据库数据：将 dump 替换 asset-manage-dev 的演示数据
//
// 行为：
//  1. 解析 dump（Node 手写 SQL 字面值 tokenizer，不依赖 mysql 客户端）
//  2. 备份当前业务数据为 JSON 快照（可回滚）到 scripts/backups/
//  3. 清空业务表（保留系统配置：角色/权限/流程/超管/资产管理员账号）
//  4. 按「旧→新」映射导入：分类/型号/库存 → 部门/员工/账号角色 →
//     模板去重/BOM → 资产/配件/日志/盘点/系统日志
//
// 用法： node scripts/import-real-data.mjs
// ============================================================
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./load-env.js";
import { loadDevConfig } from "./dev-config.js";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv();
loadEnv(".env.dev", { override: true });
loadDevConfig(); // 仅确保读取前缀；默认库即 dev
const prisma = new PrismaClient();

const DUMP_PATH =
  "/Users/song/.trae-cn/attachments/6ab0848665d742f3c121b9f8/092cb995-6236-4f8c-8b40-3f14a5fc9b15_a2c9f23d-a82b-4d45-a4ec-8248900ab98e_zichuan_before_dedupe_20260917.sql";
const BACKUP_DIR = resolve(__dirname, "backups");

// ---------- SQL 字面值解析 ----------
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

// MySQL datetime "YYYY-MM-DD HH:MM:SS[.fff]" -> ISO-8601（UTC，保留原钟面读数）
function toISO(v) {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) {
    return v.replace(" ", "T") + "Z";
  }
  return v;
}

function unquoteValue(v) {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "NULL" || t === "") return null;
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

function parseDump(filePath) {
  const content = readFileSync(filePath, "utf8");
  const data = {}; // table -> rows
  for (const line of content.split("\n")) {
    const m = line.match(/^INSERT INTO `(\w+)` VALUES (.+);\s*$/);
    if (m) {
      const table = m[1];
      data[table] = parseValuesList(m[2]);
    }
  }
  console.log(
    "解析 dump 完成：" +
      Object.entries(data)
        .map(([t, r]) => `${t}=${r.length}`)
        .join(", ")
  );
  return data;
}

// ---------- 备份（业务表 JSON 快照） ----------
async function backupBusinessData() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const models = [
    "assetCategory","componentCategory","componentModel","componentStock",
    "componentStockLog","department","employee","deviceTemplate",
    "templateComponent","asset","assetComponent","lifecycleLog",
    "stocktakeSession","stocktakeRecord","systemLog",
  ];
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(BACKUP_DIR, `dev-backup-${suffix}.json`);
  console.log(`备份业务数据 → ${file}`);
  for (const m of models) {
    const rows = await prisma[m].findMany();
    // 序列化：BigInt 无；Date 转 ISO
    writeFileSync(file.replace(".json", `-${m}.json`), JSON.stringify(rows, null, 2));
    console.log(`  ${m}: ${rows.length}`);
  }
}

// ---------- 清空业务表（保留系统配置） ----------
async function clearBusinessData() {
  console.log("清空业务数据（保留角色/权限/流程/超管/资产管理员账号）...");
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.approvalLog.deleteMany(),
    prisma.approvalTask.deleteMany(),
    prisma.approvalRequest.deleteMany(),
    prisma.stocktakeRecord.deleteMany(),
    prisma.stocktakeSession.deleteMany(),
    prisma.lifecycleLog.deleteMany(),
    prisma.assetComponent.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.templateComponent.deleteMany(),
    prisma.deviceTemplate.deleteMany(),
    prisma.componentStockLog.deleteMany(),
    prisma.componentStock.deleteMany(),
    prisma.componentModel.deleteMany(),
    prisma.componentCategory.deleteMany(),
    prisma.assetCategory.deleteMany(),
    prisma.systemLog.deleteMany(),
  ]);
  // 员工绑定的登录账号（保留 admin / assetmgr 两个系统账号）
  const empAdmins = await prisma.admin.findMany({
    where: { employeeId: { not: null } },
    select: { id: true },
  });
  await prisma.admin.deleteMany({ where: { id: { in: empAdmins.map((a) => a.id) } } });
  await prisma.$transaction([
    prisma.employee.deleteMany(),
    prisma.department.deleteMany(),
  ]);
  console.log("清空完成。");
}

// ---------- 通用：createMany 后按 id 升序读出，返回 oldId->newId 映射 ----------
// rows 必须已按旧 id 升序排列（autoincrement 保证新 id 同序）。
async function createMapped(rows, model, transform, orderField = "id") {
  const dataArr = rows.map((r) => transform(r));
  await prisma[model].createMany({ data: dataArr });
  const created = await prisma[model].findMany({ orderBy: { [orderField]: "asc" } });
  if (created.length !== rows.length) {
    throw new Error(`${model}: 期望 ${rows.length} 行，读到 ${created.length} 行`);
  }
  const map = new Map();
  for (let i = 0; i < rows.length; i++) {
    map.set(Number(rows[i][0]), created[i].id);
  }
  return map;
}

const toBool = (v) => v === "1" || v === 1 || v === true;

async function main() {
  if (process.argv.includes("--no-backup") !== true) {
    await backupBusinessData();
  } else {
    console.log("跳过备份（--no-backup）");
  }

  const d = parseDump(DUMP_PATH);
  await clearBusinessData();

  // 别名读取
  const assetCatRows = (d.AssetCategory || []).sort((a, b) => a[0] - b[0]);
  const compCatRows = (d.ComponentCategory || []).sort((a, b) => a[0] - b[0]);
  const compModelRows = (d.ComponentModel || []).sort((a, b) => a[0] - b[0]);
  const compStockRows = (d.ComponentStock || []).sort((a, b) => a[0] - b[0]);
  const compStockLogRows = (d.ComponentStockLog || []).sort((a, b) => a[0] - b[0]);
  const deptRows = (d.Department || []).sort((a, b) => a[0] - b[0]);
  const empRows = (d.Employee || []).sort((a, b) => a[0] - b[0]);
  const templateRows = (d.DeviceTemplate || []).sort((a, b) => a[0] - b[0]);
  const tcRows = d.TemplateComponent || [];
  const assetRows = (d.Asset || []).sort((a, b) => a[0] - b[0]);
  const acRows = d.AssetComponent || [];
  const lifesRows = d.LifecycleLog || [];
  const sysRows = d.SystemLog || [];
  const sessRow = (d.StocktakeSession || [])[0];
  const recRows = d.StocktakeRecord || [];

  // ---- 1. 配件分类 + 型号 + 库存 ----
  // createMapped 需按旧 id 升序，分类 parentId 指向更小 id，先置空后回填
  const compCatMap = await createMapped(compCatRows, "componentCategory", (r) => ({
    name: r[1],
    parentId: null,
    createdAt: r[3],
  }));
  for (let i = 0; i < compCatRows.length; i++) {
    const old = compCatRows[i];
    const parentOld = old[2];
    if (parentOld != null) {
      await prisma.componentCategory.update({
        where: { id: compCatMap.get(Number(old[0])) },
        data: { parentId: compCatMap.get(Number(parentOld)) },
      });
    }
  }

  // 型号（去重 key: categoryId,name,brand）
  const modelSeen = new Set();
  const modelKeepOld = [];
  for (const r of compModelRows) {
    const key = `${r[3]}|${r[1]}|${r[2]}`;
    if (!modelSeen.has(key)) { modelSeen.add(key); modelKeepOld.push(r); }
  }
  const modelMap = await createMapped(modelKeepOld, "componentModel", (r) => ({
    name: r[1],
    brand: r[2],
    categoryId: compCatMap.get(Number(r[3])),
  }));
  const stockMap = await createMapped(compStockRows, "componentStock", (r) => ({
    modelId: modelMap.get(Number(r[1])),
    quantity: Number(r[2]),
    updatedAt: r[3],
  }));
  await createMapped(compStockLogRows, "componentStockLog", (r) => ({
    modelId: modelMap.get(Number(r[1])),
    type: r[2],
    quantity: Number(r[3]),
    operator: r[4],
    remark: r[5],
    createdAt: r[6],
  }));

  // ---- 2. 设备分类 ----
  const assetCatMap = await createMapped(assetCatRows, "assetCategory", (r) => ({
    name: r[1],
    code: r[2],
    unique: toBool(r[3]),
    parentId: null, // 稍后回填（父分类 id 更小，需先建立）
    createdAt: r[5],
    updatedAt: r[6],
    numberingRule: r[7],
  }));
  for (let i = 0; i < assetCatRows.length; i++) {
    const old = assetCatRows[i];
    const parentOld = old[4];
    if (parentOld != null) {
      await prisma.assetCategory.update({
        where: { id: assetCatMap.get(Number(old[0])) },
        data: { parentId: assetCatMap.get(Number(parentOld)) },
      });
    }
  }

  // ---- 3. 部门 + 员工（补 managerId）+ 登录账号/角色 ----
  const deptMap = await createMapped(deptRows, "department", (r) => ({
    name: r[1],
    createdAt: r[2],
    updatedAt: r[3],
  }));

  // 员工：每部门工号最小者任主管（与 org-bootstrap 规则一致）
  const empGroups = new Map(); // deptOld -> rows
  for (const r of empRows) {
    const dept = Number(r[3]);
    if (!empGroups.has(dept)) empGroups.set(dept, []);
    empGroups.get(dept).push(r);
  }
  const empMap = new Map();
  const passwordHash = (await import("bcryptjs")).default.hashSync("123456", 10);
  const deptMgrRole = await prisma.role.findUnique({ where: { key: "DEPT_MANAGER" } });
  const employeeRole = await prisma.role.findUnique({ where: { key: "EMPLOYEE" } });

  const empCreate = [];
  for (const [deptOld, rows] of empGroups) {
    rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    let headId = null;
    const newDeptId = deptMap.get(deptOld);
    for (const r of rows) {
      const empNo = r[1];
      const rec = {
        employeeNo: empNo,
        name: r[2],
        departmentId: newDeptId,
        phone: r[4],
        email: r[5],
        createdAt: r[6],
        updatedAt: r[7],
        managerId: headId,
      };
      const created = await prisma.employee.create({ data: rec });
      empMap.set(Number(r[0]), created.id);
      if (headId === null) headId = created.id;
      empCreate.push({ empNo, name: r[2], empId: created.id, head: created.id === headId });
    }
    await prisma.department.update({ where: { id: newDeptId }, data: { managerId: headId } });
  }
  // 登录账号（用户名=工号，初始密码 123456），主管=DEPT_MANAGER、其余=EMPLOYEE
  const adminCreate = [];
  for (const { empNo, name, empId, head } of empCreate) {
    adminCreate.push({
      username: empNo,
      password: passwordHash,
      displayName: name,
      roleId: head ? deptMgrRole.id : employeeRole.id,
      employeeId: empId,
    });
  }
  for (let i = 0; i < adminCreate.length; i += 100) {
    await prisma.admin.createMany({ data: adminCreate.slice(i, i + 100) });
  }

  // ---- 4. 设备模板（去重：strip " (N)" 后缀分组，每组保留代表作）----
  const stripSuffix = (name) => name.replace(/\s*\(\d+\)\s*$/, "");
  const groupOrder = new Map(); // key -> array of row indices
  templateRows.forEach((r, idx) => {
    const key = `${r[2]}|${stripSuffix(r[1])}`;
    if (!groupOrder.has(key)) groupOrder.set(key, []);
    groupOrder.get(key).push(idx);
  });
  const keptTemplates = []; // rows kept (representative)
  const templateKeepMap = new Map(); // old template id -> new id
  for (const group of groupOrder.values()) {
    // 代表作：优先无后缀名，否则最小 id
    const baseMembers = group.filter((i) => templateRows[i][1] === stripSuffix(templateRows[i][1]));
    const chosen = (baseMembers.length ? baseMembers : group).sort((a, b) => templateRows[a][0] - templateRows[b][0])[0];
    keptTemplates.push(templateRows[chosen]);
    for (const idx of group) templateKeepMap.set(Number(templateRows[idx][0]), null); // 占位
  }
  keptTemplates.sort((a, b) => a[0] - b[0]);
  // 创建代表作（按 id 升序）
  const createdTpls = [];
  for (const r of keptTemplates) {
    const created = await prisma.deviceTemplate.create({
      data: { name: r[1], categoryId: assetCatMap.get(Number(r[2])) },
    });
    createdTpls.push({ oldId: Number(r[0]), newId: created.id });
  }

  // 回填「旧 模板 id -> 新 模板 id」（组内全部指向代表作）
  const repOldToNew = new Map(createdTpls.map((c) => [c.oldId, c.newId]));
  const repOfGroup = new Map(); // group key -> representative old id
  for (const [key, group] of groupOrder) {
    const baseMembers = group.filter((i) => templateRows[i][1] === stripSuffix(templateRows[i][1]));
    const chosen = (baseMembers.length ? baseMembers : group).sort((a, b) => templateRows[a][0] - templateRows[b][0])[0];
    repOfGroup.set(key, Number(templateRows[chosen][0]));
  }
  for (const [key, group] of groupOrder) {
    const repOld = repOfGroup.get(key);
    for (const idx of group) templateKeepMap.set(Number(templateRows[idx][0]), repOldToNew.get(repOld));
  }

  // BOM（模板配件）：按 [keptTemplate, modelId] 聚合数量
  const tcAgg = new Map(); // `${tpl}|${model}` -> quantity
  for (const r of tcRows) {
    const tpl = templateKeepMap.get(Number(r[1]));
    const model = modelMap.get(Number(r[2]));
    const key = `${tpl}|${model}`;
    tcAgg.set(key, (tcAgg.get(key) || 0) + Number(r[3]));
  }
  for (const [key, qty] of tcAgg) {
    const [tpl, model] = key.split("|").map(Number);
    await prisma.templateComponent.create({ data: { templateId: tpl, modelId: model, quantity: qty } });
  }
  console.log(`设备模板去重：${templateRows.length} -> ${createdTpls.length}`);

  // ---- 5. 资产 + 配件 + 生命周期日志 ----
  const assetMap = new Map();
  for (const r of assetRows) {
    const created = await prisma.asset.create({
      data: {
        assetNo: r[1],
        name: r[2],
        templateId: templateKeepMap.get(Number(r[3])),
        status: r[4],
        employeeId: r[5] != null ? empMap.get(Number(r[5])) : null,
        location: r[6],
        purchaseDate: r[7],
        warrantyMonths: r[8] != null ? Number(r[8]) : null,
        notes: r[9],
        createdAt: r[10],
        updatedAt: r[11],
      },
    });
    assetMap.set(Number(r[0]), created.id);
  }
  for (const r of acRows) {
    await prisma.assetComponent.create({
      data: {
        assetId: assetMap.get(Number(r[1])),
        modelId: modelMap.get(Number(r[2])),
        quantity: Number(r[3]),
      },
    });
  }
  for (const r of lifesRows) {
    await prisma.lifecycleLog.create({
      data: {
        assetId: assetMap.get(Number(r[1])),
        action: r[2],
        fromStatus: r[3],
        toStatus: r[4],
        employeeId: r[5] != null ? empMap.get(Number(r[5])) : null,
        fromEmployeeId: r[6] != null ? empMap.get(Number(r[6])) : null,
        operator: r[7],
        operatorId: null,
        requestId: null,
        remark: r[8],
        createdAt: r[9],
      },
    });
  }

  // ---- 6. 盘点 + 系统日志 ----
  let sessNewId = null;
  if (sessRow) {
    const s = await prisma.stocktakeSession.create({
      data: {
        name: sessRow[1],
        description: sessRow[2],
        status: sessRow[3],
        startedAt: sessRow[4],
        completedAt: sessRow[5],
      },
    });
    sessNewId = s.id;
  }
  for (const r of recRows) {
    await prisma.stocktakeRecord.create({
      data: {
        sessionId: sessNewId,
        assetId: assetMap.get(Number(r[2])),
        expectedStatus: r[3],
        actualStatus: r[4],
        remark: r[5],
      },
    });
  }
  for (const r of sysRows) {
    await prisma.systemLog.create({
      data: { module: r[1], action: r[2], detail: r[3], operator: r[4], createdAt: r[5] },
    });
  }

  // ---- 汇总 ----
  const count = async (p) => prisma[p].count();
  console.log("======== 导入完成，校验 ========");
  for (const [name, model] of [
    ["assetCategory", "assetCategory"], ["componentCategory", "componentCategory"],
    ["componentModel", "componentModel"], ["componentStock", "componentStock"],
    ["componentStockLog", "componentStockLog"], ["department", "department"],
    ["employee", "employee"], ["admin", "admin"], ["deviceTemplate", "deviceTemplate"],
    ["templateComponent", "templateComponent"], ["asset", "asset"],
    ["assetComponent", "assetComponent"], ["lifecycleLog", "lifecycleLog"],
    ["stocktakeSession", "stocktakeSession"], ["stocktakeRecord", "stocktakeRecord"],
    ["systemLog", "systemLog"],
  ]) {
    console.log(`  ${name}: ${await count(model)}`);
  }
  const keepEmps = await prisma.employee.count();
  console.log(`  期望：部门=${deptRows.length} 员工=${empRows.length} 员工账号=${empRows.length}`);
}

main()
  .catch((e) => { console.error("导入失败:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());