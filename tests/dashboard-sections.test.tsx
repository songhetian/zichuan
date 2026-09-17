/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardClient } from "@/app/(main)/dashboard/dashboard-client";

// jsdom 无 canvas：mock echarts，断言仅关注模块切换行为
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
  "设备状态分布",
  "各部门设备分类分布",
  "最近操作",
];

// 已移除的模块：切换条中不应再出现
const REMOVED_MODULE_BUTTONS = ["分类分布", "配件库存概览（Top 10）", "生命周期趋势（近6个月）"];

afterEach(() => {
  cleanup();
});

describe("DashboardClient 模块切换", () => {
  it("默认只显示「待办任务」，其余模块不渲染", () => {
    render(<DashboardClient data={data as any} />);

    expect(screen.getByRole("heading", { name: "待办任务" })).toBeInTheDocument();
    for (const heading of MODULE_HEADINGS) {
      expect(screen.queryByRole("heading", { name: heading })).toBeNull();
    }
  });

  it("点击「各部门设备分类分布」只显示该模块", async () => {
    const user = userEvent.setup();
    render(<DashboardClient data={data as any} />);

    await user.click(screen.getByRole("button", { name: "各部门设备分类分布" }));

    expect(screen.getByRole("heading", { name: "各部门设备分类分布" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "待办任务" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "分类分布" })).toBeNull();
  });

  it("已移除的模块（分类分布、配件库存概览）不再出现在切换条中", () => {
    render(<DashboardClient data={data as any} />);

    for (const button of REMOVED_MODULE_BUTTONS) {
      expect(screen.queryByRole("button", { name: button })).toBeNull();
    }
  });

  it("依次切换模块，每次只保留一个", async () => {
    const user = userEvent.setup();
    render(<DashboardClient data={data as any} />);

    await user.click(screen.getByRole("button", { name: "设备状态分布" }));
    expect(screen.getByRole("heading", { name: "设备状态分布" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "待办任务" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "最近操作" }));
    expect(screen.getByRole("heading", { name: "最近操作" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "设备状态分布" })).toBeNull();
  });
});
