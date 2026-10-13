import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { unwrap } from "./helpers";
import { importAssetAssignments, exportAssetAssignTemplate } from "@/actions/excel.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

/**
 * 「批量分配设备」导入 action —— DB 集成测试（跑在隔离测试库上）。
 * 覆盖：自动创建部门/员工（含账号）、绑定并置在用、命名规则、编号错误的行级跳过与错误 Excel。
 */

const stamp = Date.now().toString().slice(-6);

function buildWorkbook(rows: Record<string, unknown>[]): number[] {
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["姓名", "部门", "设备编号01", "设备编号02"],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "设备分配");
  return Array.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function seedIdleAssets(count: number) {
  const category = await prisma.assetCategory.create({
    data: { name: `分配测试分类${stamp}`, code: `T${stamp}` },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: `分配测试模板${stamp}`, categoryId: category.id },
  });
  const assets = [];
  for (let i = 0; i < count; i++) {
    assets.push(
      await prisma.asset.create({
        data: {
          assetNo: `T${stamp}-${String(i + 1).padStart(2, "0")}`,
          name: `闲置设备${i + 1}`,
          templateId: template.id,
          status: "IDLE",
        },
      })
    );
  }
  return { category, template, assets };
}

describe("importAssetAssignments", () => {
  beforeEach(async () => {
    // operatorId 有外键，测试用户必须是真实的 Admin 行
    const admin = await prisma.admin.create({
      data: { username: `assign-admin-${stamp}`, password: "x" },
    });
    setTestUser({ id: admin.id, username: admin.username, permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("按姓名把编号绑定到人：自动创建部门/员工（含账号），设备置在用并按命名规则改名", async () => {
    const { category, assets } = await seedIdleAssets(2);

    const buffer = buildWorkbook([
      {
        姓名: "张三",
        部门: `技术部${stamp}`,
        设备编号01: assets[0].assetNo,
        设备编号02: assets[1].assetNo,
      },
    ]);

    const data = unwrap(await importAssetAssignments({ buffer }));

    expect(data.assignedCount).toBe(2);
    expect(data.errorCount).toBe(0);
    expect(data.errorFile).toBeUndefined();

    const dept = await prisma.department.findUnique({ where: { name: `技术部${stamp}` } });
    expect(dept).not.toBeNull();

    const emp = await prisma.employee.findFirst({
      where: { name: "张三", departmentId: dept!.id },
    });
    expect(emp).not.toBeNull();
    // 账号完全绑定在员工上（用户名=工号、首登强制改密）
    const account = await prisma.admin.findUnique({ where: { employeeId: emp!.id } });
    expect(account).not.toBeNull();
    expect(account!.username).toBe(emp!.employeeNo);
    expect(account!.mustChangePassword).toBe(true);

    const updated = await prisma.asset.findMany({
      where: { id: { in: [assets[0].id, assets[1].id] } },
      orderBy: { assetNo: "asc" },
    });
    for (const asset of updated) {
      expect(asset.status).toBe("IN_USE");
      expect(asset.employeeId).toBe(emp!.id);
      expect(asset.name).toBe(`张三的${category.name}`);
    }

    // 生命周期日志带人员，供设备详情时间线展示「分配给」
    const logs = await prisma.lifecycleLog.findMany({
      where: { assetId: { in: [assets[0].id, assets[1].id] } },
    });
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.action).toBe("ALLOCATED");
      expect(log.employeeId).toBe(emp!.id);
      expect(log.toStatus).toBe("IN_USE");
    }

    // 系统日志（module=分配）
    const sysLogs = await prisma.systemLog.findMany({ where: { module: "分配" } });
    expect(sysLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("编号不存在/非闲置：标记错误并跳过，其余继续导入；错误行可导出为 Excel", async () => {
    const { assets } = await seedIdleAssets(1);
    // 造一台非闲置设备
    const inUse = await prisma.asset.create({
      data: {
        assetNo: `T${stamp}-USED`,
        name: "在用设备",
        templateId: assets[0].templateId,
        status: "IN_USE",
      },
    });

    const buffer = buildWorkbook([
      {
        姓名: "李四",
        部门: `市场部${stamp}`,
        设备编号01: assets[0].assetNo, // 正常
        设备编号02: `NOT-EXIST-${stamp}`, // 不存在
      },
      {
        姓名: "王五",
        部门: `行政部${stamp}`,
        设备编号01: inUse.assetNo, // 非闲置
      },
    ]);

    const data = unwrap(await importAssetAssignments({ buffer }));

    expect(data.assignedCount).toBe(1);
    expect(data.errorCount).toBe(2);
    expect(data.errorFile).toBeDefined();

    const reasons = data.errors.map((e) => e.reason).join("|");
    expect(reasons).toContain("设备编号不存在");
    expect(reasons).toContain("非闲置");

    // 正常那台已分配
    const ok = await prisma.asset.findUnique({ where: { id: assets[0].id } });
    expect(ok!.status).toBe("IN_USE");

    // 错误行 Excel 可解析回原数据
    const wb = XLSX.read(Buffer.from(data.errorFile!.buffer));
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r["错误原因"]).join("|")).toContain("设备编号不存在");
  });

  it("导出模板：表头为 姓名 | 部门 | 设备编号01…", async () => {
    const data = unwrap(await exportAssetAssignTemplate());
    const wb = XLSX.read(Buffer.from(data.buffer));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const header = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
    expect(header[0]).toBe("姓名");
    expect(header[1]).toBe("部门");
    expect(header[2]).toBe("设备编号01");
  });
});