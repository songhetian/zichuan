import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  createStocktakeSession,
  importStocktakeRows,
  importStocktakeFile,
  exportStocktakeAbnormal,
} from "@/actions/stocktake.actions";
import { parseStocktakeExcel } from "@/lib/stocktake-excel";

// ============================================================
// 测试 seam：Excel 盘点对账
//  Seam1 importStocktakeRows / Seam2 parseStocktakeExcel / Seam3 importStocktakeFile
// ============================================================

async function seedRole(key: string, permissions: string[]) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, isSystem: true },
  });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "asset", name: p },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function seedAccount(username: string, roleKey: string, permissions: string[]) {
  const role = await seedRole(roleKey, permissions);
  return prisma.admin.create({ data: { username, password: "x", roleId: role.id } });
}

/** 造一台基本设备环境：3 台设备 + 资产管理员账号；并已发起一个围绕全部设备的盘点任务 */
async function seedStocktakeEnv() {
  const assetMgr = await seedAccount("assetmgr", "ASSET_MANAGER", ["asset.manage"]);
  const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
  const template = await prisma.deviceTemplate.create({ data: { name: "标准办公电脑", categoryId: assetCat.id } });
  const a1 = await prisma.asset.create({ data: { assetNo: "DN-0001", name: "电脑1", templateId: template.id, status: "IN_USE" } });
  const a2 = await prisma.asset.create({ data: { assetNo: "DN-0002", name: "电脑2", templateId: template.id, status: "IN_USE" } });
  const a3 = await prisma.asset.create({ data: { assetNo: "DN-0003", name: "电脑3", templateId: template.id, status: "IN_USE" } });

  setTestUser({ id: assetMgr.id, username: assetMgr.username });
  const s = await createStocktakeSession({ name: "月度盘点", operator: "admin" });
  if (!s.success) throw new Error(`建立盘点任务失败：${s.error}`);
  const sessionId = s.data.id;

  return { assetMgr, assetCat, template, a1, a2, a3, sessionId };
}

function buildExcelBuffer(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}

/** 用 aoa 构造「真实单表头」工作表（首行为表头，数据行与其对齐） */
function buildAoaBuffer(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ============================================================
// Seam: exportStocktakeAbnormal — 导出异常报告（xlsx base64）
//  异常记录 = actualStatus 为 MISSING/EXTRA，或带 remark 备注
// ============================================================
describe("exportStocktakeAbnormal — 导出异常报告", () => {
  beforeEach(async () => {
    await prisma.stocktakeRecord.deleteMany();
    await prisma.stocktakeSession.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  /** 把返回的 base64 反读为行对象数组（表头为 key） */
  function readBase64(base64: string): Record<string, unknown>[] {
    const wb = XLSX.read(Buffer.from(base64, "base64"));
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws);
  }

  describe("权限与其他守卫", () => {
    it("a) 无 asset.manage 权限被拒", async () => {
      const { sessionId } = await seedStocktakeEnv();
      const noPerm = await seedAccount("noperm", "NO_PERM", []);
      setTestUser(noPerm);
      const r = await exportStocktakeAbnormal(sessionId);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error).toContain("权限");
    });

    it("b) session 不存在被拒", async () => {
      const { assetMgr } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      const r = await exportStocktakeAbnormal(999999);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error).toContain("不存在");
    });
  });

  describe("导出内容", () => {
    it("c) 仅导出异常记录：MISSING/EXTRA/带备注，不导出 NORMAL 无备注", async () => {
      const { assetMgr, a1, a2, a3, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);

      // DN-0001 MISSING 带备注、DN-0002 EXTRA、DN-0003 NORMAL 无备注
      await importStocktakeRows(sessionId, [
        { assetNo: "DN-0001", result: "MISSING", remark: "遗失" },
        { assetNo: "DN-0002", result: "EXTRA" },
      ]);

      const r = await exportStocktakeAbnormal(sessionId);
      expect(r.success).toBe(true);
      if (!r.success) return;
      const rows = readBase64(r.data.base64);
      expect(rows).toHaveLength(2);
      const byAssetNo = Object.fromEntries(rows.map((row) => [row["设备编号"], row]));
      expect(byAssetNo["DN-0001"]["实际状态"]).toBe("盘亏");
      expect(byAssetNo["DN-0001"]["备注"]).toBe("遗失");
      expect(byAssetNo["DN-0002"]["实际状态"]).toBe("盘盈");
      expect(byAssetNo["DN-0003"]).toBeUndefined(); // NORMAL 无备注不导出
    });

    it("d) 无异常记录时导出仅含表头的空表", async () => {
      const { assetMgr, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      const r = await exportStocktakeAbnormal(sessionId);
      expect(r.success).toBe(true);
      if (!r.success) return;
      const rows = readBase64(r.data.base64);
      expect(rows).toHaveLength(0);
    });

    it("e) 传入 selectedFields 时仅导出选中的列", async () => {
      const { assetMgr, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      await importStocktakeRows(sessionId, [{ assetNo: "DN-0001", result: "MISSING", remark: "遗失" }]);

      const r = await exportStocktakeAbnormal(sessionId, ["assetNo", "actualStatus"]);
      expect(r.success).toBe(true);
      if (!r.success) return;
      const rows = readBase64(r.data.base64);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row["设备编号"]).toBe("DN-0001");
      expect(row["实际状态"]).toBe("盘亏");
      // 未选中的列不出现在导出中
      expect(row["设备名称"]).toBeUndefined();
      expect(row["预期状态"]).toBeUndefined();
      expect(row["备注"]).toBeUndefined();
    });
  });
});

describe("Excel 盘点对账", () => {
  beforeEach(async () => {
    await prisma.stocktakeRecord.deleteMany();
    await prisma.stocktakeSession.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => setTestUser(null));

  describe("权限", () => {
    it("a) 无 asset.manage 权限被拒", async () => {
      const { sessionId } = await seedStocktakeEnv();
      const noPerm = await seedAccount("noperm", "NO_PERM", []);
      setTestUser(noPerm);
      const r = await importStocktakeRows(sessionId, [{ assetNo: "DN-0001", result: "MISSING" }]);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error).toContain("权限");
    });
  });

  describe("importStocktakeRows — 核心对账", () => {
    it("b) 正常对账：MISSING/EXTRA 更新，NORMAL 不变更；含未知编号计入 unknown", async () => {
      const { assetMgr, a1, a2, a3, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);

      const r = await importStocktakeRows(sessionId, [
        { assetNo: "DN-0001", result: "盘亏", remark: "盘亏" },
        { assetNo: "DN-0002", result: "EXTRA" },
        { assetNo: "DN-0003", result: "NORMAL" },
        { assetNo: "DN-9999", result: "EXTRA" },
      ]);
      expect(r.success).toBe(true);
      if (!r.success) return;

      // 更新 2 条（DN-0001 有变更、DN-0002 变更），NORMAL 不变，DN-9999 未知
      expect(r.data.updated).toBe(2);
      expect(r.data.unknown).toEqual(["DN-9999"]);

      const rec = await prisma.stocktakeRecord.findUniqueOrThrow({
        where: { sessionId_assetId: { sessionId, assetId: a1.id } },
      });
      expect(rec.actualStatus).toBe("MISSING");
      const rec2 = await prisma.stocktakeRecord.findUniqueOrThrow({
        where: { sessionId_assetId: { sessionId, assetId: a2.id } },
      });
      expect(rec2.actualStatus).toBe("EXTRA");
      const rec3 = await prisma.stocktakeRecord.findUniqueOrThrow({
        where: { sessionId_assetId: { sessionId, assetId: a3.id } },
      });
      expect(rec3.actualStatus).toBe("NORMAL"); // 未变更
    });

    it("b2) 带 remark 的 NORMAL 视为变更并更新", async () => {
      const { assetMgr, a1, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      const r = await importStocktakeRows(sessionId, [
        { assetNo: "DN-0001", result: "NORMAL", remark: "外观正常" },
      ]);
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.updated).toBe(1);
      expect(r.data.unknown).toEqual([]);
      const rec = await prisma.stocktakeRecord.findUniqueOrThrow({
        where: { sessionId_assetId: { sessionId, assetId: a1.id } },
      });
      expect(rec.remark).toBe("外观正常");
    });
  });

  describe("会话状态校验", () => {
    it("c) session 不存在 → 报错", async () => {
      const { assetMgr } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      const r = await importStocktakeRows(999999, [{ assetNo: "DN-0001", result: "MISSING" }]);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error).toContain("不存在");
    });

    it("c2) session 已完成（COMPLETED） → 报『盘点任务已完成』", async () => {
      const { assetMgr, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      await importStocktakeRows(sessionId, [{ assetNo: "DN-0001", result: "MISSING" }]);

      // 完成盘点后再次导入被拒
      await prisma.stocktakeSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      const r = await importStocktakeRows(sessionId, [{ assetNo: "DN-0001", result: "EXTRA" }]);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error).toContain("盘点任务已完成");
    });
  });

  describe("parseStocktakeExcel — 解析中文表头 + 中文结果值", () => {
    it("d) 容错映射：正常→NORMAL、盘亏→MISSING、在→NORMAL", () => {
      const buffer = buildAoaBuffer([
        ["设备编号", "实际状态", "备注"],
        ["DN-0001", "正常", "ok"],
        ["DN-0002", "盘亏", "找不到"],
        ["DN-0003", "在", ""],
      ]);
      const rows = parseStocktakeExcel(buffer);
      expect(rows).toEqual([
        { assetNo: "DN-0001", result: "NORMAL", remark: "ok" },
        { assetNo: "DN-0002", result: "MISSING", remark: "找不到" },
        { assetNo: "DN-0003", result: "NORMAL" },
      ]);
    });

    it("d2) 别名表头（资产编码/盘点结果）容错 + assetNo 为空的行被跳过", () => {
      const buffer = buildAoaBuffer([
        ["资产编码", "盘点结果"],
        ["DN-0001", "盘盈"],
        ["", "盘亏"],
      ]);
      const rows = parseStocktakeExcel(buffer);
      expect(rows).toEqual([{ assetNo: "DN-0001", result: "EXTRA" }]);
    });
  });

  describe("importStocktakeFile — 组合 action（上传文件）", () => {
    it("e) 上传中文 Excel → 对账 → 更新实际状态", async () => {
      const { assetMgr, a1, a2, sessionId } = await seedStocktakeEnv();
      setTestUser(assetMgr);
      const buffer = buildExcelBuffer([
        { "设备编号": "DN-0001", "实际状态": "盘亏", "备注": "遗失" },
        { "设备编号": "DN-0002", "实际状态": "正常", "备注": "" },
        { "设备编号": "DN-7777", "实际状态": "盘盈", "备注": "" },
      ]);
      const r = await importStocktakeFile(sessionId, buffer);
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.updated).toBe(1); // DN-0001 变更；DN-0002 NORMAL 无变更；DN-7777 未知
      expect(r.data.unknown).toEqual(["DN-7777"]);
      expect(r.data.rows).toBe(3); // 解析行数

      const rec = await prisma.stocktakeRecord.findUniqueOrThrow({
        where: { sessionId_assetId: { sessionId, assetId: a1.id } },
      });
      expect(rec.actualStatus).toBe("MISSING");
      const rec2 = await prisma.stocktakeRecord.findUniqueOrThrow({
        where: { sessionId_assetId: { sessionId, assetId: a2.id } },
      });
      expect(rec2.actualStatus).toBe("NORMAL");
    });
  });
});