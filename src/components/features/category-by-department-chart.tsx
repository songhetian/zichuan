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

  const option = buildCategoryByDepartmentOption(
    data,
    category === ALL ? undefined : category,
    { label: colors.muted, axisLine: colors.border, splitLine: colors.border }
  );

  return (
    <div className="space-y-2">
      {/* 分类筛选：想看某一分类（如电脑主机）直接选择，无需在图例中逐个点掉 */}
      <div className="flex justify-end">
        <SearchableSelect
          value={category}
          onValueChange={(v) => setCategory(v || ALL)}
          placeholder="全部分类"
          triggerClassName="w-[160px]"
          options={[
            { value: ALL, label: "全部分类" },
            ...data.categories.map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>
      <ReactECharts option={option} style={{ height: 340 }} notMerge />
    </div>
  );
}
