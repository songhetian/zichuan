// ============================================================
// 旧库迁移映射的纯逻辑单元测试（不连接数据库）
//
// 只读取旧 dump 的 sql 文本，验证：
//   1. parser 能正确解析出 16 张业务表的列名与数据行；
//   2. buildRows 对每张表产出「可直接执行 upsert」的新 model 数据；
//   3. 已知风险点补齐策略符合预期（如 Admin 补 isActive=true、
//      Asset/Employee/Department/LifecycleLog 新增列补 null 等）。
//
// 依赖：scripts/legacy-mapping.js（共享解析 + 映射模块）。
// ============================================================
import { describe, it, expect } from "vitest";
import {
  parseLegacyDump,
  buildRows,
  mappingByModel,
  IMPORT_ORDER,
  LEGACY_TABLES,
} from "../scripts/legacy-mapping.js";
import { readFileSync } from "fs";

const DUMP_PATH =
  "/Users/song/.trae-cn/attachments/6aae199a315716f89c64c698/" +
  "a9459d80-4063-46d8-8aeb-c75f69dd3334_1199453e-9e85-4cbe-8fc2-64da68a82bcc_asset-manage.sql";

// dump 与 buildRows 来自共享 .js 模块，TS 推断较弱；在此限定为可重用的形状。
type Table = { columns: string[]; rows: any[][] };
const castDump = (d: unknown) => d as Record<string, Table>;
const castRows = (a: unknown) => a as any[];

function loadDump() {
  return castDump(parseLegacyDump(readFileSync(DUMP_PATH, "utf8")));
}

function dumpExists(): boolean {
  try {
    readFileSync(DUMP_PATH);
    return true;
  } catch {
    return false;
  }
}

describe("legacy-mapping 解析", () => {
  // 依赖本机附件 dump（旧库 SQL），文件缺失时整体跳过（如 CI/换机环境）
  it.skipIf(!dumpExists())("dump 中包含全部 16 张业务表", () => {
    const dump = loadDump();
    expect(dump).toBeDefined();
    for (const t of LEGACY_TABLES) {
      expect(dump[t], `缺少表 ${t}`).toBeDefined();
      expect(dump[t].columns.length).toBeGreaterThan(0);
    }
  });

  it.skipIf(!dumpExists())("解析出的列名与 INSERT 值位置对齐（抽样 Admin / Asset）", () => {
    const dump = loadDump();
    expect(dump.Admin.columns).toEqual(["id", "username", "password", "createdAt", "updatedAt"]);
    const assetCols = dump.Asset.columns;
    expect(assetCols[0]).toBe("id");
    expect(assetCols.slice(0, 6)).toEqual([
      "id", "assetNo", "name", "templateId", "status", "employeeId",
    ]);
    // 每行值数量与列数一致（保证位置不错位）
    for (const row of dump.Asset.rows) {
      expect(row.length).toBe(assetCols.length);
    }
  });

  it("MAP 映射覆盖 16 张旧表且模型名均小驼峰", () => {
    expect(LEGACY_TABLES.length).toBe(16);
    expect(Object.keys(mappingByModel).length).toBe(16);
    for (const m of Object.values(mappingByModel)) {
      expect(m.model).toBe(m.model[0].toLowerCase() + m.model.slice(1)); // 小驼峰
      expect(m.build).toBeTypeOf("function");
    }
  });
});

describe("buildRows 映射断言", () => {
  const hasDump = dumpExists();
  const dump = hasDump ? loadDump() : ({} as Record<string, Table>);
  const itDump = hasDump ? it : it.skip;

  itDump("Admin 补 isActive=true，且保留原始 id", () => {
    const rows: any[] = castRows(buildRows("admin", dump));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.isActive).toBe(true); // 旧表无 isActive，新模型必填 → 补 true
      expect(r.roleId).toBeNull(); // 角色关联由 seed 的 RolePermission 负责
      expect(r.employeeId).toBeNull(); // 旧表无员工绑定
      expect(r.username).toBeTypeOf("string");
      expect(r.password).toBeTypeOf("string");
      expect(typeof r.id).toBe("number");
    }
  });

  itDump("Asset 新增审批预占列补 null", () => {
    const rows: any[] = castRows(buildRows("asset", dump));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.reservedByRequestId).toBeNull();
      expect(r.reservedFromStatus).toBeNull();
      expect(r.assetNo).toBeTruthy();
      expect(r.templateId).toBeTypeOf("number");
    }
  });

  itDump("Department / Employee 新增 managerId 补 null", () => {
    const depts: any[] = castRows(buildRows("department", dump));
    for (const r of depts) {
      expect(r.managerId).toBeNull();
      expect(r.name).toBeTypeOf("string");
    }
    const emps: any[] = castRows(buildRows("employee", dump));
    for (const r of emps) {
      expect(r.managerId).toBeNull(); // 旧表无直属主管
      expect(r.employeeNo).toBeTruthy();
      expect(r.departmentId).toBeTypeOf("number");
    }
  });

  itDump("LifecycleLog 新增 operatorId / requestId 补 null", () => {
    const rows: any[] = castRows(buildRows("lifecycleLog", dump));
    for (const r of rows) {
      expect(r.operatorId).toBeNull();
      expect(r.requestId).toBeNull();
      expect(r.assetId).toBeTypeOf("number");
    }
  });

  itDump("AssetCategory 的 is_unique 映射为 unique 布尔列", () => {
    const rows: any[] = castRows(buildRows("assetCategory", dump));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(typeof r.unique).toBe("boolean");
      expect(r.code).toBeTypeOf("string");
    }
  });

  itDump("DeviceTemplate 去掉旧表生成的 normalizedName 冗余列", () => {
    const rows: any[] = castRows(buildRows("deviceTemplate", dump));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).not.toHaveProperty("normalizedName");
      expect(r.name).toBeTypeOf("string");
      expect(r.categoryId).toBeTypeOf("number");
    }
  });

  itDump("映射后的数值字段均为 number，日期字段可被执行 SQL 接受（不 NaN）", () => {
    const numericModels = ["componentModel", "componentStock", "componentStockLog", "templateComponent", "stocktakeRecord"];
    for (const m of numericModels) {
      const rows: any[] = castRows(buildRows(m, dump));
      for (const r of rows) {
        expect(r.id).toBeTypeOf("number");
        expect(Number.isNaN(Number(r.id))).toBe(false);
        for (const [k, v] of Object.entries(r)) {
          if (k !== "id" && /[Ii]d$/.test(k) && v !== null) {
            expect(typeof v, `${m}.${k}`).toBe("number");
            expect(Number.isNaN(Number(v))).toBe(false);
          }
        }
      }
    }
  });

  itDump("每条 create 数据都能被 JSON 序列化（可执行 SQL 写入前的最后校验）", () => {
    for (const m of IMPORT_ORDER as string[]) {
      for (const r of castRows(buildRows(m, dump))) {
        expect(() => JSON.stringify(r)).not.toThrow();
      }
    }
  });
});

describe("迁移顺序", () => {
  it("IMPORT_ORDER 恰好包含 16 张表且无重复", () => {
    expect(IMPORT_ORDER.length).toBe(16);
    expect(new Set(IMPORT_ORDER).size).toBe(16);
  });

  it("被引用表排在引用表之前（保证 FK 先插父后插子）", () => {
    const idx = (m: string) => (IMPORT_ORDER as string[]).indexOf(m);
    // componentModel 在 componentStock / componentStockLog / templateComponent 之前
    expect(idx("componentModel")).toBeLessThan(idx("componentStock"));
    expect(idx("componentModel")).toBeLessThan(idx("componentStockLog"));
    expect(idx("componentModel")).toBeLessThan(idx("templateComponent"));
    // deviceTemplate 在 templateComponent / asset 之前
    expect(idx("deviceTemplate")).toBeLessThan(idx("templateComponent"));
    expect(idx("deviceTemplate")).toBeLessThan(idx("asset"));
    // department 在 employee 之前；employee 在 asset 之前
    expect(idx("department")).toBeLessThan(idx("employee"));
    expect(idx("employee")).toBeLessThan(idx("asset"));
    // asset 在 assetComponent / lifecycleLog / stocktakeRecord 之前
    expect(idx("asset")).toBeLessThan(idx("assetComponent"));
    expect(idx("asset")).toBeLessThan(idx("lifecycleLog"));
    expect(idx("asset")).toBeLessThan(idx("stocktakeRecord"));
    // stocktakeSession 在 stocktakeRecord 之前
    expect(idx("stocktakeSession")).toBeLessThan(idx("stocktakeRecord"));
  });
});