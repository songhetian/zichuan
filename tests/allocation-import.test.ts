/**
 * 「导入 Excel 自动分配」的服务端行为。
 *
 * 四个 seam（都是页面直接调用的公开 action）：
 *  - exportAllocationTemplate  导出空白导入模板：姓名 | 部门 | 设备编号01 | 设备编号02 … + 空行
 *  - previewAllocationImport   导回后逐行匹配：姓名 / 部门不存在则标记「将自动创建」
 *  - exportAllocationErrors    把不可分配的行（含错误原因）导出成可再导入的 Excel
 *  - confirmAllocationImport   确认落库：先补建缺失的部门与员工，再走 planAllocation 分配
 *
 * 清单规则：跳过表头行；一行可带多台设备编号（设备编号01/02…）；姓名不存在自动建员工，
 * 部门不存在自动建部门，再把编号绑定到该姓名的人下。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  exportAllocationTemplate,
  previewAllocationImport,
  exportAllocationErrors,
  confirmAllocationImport,
} from "@/actions/auto-allocate.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import type { AssetStatus } from "@prisma/client";
import * as XLSX from "xlsx";

const HEADER = ["姓名", "部门", "设备编号01"];

/** 用二维数组直接构造工作表，便于精确控制表头与多列设备编号 */
function gridBuffer(grid: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(grid);
  XLSX.utils.book_append_sheet(wb, ws, "待分配清单");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function setupCategory(prefix: string, unique = false) {
  const cat = await prisma.assetCategory.create({
    data: { name: `${prefix}分类`, code: prefix, unique },
  });
  const tpl = await prisma.deviceTemplate.create({
    data: { name: `${prefix}模板`, categoryId: cat.id },
  });
  return { cat, tpl };
}

async function addAsset(
  templateId: number,
  assetNo: string,
  opts: { status?: AssetStatus; employeeId?: number | null; name?: string } = {}
) {
  return prisma.asset.create({
    data: {
      assetNo,
      name: opts.name ?? assetNo,
      templateId,
      status: opts.status ?? "IDLE",
      employeeId: opts.employeeId ?? null,
    },
  });
}

async function addDepartment(name: string) {
  return prisma.department.create({ data: { name } });
}

async function addEmployee(name: string, departmentId: number, employeeNo: string) {
  return prisma.employee.create({ data: { employeeNo, name, departmentId } });
}

describe("导出空白模板 exportAllocationTemplate", () => {
  beforeEach(() => setTestUser({ id: 1, username: "admin" }));
  afterEach(() => setTestUser(null));

  it("生成空白模板：表头为 姓名|部门|设备编号01|设备编号02…，并预留空行供直接填写", async () => {
    const result = await exportAllocationTemplate();
    expect(result.success).toBe(true);

    const wb = XLSX.read(Buffer.from(unwrap(result).buffer));
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["待分配清单"], {
      header: 1,
      blankrows: true,
    });

    // 表头：姓名 | 部门 | 设备编号01 | 设备编号02 …（固定多个编号列，无需先选设备）
    expect(grid[0].slice(0, 2)).toEqual(["姓名", "部门"]);
    expect(grid[0].slice(2)).toEqual([
      "设备编号01",
      "设备编号02",
      "设备编号03",
      "设备编号04",
      "设备编号05",
    ]);
    // 不再出现「配置摘要」「状态」列
    expect(grid[0]).not.toContain("配置摘要");
    expect(grid[0]).not.toContain("状态");

    // 表头之后是若干空行，供主管直接填写（一行一个人 + 其持有的设备编号）
    expect(grid.length).toBeGreaterThan(1);
    for (const row of grid.slice(1)) {
      expect((row ?? []).every((c) => c === "" || c == null)).toBe(true);
    }
  });
});

describe("导出错误明细 exportAllocationErrors", () => {
  beforeEach(() => setTestUser({ id: 1, username: "admin" }));
  afterEach(() => setTestUser(null));

  it("把错误行导出为 姓名|部门|设备编号01|错误原因，且可再导入", async () => {
    const { tpl } = await setupCategory("ER");
    await addAsset(tpl.id, "ER-0001");

    const result = await exportAllocationErrors({
      rows: [
        { employeeName: "张三", departmentName: "ER部门", assetNo: "ER-9999", reason: "未找到该设备编号" },
      ],
    });
    expect(result.success).toBe(true);
    expect(unwrap(result).count).toBe(1);

    const wb = XLSX.read(Buffer.from(unwrap(result).buffer));
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(grid[0]).toEqual(["姓名", "部门", "设备编号01", "错误原因"]);
    expect(grid[1]).toEqual(["张三", "ER部门", "ER-9999", "未找到该设备编号"]);

    // 导出的文件结构本身就是可再导入的清单：改正编号后重新导入即可
    const preview = await previewAllocationImport({ buffer: Buffer.from(unwrap(result).buffer) });
    expect(unwrap(preview).rows).toHaveLength(1);
  });

  it("没有错误行时返回错误", async () => {
    const result = await exportAllocationErrors({ rows: [] });
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("没有错误行");
  });
});

describe("预览导入 previewAllocationImport", () => {
  beforeEach(() => setTestUser({ id: 1, username: "admin" }));
  afterEach(() => setTestUser(null));

  it("跳过表头行，不把表头当成数据", async () => {
    const { tpl } = await setupCategory("SK");
    await addAsset(tpl.id, "SK-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["张三", "技术部", "SK-0001"]]),
    });

    const { rows } = unwrap(result);
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeName).toBe("张三");
  });

  it("文件数据以 number[] 传入时同样能解析（浏览器跨 server action 边界用的就是 number[]）", async () => {
    const { tpl } = await setupCategory("NB");
    await addAsset(tpl.id, "NB-0001");

    const bytes = Array.from(gridBuffer([HEADER, ["张三", "NB部门", "NB-0001"]]));
    const result = await previewAllocationImport({ buffer: bytes });

    expect(result.success).toBe(true);
    expect(unwrap(result).rows).toHaveLength(1);
    expect(unwrap(result).rows[0].assetNo).toBe("NB-0001");
  });

  it("员工已存在：可分配并显示其现有部门", async () => {
    const { tpl } = await setupCategory("PV");
    const dept = await addDepartment("PV部门");
    const emp = await addEmployee("张三", dept.id, "PV01");
    await addAsset(tpl.id, "PV-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["张三", "别的部门", "PV-0001"]]),
    });

    const row = unwrap(result).rows[0];
    expect(row.ok).toBe(true);
    expect(row.employeeId).toBe(emp.id);
    expect(row.employeeDept).toBe("PV部门"); // 以员工现有部门为准
    expect(row.willCreateEmployee).toBe(false);
    expect(unwrap(result).assignableCount).toBe(1);
  });

  it("姓名不存在但填了已存在的部门：标记将自动创建员工", async () => {
    const { tpl } = await setupCategory("NE");
    await addDepartment("NE部门");
    await addAsset(tpl.id, "NE-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["新人", "NE部门", "NE-0001"]]),
    });

    const row = unwrap(result).rows[0];
    expect(row.ok).toBe(true);
    expect(row.willCreateEmployee).toBe(true);
    expect(row.willCreateDepartment).toBe(false);
    expect(row.employeeDept).toBe("NE部门");
  });

  it("姓名与部门都不存在：标记将同时自动创建部门与员工", async () => {
    const { tpl } = await setupCategory("ND");
    await addAsset(tpl.id, "ND-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["新人", "全新部门", "ND-0001"]]),
    });

    const row = unwrap(result).rows[0];
    expect(row.ok).toBe(true);
    expect(row.willCreateEmployee).toBe(true);
    expect(row.willCreateDepartment).toBe(true);
  });

  it("姓名不存在且未填部门：不可分配", async () => {
    const { tpl } = await setupCategory("NX");
    await addAsset(tpl.id, "NX-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["新人", "", "NX-0001"]]),
    });

    expect(unwrap(result).assignableCount).toBe(0);
    expect(unwrap(result).rows[0].reason).toContain("部门");
  });

  it("一行内多个设备编号列都绑定到该行姓名", async () => {
    const { tpl } = await setupCategory("WD");
    const dept = await addDepartment("WD部门");
    await addEmployee("张三", dept.id, "WD01");
    await addAsset(tpl.id, "WD-0001");
    await addAsset(tpl.id, "WD-0002");

    const result = await previewAllocationImport({
      buffer: gridBuffer([
        ["姓名", "部门", "设备编号01", "设备编号02"],
        ["张三", "WD部门", "WD-0001", "WD-0002"],
      ]),
    });

    const { rows, assignableCount } = unwrap(result);
    expect(rows).toHaveLength(2);
    expect(assignableCount).toBe(2);
    expect(rows.map((r) => r.assetNo).sort()).toEqual(["WD-0001", "WD-0002"]);
    expect(rows.every((r) => r.employeeName === "张三")).toBe(true);
  });

  it("存在同名员工时视为歧义要求人工确认", async () => {
    const { tpl } = await setupCategory("PD");
    const dept = await addDepartment("PD部门");
    await addEmployee("王伟", dept.id, "PD01");
    await addEmployee("王伟", dept.id, "PD02");
    await addAsset(tpl.id, "PD-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["王伟", "", "PD-0001"]]),
    });

    expect(unwrap(result).assignableCount).toBe(0);
    expect(unwrap(result).rows[0].reason).toContain("同名");
  });

  it("设备编号不存在时判为不可分配", async () => {
    const { tpl } = await setupCategory("PN");
    await addAsset(tpl.id, "PN-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["张三", "PN部门", "GHOST-9999"]]),
    });

    expect(unwrap(result).assignableCount).toBe(0);
    expect(unwrap(result).rows[0].reason).toContain("未找到该设备编号");
  });

  it("设备状态非闲置/库存时判为不可分配", async () => {
    const { tpl } = await setupCategory("PS");
    const dept = await addDepartment("PS部门");
    const emp = await addEmployee("张三", dept.id, "PS01");
    await addAsset(tpl.id, "PS-0001", { status: "IN_USE", employeeId: emp.id });

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["张三", "PS部门", "PS-0001"]]),
    });

    expect(unwrap(result).assignableCount).toBe(0);
    expect(unwrap(result).rows[0].reason).toContain("不可分配");
  });

  it("同一设备编号在清单里重复出现时判为不可分配", async () => {
    const { tpl } = await setupCategory("PR");
    const dept = await addDepartment("PR部门");
    await addEmployee("张三", dept.id, "PR01");
    await addAsset(tpl.id, "PR-0001");

    const result = await previewAllocationImport({
      buffer: gridBuffer([
        HEADER,
        ["张三", "PR部门", "PR-0001", "", "", ""],
        ["张三", "PR部门", "PR-0001", "", "", ""],
      ]),
    });

    const { rows, assignableCount } = unwrap(result);
    expect(assignableCount).toBe(1);
    expect(rows[1].ok).toBe(false);
    expect(rows[1].reason).toContain("重复出现");
  });

  it("唯一分类下员工已持有时判为冲突（与落库同一 planAllocation）", async () => {
    const { tpl } = await setupCategory("UQ", true);
    const dept = await addDepartment("UQ部门");
    const emp = await addEmployee("张三", dept.id, "UQ01");
    await addAsset(tpl.id, "UQ-0001", { status: "IN_USE", employeeId: emp.id });
    await addAsset(tpl.id, "UQ-0002");

    const result = await previewAllocationImport({
      buffer: gridBuffer([HEADER, ["张三", "UQ部门", "UQ-0002"]]),
    });

    const row = unwrap(result).rows[0];
    expect(row.employeeId).toBe(emp.id);
    expect(row.ok).toBe(false);
    expect(row.reason).toContain("已持有");
  });
});

describe("确认分配 confirmAllocationImport", () => {
  beforeEach(() => setTestUser({ id: 1, username: "admin" }));
  afterEach(() => setTestUser(null));

  it("员工已存在：直接落库并写生命周期日志与系统日志", async () => {
    const { tpl } = await setupCategory("CF");
    const dept = await addDepartment("CF部门");
    const emp = await addEmployee("张三", dept.id, "CF01");
    const asset = await addAsset(tpl.id, "CF-0001");

    const result = await confirmAllocationImport({
      items: [{ employeeName: "张三", departmentName: "CF部门", assetId: asset.id }],
    });

    expect(result.success).toBe(true);
    const data = unwrap(result);
    expect(data.allocatedCount).toBe(1);
    expect(data.createdEmployees).toBe(0);
    expect(data.createdDepartments).toBe(0);

    const after = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(after?.status).toBe("IN_USE");
    expect(after?.employeeId).toBe(emp.id);

    const lifecycle = await prisma.lifecycleLog.findMany({ where: { assetId: asset.id } });
    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0].action).toBe("ALLOCATED");
    expect(lifecycle[0].employeeId).toBe(emp.id);
    expect(lifecycle[0].remark).toBe("Excel 批量分配");

    const sysLogs = await prisma.systemLog.findMany({ where: { module: "分配" } });
    expect(sysLogs).toHaveLength(1);
    expect(sysLogs[0].detail).toContain("CF-0001");
    expect(sysLogs[0].detail).toContain("张三");
  });

  it("姓名与部门都不存在：先自动创建部门与员工，再完成分配", async () => {
    const { tpl } = await setupCategory("AC");
    const asset = await addAsset(tpl.id, "AC-0001");

    const result = await confirmAllocationImport({
      items: [{ employeeName: "新人", departmentName: "全新部门", assetId: asset.id }],
    });

    expect(result.success).toBe(true);
    const data = unwrap(result);
    expect(data.allocatedCount).toBe(1);
    expect(data.createdDepartments).toBe(1);
    expect(data.createdEmployees).toBe(1);

    const dept = await prisma.department.findUnique({ where: { name: "全新部门" } });
    expect(dept).not.toBeNull();
    const emp = await prisma.employee.findFirst({ where: { name: "新人" } });
    expect(emp).not.toBeNull();
    expect(emp?.departmentId).toBe(dept!.id);
    expect(emp?.employeeNo).toMatch(/^EMP\d{4}$/);

    const after = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(after?.status).toBe("IN_USE");
    expect(after?.employeeId).toBe(emp!.id);
  });

  it("空提交返回错误", async () => {
    const result = await confirmAllocationImport({ items: [] });
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("没有可分配的数据");
  });
});

describe("端到端模拟：主管回填的清单（正确行 + 错误编号行混合）", () => {
  beforeEach(() => setTestUser({ id: 1, username: "admin" }));
  afterEach(() => setTestUser(null));

  it("正确行照常分配；错误行逐条标出原因、被跳过，并可导出错误明细", async () => {
    const { tpl } = await setupCategory("E2E");
    const dept = await addDepartment("E2E部门");
    const zhangsan = await addEmployee("张三", dept.id, "E2E01");

    await addAsset(tpl.id, "E2E-A1"); // 闲置 → 可分
    await addAsset(tpl.id, "E2E-A2", { status: "IN_STOCK" }); // 库存 → 可分
    await addAsset(tpl.id, "E2E-A4"); // 闲置 → 可分
    await addAsset(tpl.id, "E2E-A3", { status: "IN_USE", employeeId: zhangsan.id }); // 在用 → 不可分

    // 主管回填：一行一个人，编号横向铺开；故意混入写错的编号与漏填的姓名
    const buffer = gridBuffer([
      ["姓名", "部门", "设备编号01", "设备编号02", "设备编号03"],
      ["张三", "E2E部门", "E2E-A1", "E2E-A2", "GHOST-9999"], // 第 3 个编号写错
      ["新人甲", "E2E部门", "E2E-A4", "", ""], // 姓名不存在 → 自动建员工
      ["", "E2E部门", "E2E-A3", "", ""], // 漏填姓名 → 错误
    ]);

    // ① 预览：正确行可分配，错误行逐条标出
    const preview = await previewAllocationImport({ buffer });
    expect(preview.success).toBe(true);
    const { rows, assignableCount } = unwrap(preview);

    expect(rows).toHaveLength(5); // 3 + 1 + 1
    expect(assignableCount).toBe(3);
    expect(
      rows
        .filter((r) => r.ok)
        .map((r) => r.assetNo)
        .sort()
    ).toEqual(["E2E-A1", "E2E-A2", "E2E-A4"]);

    const byAssetNo = new Map(rows.map((r) => [r.assetNo, r]));
    // 写错的编号：标记「哪个错」
    expect(byAssetNo.get("GHOST-9999")?.ok).toBe(false);
    expect(byAssetNo.get("GHOST-9999")?.reason).toContain("未找到该设备编号");
    // 漏填姓名
    expect(byAssetNo.get("E2E-A3")?.ok).toBe(false);
    expect(byAssetNo.get("E2E-A3")?.reason).toContain("未填写姓名");
    // 姓名不存在 → 仅标记「将自动创建员工」，部门已存在
    const newcomer = byAssetNo.get("E2E-A4")!;
    expect(newcomer.willCreateEmployee).toBe(true);
    expect(newcomer.willCreateDepartment).toBe(false);

    // ② 错误明细可导出，供主管修正后重新导入
    const errExport = await exportAllocationErrors({
      rows: rows
        .filter((r) => !r.ok)
        .map((r) => ({
          employeeName: r.employeeName,
          departmentName: r.departmentName,
          assetNo: r.assetNo,
          reason: r.reason ?? "",
        })),
    });
    const errData = unwrap(errExport);
    expect(errData.count).toBe(2);
    const errGrid = XLSX.utils.sheet_to_json<string[]>(
      XLSX.read(Buffer.from(errData.buffer)).Sheets["错误明细"],
      { header: 1 }
    );
    expect(errGrid[1]).toEqual(["张三", "E2E部门", "GHOST-9999", "未找到该设备编号"]);

    // ③ 确认：只提交可分配行，错误行被跳过
    const okRows = rows.filter((r) => r.ok);
    const confirm = await confirmAllocationImport({
      items: okRows.map((r) => ({
        employeeName: r.employeeName,
        departmentName: r.departmentName || null,
        assetId: r.assetId!,
      })),
    });
    expect(confirm.success).toBe(true);
    const data = unwrap(confirm);
    expect(data.allocatedCount).toBe(3);
    expect(data.createdEmployees).toBe(1); // 新人甲
    expect(data.createdDepartments).toBe(0); // 部门已存在

    // ④ 落库结果：正确的三台都归到人；错误的两台毫发无损
    const a1 = await prisma.asset.findFirst({ where: { assetNo: "E2E-A1" } });
    const a2 = await prisma.asset.findFirst({ where: { assetNo: "E2E-A2" } });
    expect(a1?.employeeId).toBe(zhangsan.id);
    expect(a2?.employeeId).toBe(zhangsan.id);
    expect(a1?.status).toBe("IN_USE");

    const a3 = await prisma.asset.findFirst({ where: { assetNo: "E2E-A3" } });
    expect(a3?.status).toBe("IN_USE");
    expect(a3?.employeeId).toBe(zhangsan.id); // 仍是原使用人，没被改
    expect(await prisma.asset.findFirst({ where: { assetNo: "GHOST-9999" } })).toBeNull();

    const newcomerEmp = await prisma.employee.findFirst({ where: { name: "新人甲" } });
    expect(newcomerEmp).not.toBeNull();
    expect(newcomerEmp?.employeeNo).toMatch(/^EMP\d{4}$/);
    const a4 = await prisma.asset.findFirst({ where: { assetNo: "E2E-A4" } });
    expect(a4?.employeeId).toBe(newcomerEmp!.id);
  });
});