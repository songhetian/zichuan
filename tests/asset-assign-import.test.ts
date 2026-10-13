import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseAssignSheet,
  buildAssignIssuesWorkbook,
  type AssignImportIssue,
} from "@/lib/asset-assign-import";

/**
 * 「批量分配设备」Excel 导入 —— 纯解析层（不连库）。
 *
 * seam：
 *   parseAssignSheet(sheet)        行数组 → { people, issues }
 *   buildAssignIssuesWorkbook(issues)  错误清单 → 可下载的错误行 Excel（buffer）
 *
 * 模板形状：姓名 | 部门 | 设备编号01 | 设备编号02 | ...
 *   —— 每行一个人，后面若干列是该人要分配到的设备编号（值）。
 */
describe("parseAssignSheet", () => {
  it("排除表头行，按人聚合多列设备编号，并忽略无关列（配置摘要/状态）", () => {
    const sheet = [
      // 表头被原样读进来的情形：必须被识别并跳过
      { 姓名: "姓名", 部门: "部门", 设备编号01: "设备编号01", 设备编号02: "设备编号02" },
      {
        姓名: "张三",
        部门: "技术部",
        设备编号01: "DN-0001",
        设备编号02: "DN-0002",
        配置摘要: "i7/16G",
        状态: "闲置",
      },
      { 姓名: "李四", 部门: "市场部", 设备编号01: "DN-0003" },
    ];

    const result = parseAssignSheet(sheet);

    expect(result.issues).toEqual([]);
    expect(result.people).toEqual([
      { rowNo: 3, name: "张三", department: "技术部", assetNos: ["DN-0001", "DN-0002"] },
      { rowNo: 4, name: "李四", department: "市场部", assetNos: ["DN-0003"] },
    ]);
  });

  it("姓名为空但有设备编号 → 标记错误（无法确定分配对象）", () => {
    const sheet = [{ 姓名: "", 部门: "技术部", 设备编号01: "DN-9999" }];

    const result = parseAssignSheet(sheet);

    expect(result.people).toEqual([]);
    expect(result.issues).toEqual([
      {
        rowNo: 2,
        name: "",
        department: "技术部",
        assetNo: "DN-9999",
        reason: "缺少姓名，无法确定分配对象",
      },
    ]);
  });

  it("同一编号在文件中重复出现 → 只在首次保留，后续标记错误", () => {
    const sheet = [
      { 姓名: "张三", 部门: "技术部", 设备编号01: "DN-0001" },
      { 姓名: "李四", 部门: "市场部", 设备编号01: "DN-0001" },
    ];

    const result = parseAssignSheet(sheet);

    expect(result.people).toEqual([
      { rowNo: 2, name: "张三", department: "技术部", assetNos: ["DN-0001"] },
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      rowNo: 3,
      name: "李四",
      department: "市场部",
      assetNo: "DN-0001",
    });
    expect(result.issues[0].reason).toContain("重复");
  });

  it("整行空白 / 有人无编号 → 静默忽略，不产生记录也不报错", () => {
    const sheet = [
      { 姓名: "", 部门: "", 设备编号01: "" },
      { 姓名: "王五", 部门: "行政部", 设备编号01: "" },
    ];

    const result = parseAssignSheet(sheet);

    expect(result.people).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("编号单元格为数字类型时按字符串处理并去除首尾空格", () => {
    const sheet = [{ 姓名: " 赵六 ", 部门: " 财务部 ", 设备编号01: " A-1 " }];

    const result = parseAssignSheet(sheet);

    expect(result.people).toEqual([
      { rowNo: 2, name: "赵六", department: "财务部", assetNos: ["A-1"] },
    ]);
  });
});

describe("buildAssignIssuesWorkbook", () => {
  it("把错误清单生成为可被 xlsx 解析回原数据的错误行 Excel", () => {
    const issues: AssignImportIssue[] = [
      {
        rowNo: 3,
        name: "李四",
        department: "市场部",
        assetNo: "DN-0001",
        reason: "设备编号不存在",
      },
      {
        rowNo: 4,
        name: "王五",
        department: "行政部",
        assetNo: "DN-0002",
        reason: "设备非闲置状态，不可分配",
      },
    ];

    const buf = buildAssignIssuesWorkbook(issues);
    const wb = XLSX.read(Buffer.from(buf));
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      wb.Sheets[wb.SheetNames[0]]
    );

    expect(rows).toEqual([
      { 姓名: "李四", 部门: "市场部", 设备编号: "DN-0001", 错误原因: "设备编号不存在" },
      {
        姓名: "王五",
        部门: "行政部",
        设备编号: "DN-0002",
        错误原因: "设备非闲置状态，不可分配",
      },
    ]);
  });
});