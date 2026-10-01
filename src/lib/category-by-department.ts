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

export interface CategoryChartColors {
  /** 图例 / 轴标签 / 轴名文字颜色 */
  label: string;
  /** 轴线颜色 */
  axisLine: string;
  /** 网格分割线颜色 */
  splitLine: string;
}

/**
 * 由「部门 × 分类」数据构建 ECharts 堆叠柱状图配置。
 * x 轴 = 部门；每个分类一条 series 并堆叠（stack: "total"）。
 * 传入 category 时仅生成该分类的单系列。
 *
 * `colors` 与 `palette` 用于适配亮/暗主题——**调用方应传 `useThemeColors()` 的结果**
 * （`colors` 取轴/图例文字色，`palette` 取 `categorical`）。
 * 刻意不提供默认色值：任何写死的色值都只会对其中一种主题成立（历史上这里
 * 默认的就是一套仅适配亮色的灰阶、以及一套静态 #RRGGBB 调色板），
 * 省略时交给 ECharts 自身默认。
 */
export function buildCategoryByDepartmentOption(
  data: CategoryByDepartmentData,
  category?: string,
  colors: Partial<CategoryChartColors> = {},
  palette: readonly string[] = []
): Record<string, unknown> {
  const selectedIndex = category ? data.categories.indexOf(category) : -1;

  const buildSeries = (cat: string, row: number[], index: number, isTop: boolean) => ({
    name: cat,
    type: "bar",
    stack: "total",
    barMaxWidth: 42,
    emphasis: { focus: "series" },
    itemStyle: {
      color: palette.length ? palette[index % palette.length] : undefined,
      // 仅最上层分段做圆角，堆叠柱视觉更利落
      borderRadius: isTop ? [6, 6, 0, 0] : 0,
    },
    data: row,
  });

  const series =
    selectedIndex >= 0
      ? [buildSeries(data.categories[selectedIndex], data.matrix[selectedIndex] ?? [], selectedIndex, true)]
      : data.categories.map((cat, i) => buildSeries(cat, data.matrix[i] ?? [], i, i === data.categories.length - 1));

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
      textStyle: { color: colors.label, fontSize: 12 },
    },
    grid: {
      left: "3%",
      right: "4%",
      // 为底部图例预留固定高度（px），多分类换行也不遮挡柱体
      bottom: 64,
      top: 24,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: data.departments,
      axisLabel: { color: colors.label, interval: 0, rotate: data.departments.length > 5 ? 30 : 0 },
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "设备数量",
      nameTextStyle: { color: colors.label },
      axisLabel: { color: colors.label },
      splitLine: { lineStyle: { color: colors.splitLine } },
    },
    series,
  };
}
