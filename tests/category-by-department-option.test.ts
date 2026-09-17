import { describe, it, expect } from "vitest";
import { buildCategoryByDepartmentOption } from "@/lib/category-by-department";

const data = {
  departments: ["技术部", "财务部"],
  categories: ["笔记本电脑", "显示器"],
  matrix: [
    [2, 1],
    [1, 0],
  ],
};

describe("buildCategoryByDepartmentOption", () => {
  it("x 轴为部门，每个分类一条堆叠 series，数据对应矩阵行", () => {
    const option = buildCategoryByDepartmentOption(data) as any;

    expect(option.xAxis.data).toEqual(["技术部", "财务部"]);
    expect(option.legend.data).toEqual(["笔记本电脑", "显示器"]);
    expect(option.series).toHaveLength(2);

    option.series.forEach((s: any, i: number) => {
      expect(s.type).toBe("bar");
      expect(s.stack).toBe("total");
      expect(s.name).toBe(data.categories[i]);
      expect(s.data).toEqual(data.matrix[i]);
    });
  });

  it("空数据返回空 series 且不抛错", () => {
    const option = buildCategoryByDepartmentOption({
      departments: [],
      categories: [],
      matrix: [],
    }) as any;
    expect(option.series).toEqual([]);
    expect(option.xAxis.data).toEqual([]);
  });

  it("单分类时仍生成一条 series", () => {
    const option = buildCategoryByDepartmentOption({
      departments: ["技术部"],
      categories: ["笔记本电脑"],
      matrix: [[3]],
    }) as any;
    expect(option.series).toHaveLength(1);
    expect(option.series[0].data).toEqual([3]);
  });

  it("传入分类参数时仅生成该分类的单系列", () => {
    const option = buildCategoryByDepartmentOption(data, "显示器") as any;
    expect(option.series).toHaveLength(1);
    expect(option.series[0].name).toBe("显示器");
    expect(option.series[0].data).toEqual([1, 0]); // 矩阵中「显示器」行
    expect(option.xAxis.data).toEqual(["技术部", "财务部"]);
  });

  it("传入不存在的分类时回退为全部分类", () => {
    const option = buildCategoryByDepartmentOption(data, "不存在的分类") as any;
    expect(option.series).toHaveLength(2);
  });
});
