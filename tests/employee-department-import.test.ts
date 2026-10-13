/**
 * 「批量导入员工」的服务端行为（importEmployeesToDepartment）。
 *
 * seam：员工管理页「批量导入员工」弹窗调用的公开 action —— 先选部门，再上传
 * 只含姓名（必填）/ 电话 / 邮箱 / 工号（可选）的 Excel，整批创建到该部门。
 *
 * 规则：工号留空自动生成 EMP0001 形式；工号重复报错跳过该行；同部门同名仅告警。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { importEmployeesToDepartment } from "@/actions/excel.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import * as XLSX from "xlsx";

function sheetBuffer(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "员工");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function addDepartment(name: string) {
  return prisma.department.create({ data: { name } });
}

describe("批量导入员工 importEmployeesToDepartment", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("整批创建到所选部门，并写入电话/邮箱/工号", async () => {
    const dept = await addDepartment("技术部");

    const result = await importEmployeesToDepartment({
      departmentId: dept.id,
      buffer: sheetBuffer([
        { 姓名: "张三", 工号: "E001", 电话: "13800138000", 邮箱: "zhangsan@test.com" },
        { 姓名: "李四", 工号: "E002", 电话: "", 邮箱: "" },
      ]),
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(2);
    expect(unwrap(result).errors).toHaveLength(0);

    const emps = await prisma.employee.findMany({ orderBy: { employeeNo: "asc" } });
    expect(emps).toHaveLength(2);
    expect(emps[0]).toMatchObject({
      employeeNo: "E001",
      name: "张三",
      departmentId: dept.id,
      phone: "13800138000",
      email: "zhangsan@test.com",
    });
    expect(emps[1].email).toBeNull();
  });

  it("工号留空时自动生成 EMP0001 形式", async () => {
    const dept = await addDepartment("技术部");

    const result = await importEmployeesToDepartment({
      departmentId: dept.id,
      buffer: sheetBuffer([{ 姓名: "张三" }, { 姓名: "李四" }]),
    });

    expect(unwrap(result).importedCount).toBe(2);
    const emps = await prisma.employee.findMany({ orderBy: { employeeNo: "asc" } });
    expect(emps.map((e) => e.employeeNo)).toEqual(["EMP0001", "EMP0002"]);
  });

  it("工号重复的行被跳过，其余照常导入", async () => {
    const dept = await addDepartment("技术部");
    await prisma.employee.create({
      data: { employeeNo: "E001", name: "已有员工", departmentId: dept.id },
    });

    const result = await importEmployeesToDepartment({
      departmentId: dept.id,
      buffer: sheetBuffer([
        { 姓名: "重复", 工号: "E001" },
        { 姓名: "新员工", 工号: "E002" },
      ]),
    });

    expect(result.success).toBe(true);
    expect(unwrap(result).importedCount).toBe(1);
    expect(unwrap(result).errors).toHaveLength(1);
    expect(unwrap(result).errors[0]).toContain("E001");
    expect(unwrap(result).errors[0]).toContain("已存在");
  });

  it("同部门同名给出警告但仍创建", async () => {
    const dept = await addDepartment("技术部");
    await prisma.employee.create({
      data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
    });

    const result = await importEmployeesToDepartment({
      departmentId: dept.id,
      buffer: sheetBuffer([{ 姓名: "张三" }]),
    });

    expect(unwrap(result).importedCount).toBe(1);
    expect(unwrap(result).warnings).toHaveLength(1);
    expect(unwrap(result).warnings[0]).toContain("张三");
    // 允许创建：同部门出现两条同名记录
    const named = await prisma.employee.findMany({ where: { name: "张三" } });
    expect(named).toHaveLength(2);
  });

  it("姓名为空的行被跳过并报错", async () => {
    const dept = await addDepartment("技术部");

    const result = await importEmployeesToDepartment({
      departmentId: dept.id,
      buffer: sheetBuffer([{ 姓名: "", 工号: "E001" }, { 姓名: "张三" }]),
    });

    expect(unwrap(result).importedCount).toBe(1);
    expect(unwrap(result).errors).toHaveLength(1);
    expect(unwrap(result).errors[0]).toContain("姓名");
  });

  it("部门不存在时返回失败", async () => {
    const result = await importEmployeesToDepartment({
      departmentId: 999999,
      buffer: sheetBuffer([{ 姓名: "张三" }]),
    });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("部门不存在");
  });

  it("Excel 没有数据时返回失败", async () => {
    const dept = await addDepartment("技术部");

    // 空表：只有表头，没有数据行
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["姓名", "电话", "邮箱", "工号"]]);
    XLSX.utils.book_append_sheet(wb, ws, "员工");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    const result = await importEmployeesToDepartment({ departmentId: dept.id, buffer });
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("没有数据");
  });

  it("导入后写入系统日志", async () => {
    const dept = await addDepartment("财务部");

    await importEmployeesToDepartment({
      departmentId: dept.id,
      buffer: sheetBuffer([{ 姓名: "张三" }, { 姓名: "李四" }]),
    });

    const logs = await prisma.systemLog.findMany({ where: { module: "员工" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("批量导入员工");
    expect(logs[0].detail).toContain("财务部");
    expect(logs[0].operator).toBe("admin");
  });
});