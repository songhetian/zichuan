/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewRequestClient } from "@/app/(main)/approvals/new/new-request-client";
import { TodoClient } from "@/app/(main)/approvals/todo/todo-client";
import { MyRequestsClient } from "@/app/(main)/approvals/my/my-requests-client";
import { ApprovalDetailClient } from "@/app/(main)/approvals/[id]/approval-detail-client";
import * as approvalActions from "@/actions/approval.actions";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("@/actions/approval.actions", () => ({
  submitApprovalRequest: vi.fn(),
  getMyTodoTasks: vi.fn(),
  getMySubmittedRequests: vi.fn(),
  getApprovalRequestById: vi.fn(),
  approveTask: vi.fn(),
  rejectTask: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("发起申请页", () => {
  it("填写表单提交后调用 submitApprovalRequest 并跳转详情", async () => {
    const user = userEvent.setup();
    (approvalActions.submitApprovalRequest as any).mockResolvedValue({
      success: true,
      data: { id: 42, requestNo: "AP-202609-0001", status: "PENDING", currentNodeKey: "n1" },
    });
    render(
      <NewRequestClient
        assets={[{ id: 1, assetNo: "DN-0001", name: "台式机" }]}
        assetCats={[{ assetId: 1, categoryId: 30, categoryName: "内存" }]}
        employees={[]}
      />
    );

    await user.type(screen.getByLabelText("申请标题"), "申请升级内存");
    // 只有一台在用设备时表单会自动带出设备，无需手动选择
    await user.click(screen.getByRole("combobox", { name: "选择配件类别" }));
    await user.click(await screen.findByText("内存"));
    await user.type(screen.getByLabelText("申请原因"), "内存不足");

    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith({
        title: "申请升级内存",
        businessType: "ASSET_UPGRADE",
        payload: {
          assetId: 1,
          componentCategoryId: 30,
          action: "UPGRADE",
          reason: "内存不足",
          assetNo: "DN-0001",
          assetName: "台式机",
          categoryName: "内存",
        },
      });
    });
    expect(routerPush).toHaveBeenCalledWith("/approvals/42");
  });

  it("切换到资产报废：隐藏配件字段，提交 SCAP 业务类型", async () => {
    const user = userEvent.setup();
    (approvalActions.submitApprovalRequest as any).mockResolvedValue({
      success: true,
      data: { id: 43, requestNo: "AP-202609-0002", status: "PENDING", currentNodeKey: "n1" },
    });
    render(
      <NewRequestClient
        assets={[{ id: 1, assetNo: "DN-0001", name: "台式机" }]}
        assetCats={[{ assetId: 1, categoryId: 30, categoryName: "内存" }]}
        employees={[]}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "选择业务类型" }));
    await user.click(await screen.findByRole("option", { name: "资产报废" }));
    await user.type(screen.getByLabelText("申请标题"), "申请报废损坏主机");
    await user.click(screen.getByRole("combobox", { name: "选择设备" }));
    await user.click(await screen.findByText("DN-0001 · 台式机"));
    await user.type(screen.getByLabelText("报废原因"), "硬件损坏不可修复");

    // 升级专属的配件字段不再渲染
    expect(screen.queryByRole("combobox", { name: "选择配件类别" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "选择动作" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith({
        title: "申请报废损坏主机",
        businessType: "ASSET_SCRAP",
        payload: { assetId: 1, reason: "硬件损坏不可修复" },
      });
    });
    expect(routerPush).toHaveBeenCalledWith("/approvals/43");
  });

  it("未选择设备时提交被拦截", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={[]} assetCats={[]} employees={[]} />);

    await user.type(screen.getByLabelText("申请标题"), "申请升级内存");
    await user.click(screen.getByRole("button", { name: "提交申请" }));

    expect(approvalActions.submitApprovalRequest).not.toHaveBeenCalled();
  });
});

describe("我的待办页", () => {
  it("渲染待办列表与跳转链接", async () => {
    (approvalActions.getMyTodoTasks as any).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          requestId: 42,
          requestNo: "AP-202609-0001",
          title: "申请升级内存",
          nodeName: "部门主管审批",
          status: "PENDING",
          createdAt: "2026-09-19T10:00:00.000Z",
        },
      ],
    });
    render(<TodoClient />);

    expect(await screen.findByText("AP-202609-0001")).toBeInTheDocument();
    expect(screen.getByText("申请升级内存")).toBeInTheDocument();
    expect(screen.getByText("部门主管审批")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /去处理/ })).toHaveAttribute(
      "href",
      "/approvals/42"
    );
  });
});

describe("我的申请页", () => {
  it("渲染申请列表：单号/标题/状态/当前节点/详情链接", async () => {
    (approvalActions.getMySubmittedRequests as any).mockResolvedValue({
      success: true,
      data: [
        {
          id: 42,
          requestNo: "AP-202609-0001",
          title: "申请升级内存",
          status: "PENDING",
          currentNodeName: "部门主管审批",
          submittedAt: "2026-09-19T10:00:00.000Z",
          finishedAt: null,
        },
        {
          id: 43,
          requestNo: "AP-202609-0002",
          title: "申请升级显卡",
          status: "REJECTED",
          currentNodeName: null,
          submittedAt: "2026-09-19T11:00:00.000Z",
          finishedAt: "2026-09-19T12:00:00.000Z",
        },
      ],
    });
    render(<MyRequestsClient />);

    expect(await screen.findByText("AP-202609-0001")).toBeInTheDocument();
    expect(screen.getByText("申请升级内存")).toBeInTheDocument();
    expect(screen.getByText("审批中")).toBeInTheDocument();
    expect(screen.getByText("部门主管审批")).toBeInTheDocument();
    expect(screen.getByText("已驳回")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /详情/ });
    expect(links[0]).toHaveAttribute("href", "/approvals/42");
    expect(links[1]).toHaveAttribute("href", "/approvals/43");
  });

  it("空列表显示「暂无申请」", async () => {
    (approvalActions.getMySubmittedRequests as any).mockResolvedValue({
      success: true,
      data: [],
    });
    render(<MyRequestsClient />);

    expect(await screen.findByText("暂无申请")).toBeInTheDocument();
  });
});

describe("申请单详情页", () => {
  it("渲染信息、时间线并支持审批操作", async () => {
    const user = userEvent.setup();
    (approvalActions.getApprovalRequestById as any).mockResolvedValue({
      success: true,
      data: {
        id: 42,
        requestNo: "AP-202609-0001",
        title: "申请升级内存",
        status: "PENDING",
        businessType: "ASSET_UPGRADE",
        version: 1,
        initiatorName: "申请员工",
        currentNodeName: "部门主管审批",
        payload: {
          assetId: 1,
          componentCategoryId: 30,
          categoryName: "内存",
          action: "UPGRADE",
          reason: "内存不足",
        },
        submittedAt: "2026-09-19T10:00:00.000Z",
        finishedAt: null,
        logs: [
          {
            action: "SUBMIT",
            comment: null,
            fromNodeKey: null,
            toNodeKey: "n1",
            createdAt: "2026-09-19T10:00:00.000Z",
          },
        ],
      },
    });
    (approvalActions.getMyTodoTasks as any).mockResolvedValue({
      success: true,
      data: [
        {
          id: 7,
          requestId: 42,
          requestNo: "AP-202609-0001",
          title: "申请升级内存",
          nodeName: "部门主管审批",
          status: "PENDING",
          createdAt: "2026-09-19T10:00:00.000Z",
        },
      ],
    });
    (approvalActions.approveTask as any).mockResolvedValue({
      success: true,
      data: { ok: true },
    });

    render(<ApprovalDetailClient requestId={42} />);

    expect(await screen.findByText("申请升级内存")).toBeInTheDocument();
    expect(screen.getByText("审批中")).toBeInTheDocument();
    expect(screen.getByText("提交申请")).toBeInTheDocument();
    expect(screen.getByText(/发起人：申请员工/)).toBeInTheDocument();
    expect(screen.getByText("内存")).toBeInTheDocument();
    expect(screen.getByText("升级")).toBeInTheDocument();

    await user.type(screen.getByLabelText("审批意见"), "同意");
    await user.click(screen.getByRole("button", { name: "通过" }));

    await waitFor(() => {
      expect(approvalActions.approveTask).toHaveBeenCalledWith({
        taskId: 7,
        comment: "同意",
      });
    });
  });

  it("已驳回申请单不显示审批操作", async () => {
    (approvalActions.getApprovalRequestById as any).mockResolvedValue({
      success: true,
      data: {
        id: 43,
        requestNo: "AP-202609-0002",
        title: "申请升级显卡",
        status: "REJECTED",
        businessType: "ASSET_UPGRADE",
        version: 1,
        initiatorName: "申请员工",
        currentNodeName: null,
        payload: {
          assetId: 2,
          componentCategoryId: 31,
          categoryName: "显卡",
          action: "DOWNGRADE",
          reason: "画图卡顿",
        },
        submittedAt: "2026-09-19T10:00:00.000Z",
        finishedAt: "2026-09-19T11:00:00.000Z",
        logs: [
          {
            action: "SUBMIT",
            comment: null,
            fromNodeKey: null,
            toNodeKey: "n1",
            createdAt: "2026-09-19T10:00:00.000Z",
          },
          {
            action: "REJECT",
            comment: "预算不足",
            fromNodeKey: "n1",
            toNodeKey: null,
            createdAt: "2026-09-19T11:00:00.000Z",
          },
        ],
      },
    });
    (approvalActions.getMyTodoTasks as any).mockResolvedValue({
      success: true,
      data: [],
    });

    render(<ApprovalDetailClient requestId={43} />);

    expect(await screen.findByText("已驳回")).toBeInTheDocument();
    expect(screen.getByText("预算不足")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
  });
});
