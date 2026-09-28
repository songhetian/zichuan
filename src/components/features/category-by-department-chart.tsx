"use client";

import { useState } from "react";
import ReactECharts from "echarts-for-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  buildCategoryByDepartmentOption,
  type CategoryByDepartmentData,
} from "@/lib/category-by-department";
import { useThemeColors } from "@/lib/use-theme-colors";

const ALL = "all";

export function CategoryByDepartmentChart({
  data,
}: {
  data: CategoryByDepartmentData;
}) {
  const [category, setCategory] = useState<string>(ALL);
  const colors = useThemeColors();

  if (data.departments.length === 0 || data.categories.length === 0) {
    return (
      <div className="h-[340px] flex items-center justify-center text-muted-foreground text-sm">
        暂无数据
      </div>
    );
  }

  const categoryTotal = (name: string): number => {
    const idx = data.categories.indexOf(name);
    return idx < 0 ? 0 : data.matrix[idx].reduce((sum, n) => sum + n, 0);
  };

  const option = buildCategoryByDepartmentOption(
    data,
    category === ALL ? undefined : category,
    { label: colors.muted, axisLine: colors.border, splitLine: colors.border }
  );

  const selectedTotal =
    category === ALL ? data.categories.reduce((sum, c) => sum + categoryTotal(c), 0) : categoryTotal(category);

  return (
    <div className="space-y-3">
      {/* 顶部摘要 + 分类筛选：一眼掌握规模，再按需钻取到单一分类 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <div>
            <span className="text-xs text-muted-foreground">部门</span>
            <span className="ml-1.5 text-base font-bold tabular-nums leading-none">
              {data.departments.length}
            </span>
            <span className="ml-0.5 text-xs text-muted-foreground">个</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">分类</span>
            <span className="ml-1.5 text-base font-bold tabular-nums leading-none">
              {data.categories.length}
            </span>
            <span className="ml-0.5 text-xs text-muted-foreground">类</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">设备</span>
            <span className="ml-1.5 text-base font-bold tabular-nums leading-none text-primary">
              {selectedTotal}
            </span>
            <span className="ml-0.5 text-xs text-muted-foreground">台</span>
          </div>
        </div>
        <SearchableSelect
          value={category}
          onValueChange={(v) => setCategory(v || ALL)}
          placeholder="全部分类"
          triggerClassName="w-[150px]"
          options={[
            { value: ALL, label: "全部分类" },
            ...data.categories.map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>
      <ReactECharts option={option} style={{ height: 320 }} notMerge />
    </div>
  );
}
