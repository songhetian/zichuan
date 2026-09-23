/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DashboardClient } from "@/app/(main)/dashboard/dashboard-client";

// jsdom 无 canvas：mock echarts，断言仅关注概览模块的同屏展示
vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="mock-chart" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const data = {
  total: 10,
  byStatus: { IDLE: 2, IN_USE: 5, IN_MAINTENANCE: 1, SCRAPPED: 2, IN_STOCK: 0 },
  categoryByDepartment: { departments: ["技术部"], categories: ["笔记本电脑"], matrix: [[3]] },
  recentLogs: [
    { id: 1, action: "ALLOCATED", assetNo: "DN-0001", operator: "admin", createdAt: new Date() },
  ],
  pendingTasks: [{ type: "allocate", title: "待分配设备", description: "有闲置设备待分配给员工", count: 2 }],
};

const MODULE_HEADINGS = [
  "待办任务",
  "设备状态分布",
  "各部门设备分类分布",
  "最近操作",
];

// 已移除的模块：清空待办时也不应出现历史按钮
const REMOVED_MODULE_BUTTONS = ["分类分布", "配件库存概览（Top 10）", "生命周期趋势（近6个月）"];

afterEach(() => {
  cleanup();
});

describe("DashboardClient 概览同屏展示", () => {
  it("四个导航模块同时展示，无需 tab 切换", () => {
    render(<DashboardClient data={data as any} />);

    for (const heading of MODULE_HEADINGS) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("不再存在模块切换条", () => {
    render(<DashboardClient data={data as any} />);

    expect(screen.queryByTestId("section-switcher")).toBeNull();
    expect(screen.queryByRole("button", { name: "设备状态分布" })).toBeNull();
    expect(screen.queryByRole("button", { name: "最近操作" })).toBeNull();
  });

  it("已移除的模块不再出现", () => {
    render(<DashboardClient data={data as any} />);

    for (const button of REMOVED_MODULE_BUTTONS) {
      expect(screen.queryByRole("button", { name: button })).toBeNull();
    }
  });
});