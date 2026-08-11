export interface CategoryDeptInput {
  categoryName?: string | null;
  departmentName?: string | null;
}

export interface CategoryByDepartmentData {
  /** 部门列表，按首次出现顺序 */
  departments: string[];
  /** 分类列表，按首次出现顺序 */
  categories: string[];
  /** matrix[categoryIndex][departmentIndex] = 该分类在该部门的设备数量 */
  matrix: number[][];
}

const UNCATEGORIZED = "未分类";
const NO_DEPARTMENT = "未分配部门";

function normalizeCategory(name?: string | null): string {
  return name && name.trim() ? name.trim() : UNCATEGORIZED;
}

function normalizeDepartment(name?: string | null): string {
  return name && name.trim() ? name.trim() : NO_DEPARTMENT;
}

/**
 * 将设备列表按「部门 × 分类」聚合成矩阵，供堆叠柱状图使用。
 * 分类/部门为空时分别归入「未分类」「未分配部门」。
 */
export function buildCategoryByDepartmentData(
  assets: CategoryDeptInput[]
): CategoryByDepartmentData {
  const deptIndex = new Map<string, number>();
  const catIndex = new Map<string, number>();
  const departments: string[] = [];
  const categories: string[] = [];
  // 稀疏计数：counts[catIndex][deptIndex]
  const counts = new Map<number, Map<number, number>>();

  for (const asset of assets) {
    const dept = normalizeDepartment(asset.departmentName);
    const cat = normalizeCategory(asset.categoryName);

    let dIdx = deptIndex.get(dept);
    if (dIdx === undefined) {
      dIdx = departments.length;
      deptIndex.set(dept, dIdx);
      departments.push(dept);
    }

    let cIdx = catIndex.get(cat);
    if (cIdx === undefined) {
      cIdx = categories.length;
      catIndex.set(cat, cIdx);
      categories.push(cat);
    }

    let row = counts.get(cIdx);
    if (!row) {
      row = new Map<number, number>();
      counts.set(cIdx, row);
    }
    row.set(dIdx, (row.get(dIdx) ?? 0) + 1);
  }

  const matrix: number[][] = categories.map((_, cIdx) => {
    const row = counts.get(cIdx) ?? new Map<number, number>();
    return departments.map((_, dIdx) => row.get(dIdx) ?? 0);
  });

  return { departments, categories, matrix };
}

const CATEGORY_PALETTE = [
  "#0d9488", // teal-600
  "#6366f1", // indigo-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#10b981", // emerald-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#3b82f6", // blue-500
];

/**
 * 由「部门 × 分类」数据构建 ECharts 堆叠柱状图配置。
 * x 轴 = 部门；每个分类一条 series 并堆叠（stack: "total"）。
 * 传入 category 时仅生成该分类的单系列，便于只看某一分类（如「电脑主机」）；
 * 传入的分类不存在则回退为全部分类。
 */
export function buildCategoryByDepartmentOption(
  data: CategoryByDepartmentData,
  category?: string
): Record<string, unknown> {
  const selectedIndex = category ? data.categories.indexOf(category) : -1;

  const buildSeries = (cat: string, row: number[], index: number) => ({
    name: cat,
    type: "bar",
    stack: "total",
    emphasis: { focus: "series" },
    itemStyle: { color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] },
    data: row,
  });

  const series =
    selectedIndex >= 0
      ? [buildSeries(data.categories[selectedIndex], data.matrix[selectedIndex] ?? [], selectedIndex)]
      : data.categories.map((cat, i) => buildSeries(cat, data.matrix[i] ?? [], i));

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: selectedIndex >= 0 ? [data.categories[selectedIndex]] : data.categories,
      bottom: "0%",
      left: "center",
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: "#6b7280", fontSize: 12 },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "12%",
      top: "6%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: data.departments,
      axisLabel: { color: "#6b7280", interval: 0, rotate: data.departments.length > 5 ? 30 : 0 },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "设备数量",
      nameTextStyle: { color: "#6b7280" },
      axisLabel: { color: "#6b7280" },
      splitLine: { lineStyle: { color: "#f3f4f6" } },
    },
    series,
  };
}
