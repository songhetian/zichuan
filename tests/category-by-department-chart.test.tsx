import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom 无 canvas，mock echarts-for-react 仅捕获传入的 option
vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));

import { CategoryByDepartmentChart } from "@/components/features/category-by-department-chart";

const data = {
  departments: ["技术部", "财务部"],
  categories: ["笔记本电脑", "显示器"],
  matrix: [
    [2, 1],
    [1, 0],
  ],
};

describe("CategoryByDepartmentChart", () => {
  it("有数据时渲染 echarts 并传入堆叠柱状图 option", () => {
    render(<CategoryByDepartmentChart data={data} />);

    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option")!);
    expect(option.xAxis.data).toEqual(["技术部", "财务部"]);
    expect(option.series).toHaveLength(2);
    expect(option.series[0].stack).toBe("total");
    expect(option.series[0].type).toBe("bar");
    expect(option.series[0].data).toEqual([2, 1]);
  });

  it("空数据时显示「暂无数据」而非图表", () => {
    render(
      <CategoryByDepartmentChart data={{ departments: [], categories: [], matrix: [] }} />
    );
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(screen.queryByTestId("echarts")).toBeNull();
  });

  it("提供分类筛选器，选择某分类后 option 仅含该分类系列", async () => {
    const user = userEvent.setup();
    render(<CategoryByDepartmentChart data={data} />);

    // 打开分类筛选下拉
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("显示器"));

    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option")!);
    expect(option.series).toHaveLength(1);
    expect(option.series[0].name).toBe("显示器");
    expect(option.series[0].data).toEqual([1, 0]);
  });
});
