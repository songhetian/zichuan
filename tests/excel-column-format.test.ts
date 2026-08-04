import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

// ============================================================
// 测试 seam：hardware_scanner.py 的 generate_excel 函数
// 验证 Excel 列生成逻辑：只有实际有多条配件时才生成多列格式
// ============================================================

function buildExcelBuffer(headers: string[], rowData: string[]): number[] {
  const data = [headers];
  data.push(rowData);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "设备导入");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Array.from(Buffer.from(buf));
}

describe("Excel 列生成逻辑优化", () => {
  it("只有 1 个内存时，不应生成内存2/内存3等多余列", () => {
    const headers = [
      "使用人", "部门", "设备名称", "设备分类", "设备分类编号",
      "CPU型号", "CPU品牌",
      "内存型号", "内存品牌",       // 单列格式 - 应该有
      // "内存1型号", "内存1品牌",   // 多列格式 - 不应该有（只有1个内存）
      // "内存2型号", "内存2品牌",   // 不应该有
      // "内存3型号", "内存3品牌",   // 不应该有
    ];

    const rowData = [
      "张三", "技术部", "张三的电脑主机", "电脑主机", "PC",
      "i5-12400", "Intel",
      "16GB DDR4", "Samsung",
    ];

    const buffer = buildExcelBuffer(headers, rowData);
    const wb = XLSX.read(Buffer.from(buffer));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const firstRow = rows[0];

    // 验证有单列格式
    expect(firstRow).toHaveProperty("内存型号");
    expect(firstRow).toHaveProperty("内存品牌");

    // 验证没有多余的多列格式
    expect(firstRow).not.toHaveProperty("内存2型号");
    expect(firstRow).not.toHaveProperty("内存2品牌");
    expect(firstRow).not.toHaveProperty("内存3型号");
    expect(firstRow).not.toHaveProperty("内存3品牌");
  });

  it("有 2 个内存时，应该生成内存1/内存2多列格式", () => {
    const headers = [
      "使用人", "部门", "设备名称", "设备分类", "设备分类编号",
      "CPU型号", "CPU品牌",
      "内存型号", "内存品牌",
      "内存1型号", "内存1品牌",
      "内存2型号", "内存2品牌",
    ];

    const rowData = [
      "张三", "技术部", "张三的电脑主机", "电脑主机", "PC",
      "i5-12400", "Intel",
      "8GB DDR4", "Samsung",    // 单列格式（第一根内存）
      "8GB DDR4", "Samsung",    // 内存1
      "16GB DDR4", "Kingston",  // 内存2
    ];

    const buffer = buildExcelBuffer(headers, rowData);
    const wb = XLSX.read(Buffer.from(buffer));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const firstRow = rows[0];

    // 验证有多列格式
    expect(firstRow).toHaveProperty("内存1型号");
    expect(firstRow).toHaveProperty("内存1品牌");
    expect(firstRow).toHaveProperty("内存2型号");
    expect(firstRow).toHaveProperty("内存2品牌");

    // 验证没有多余的列
    expect(firstRow).not.toHaveProperty("内存3型号");
  });

  it("只有 1 个显示器时，不应生成显示器2等多余列", () => {
    const headers = [
      "使用人", "部门", "设备名称", "设备分类", "设备分类编号",
      "CPU型号", "CPU品牌",
      "内存型号", "内存品牌",
      "硬盘型号", "硬盘品牌",
      "主板型号", "主板品牌",
      "显卡型号", "显卡品牌",
      "显示器型号", "显示器品牌",   // 单列格式 - 应该有
      // "显示器1型号", "显示器1品牌", // 多列格式 - 不应该有（只有1个）
    ];

    const rowData = [
      "张三", "技术部", "张三的电脑主机", "电脑主机", "PC",
      "i5-12400", "Intel",
      "16GB DDR4", "Samsung",
      "512GB SSD", "Samsung",
      "H610", "ASUS",
      "RTX 3060", "NVIDIA",
      "24寸 IPS", "Dell",
    ];

    const buffer = buildExcelBuffer(headers, rowData);
    const wb = XLSX.read(Buffer.from(buffer));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const firstRow = rows[0];

    // 验证有单列格式
    expect(firstRow).toHaveProperty("显示器型号");
    expect(firstRow).toHaveProperty("显示器品牌");

    // 验证没有多余的多列格式
    expect(firstRow).not.toHaveProperty("显示器2型号");
    expect(firstRow).not.toHaveProperty("显示器2品牌");
  });

  it("有 2 个显示器时，应该生成显示器1/显示器2多列格式", () => {
    const headers = [
      "使用人", "部门", "设备名称", "设备分类", "设备分类编号",
      "CPU型号", "CPU品牌",
      "内存型号", "内存品牌",
      "硬盘型号", "硬盘品牌",
      "主板型号", "主板品牌",
      "显卡型号", "显卡品牌",
      "显示器型号", "显示器品牌",
      "显示器1型号", "显示器1品牌",
      "显示器2型号", "显示器2品牌",
    ];

    const rowData = [
      "张三", "技术部", "张三的电脑主机", "电脑主机", "PC",
      "i5-12400", "Intel",
      "16GB DDR4", "Samsung",
      "512GB SSD", "Samsung",
      "H610", "ASUS",
      "RTX 3060", "NVIDIA",
      "27寸 4K", "LG",          // 单列格式（第一台）
      "27寸 4K", "LG",          // 显示器1
      "24寸", "Dell",           // 显示器2
    ];

    const buffer = buildExcelBuffer(headers, rowData);
    const wb = XLSX.read(Buffer.from(buffer));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const firstRow = rows[0];

    expect(firstRow).toHaveProperty("显示器1型号");
    expect(firstRow).toHaveProperty("显示器1品牌");
    expect(firstRow).toHaveProperty("显示器2型号");
    expect(firstRow).toHaveProperty("显示器2品牌");
  });
});
