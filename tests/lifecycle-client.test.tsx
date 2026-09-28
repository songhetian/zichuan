/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLifecycleClient } from "@/app/(main)/lifecycle/lifecycle-client";
import type { AssetLifecycleViewData } from "@/actions/asset-lifecycle.actions";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function makeInitial(): AssetLifecycleViewData {
  return {
    data: [
      {
        id: 1,
        createdAt: new Date("2026-09-01T04:00:00.000Z"),
        assetNo: "DN-0001",
        assetName: "测试主机",
        action: "SCRAPPED",
        fromStatus: "IN_USE",
        toStatus: "SCRAPPED",
        employeeName: "张三",
        departmentId: 1,
        departmentName: "技术部",
        operator: "admin",
        remark: "单位主体",
        request: {
          id: 101,
          requestNo: "AP-202609-0001",
          businessType: "ASSET_SCRAP",
          title: "报废测试主机",
          status: "EXECUTED",
          initiatorName: "王芳",
          submittedAt: new Date("2026-09-01T01:00:00.000Z"),
          finishedAt: new Date("2026-09-01T02:00:00.000Z"),
          currentNodeName: null,
          tasks: [
            {
              nodeName: "部门负责人审批",
              assigneeName: "李雷",
              status: "APPROVED",
              comment: "同意",
              actedAt: new Date("2026-09-01T01:30:00.000Z"),
            },
            {
              nodeName: "资产管理员审批",
              assigneeName: "王芳",
              status: "APPROVED",
              comment: "确认无在用资产",
              actedAt: new Date("2026-09-01T02:00:00.000Z"),
            },
          ],
        },
      },
      {
        id: 2,
        createdAt: new Date("2026-09-02T04:00:00.000Z"),
        assetNo: "DN-0002",
        assetName: "闲置机",
        action: "CREATED",
        fromStatus: null,
        toStatus: "IDLE",
        employeeName: null,
        departmentId: null,
        departmentName: null,
        operator: "admin",
        remark: null,
        request: null,
      },
    ],
    departments: [{ id: 1, name: "技术部" }],
    employees: [{ id: 1, name: "张三", departmentId: 1 }],
    actionOptions: [{ value: "SCRAPPED", label: "报废" }],
    total: 2,
    page: 1,
    pageSize: 10,
  };
}

afterEach(() => cleanup());

describe("设备生命周期-关联申请弹出框", () => {
  it("表格用「查看」按钮触发，未内嵌申请明细", () => {
    render(<AssetLifecycleClient initial={makeInitial()} />);
    expect(screen.getByRole("button", { name: "查看" })).toBeInTheDocument();
    // 申请细节（编号/标题）不在表格中直接展示
    expect(screen.queryByText("AP-202609-0001")).toBeNull();
  });

  it("点击带关联申请所在行的「查看」弹出详情（编号/业务类型/状态）", async () => {
    const user = userEvent.setup();
    render(<AssetLifecycleClient initial={makeInitial()} />);
    await user.click(screen.getByRole("button", { name: "查看" }));

    expect(screen.getByText("AP-202609-0001")).toBeInTheDocument();
    expect(screen.getByText("资产报废")).toBeInTheDocument();
    // 状态在头部徽标与元信息条各出现一次
    expect(screen.getAllByText("已执行").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("报废测试主机")).toBeInTheDocument();
    // 审批流程时间轴：提交 + 各节点 + 终态
    expect(screen.getByText("提交申请")).toBeInTheDocument();
    expect(screen.getByText("部门负责人审批")).toBeInTheDocument();
    expect(screen.getByText("资产管理员审批")).toBeInTheDocument();
    expect(screen.getByText((t) => t.includes("李雷"))).toBeInTheDocument();
    expect(screen.getAllByText((t) => t.includes("王芳")).length).toBeGreaterThanOrEqual(1);
  });

  it("无关联申请的记录不显示「查看」按钮", () => {
    render(<AssetLifecycleClient initial={makeInitial()} />);
    // 仅一行有申请，故只有一个「查看」按钮
    expect(screen.getAllByRole("button", { name: "查看" })).toHaveLength(1);
  });
});