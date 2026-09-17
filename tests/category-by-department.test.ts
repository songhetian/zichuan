import { describe, it, expect } from "vitest";
import { buildCategoryByDepartmentData } from "@/lib/category-by-department";

describe("buildCategoryByDepartmentData", () => {
  it("将设备按 部门 × 分类 聚合成矩阵", () => {
    const assets = [
      { categoryName: "笔记本电脑", departmentName: "技术部" },
      { categoryName: "笔记本电脑", departmentName: "技术部" },
      { categoryName: "显示器", departmentName: "技术部" },
      { categoryName: "笔记本电脑", departmentName: "财务部" },
      { categoryName: "显示器", departmentName: null }, // 未分配部门
      { categoryName: null, departmentName: "技术部" }, // 未分类
    ];

    const result = buildCategoryByDepartmentData(assets);

    expect(result.departments).toEqual(["技术部", "财务部", "未分配部门"]);
    expect(result.categories).toEqual(["笔记本电脑", "显示器", "未分类"]);
    // matrix[categoryIndex][departmentIndex]
    expect(result.matrix).toEqual([
      [2, 1, 0], // 笔记本电脑
      [1, 0, 1], // 显示器
      [1, 0, 0], // 未分类
    ]);
  });

  it("部门与分类按首次出现顺序稳定排列", () => {
    const assets = [
      { categoryName: "显示器", departmentName: "财务部" },
      { categoryName: "笔记本电脑", departmentName: "技术部" },
    ];
    const result = buildCategoryByDepartmentData(assets);
    expect(result.departments).toEqual(["财务部", "技术部"]);
    expect(result.categories).toEqual(["显示器", "笔记本电脑"]);
  });

  it("空输入返回空结构", () => {
    const result = buildCategoryByDepartmentData([]);
    expect(result).toEqual({ departments: [], categories: [], matrix: [] });
  });
});
