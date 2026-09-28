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
import { DoneRecordsClient } from "@/app/(main)/approvals/done/done-records-client";
import { CcRecordsClient } from "@/app/(main)/approvals/cc/cc-records-client";
import * as approvalActions from "@/actions/approval.actions";
import * as excelActions from "@/actions/excel.actions";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("@/actions/approval.actions", () => ({
  submitApprovalRequest: vi.fn(),
  // 提交成功后组件会查询我的待办以决定是否提醒；默认无待办，避免路由被中断
  getMyTodoTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getMySubmittedRequests: vi.fn(),
  getApprovalRequestById: vi.fn(),
  approveTask: vi.fn(),
  rejectTask: vi.fn(),
  getMyHandledRecords: vi.fn(),
  getMyCcRecords: vi.fn(),
}));

vi.mock("@/actions/excel.actions", () => ({
  exportHandledRecordsToExcel: vi.fn(),
  exportCcRecordsToExcel: vi.fn(),
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
    await user.click(await screen.findByRole("option", { name: /台式机/ }));
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

describe("我办理的记录页", () => {
  const options = {
    canViewAll: true,
    departments: [{ id: 1, name: "技术部" }],
    initiators: [{ id: 9, name: "申请员工" }],
    componentCategories: [{ id: 30, name: "内存" }],
  };
  const initial = [
    {
      requestId: 42,
      requestNo: "AP-202609-0001",
      title: "申请报废电脑",
      businessType: "ASSET_SCRAP",
      status: "APPROVED",
      initiatorId: 9,
      initiatorName: "申请员工",
      departmentId: 1,
      departmentName: "技术部",
      componentCategoryId: null,
      componentCategoryName: null,
      actions: ["APPROVE", "EXECUTE"] as ("APPROVE" | "EXECUTE")[],
      lastActedAt: new Date("2026-09-19T10:00:00.000Z"),
      finishedAt: new Date("2026-09-19T10:00:00.000Z"),
    },
  ];

  it("渲染办理记录：单号/标题/我的动作标签/详情链接", async () => {
    render(<DoneRecordsClient initial={initial} options={options} />);

    expect(await screen.findByText("AP-202609-0001")).toBeInTheDocument();
    expect(screen.getByText("申请报废电脑")).toBeInTheDocument();
    expect(screen.getByText("审批通过")).toBeInTheDocument();
    expect(screen.getByText("执行")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看" })).toHaveAttribute("href", "/approvals/42");
    // 首次渲染直接用服务端数据，不应触发查询
    expect(approvalActions.getMyHandledRecords).not.toHaveBeenCalled();
  });

  it("无 approval.detail.view 时不显示「全部办理记录」切换", async () => {
    render(
      <DoneRecordsClient initial={[]} options={{ ...options, canViewAll: false }} />
    );
    expect(screen.queryByRole("button", { name: "全部办理记录" })).toBeNull();
  });

  it("切换到「全部办理记录」后按 mode=ALL 防抖重查", async () => {
    const user = userEvent.setup();
    (approvalActions.getMyHandledRecords as any).mockResolvedValue({ success: true, data: [] });
    render(<DoneRecordsClient initial={initial} options={options} />);

    await user.click(screen.getByRole("button", { name: "全部办理记录" }));

    await waitFor(
      () =>
        expect(approvalActions.getMyHandledRecords).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "ALL" })
        ),
      { timeout: 3000 }
    );
  });

  it("导出按钮调用导出 action 并下载 xlsx", async () => {
    const user = userEvent.setup();
    (excelActions.exportHandledRecordsToExcel as any).mockResolvedValue({
      success: true,
      data: { fileName: "办理记录_20260924.xlsx", buffer: [1, 2, 3] },
    });
    render(<DoneRecordsClient initial={initial} options={options} />);

    await user.click(screen.getByRole("button", { name: /导出 Excel/ }));

    await waitFor(() =>
      expect(excelActions.exportHandledRecordsToExcel).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "MINE" })
      )
    );
  });
});

describe("我的抄送页", () => {
  const options = {
    departments: [{ id: 1, name: "技术部" }],
    initiators: [{ id: 9, name: "申请员工" }],
    componentCategories: [{ id: 30, name: "内存" }],
  };
  const initial = [
    {
      requestId: 42,
      requestNo: "AP-202609-0001",
      title: "申请升级内存",
      businessType: "ASSET_UPGRADE",
      status: "PENDING",
      initiatorId: 9,
      initiatorName: "申请员工",
      departmentId: 1,
      departmentName: "技术部",
      componentCategoryId: 30,
      componentCategoryName: "内存",
      ccAt: new Date("2026-09-19T10:00:00.000Z"),
    },
  ];

  it("渲染抄送记录：单号/标题/状态/详情链接，首次渲染不查询", async () => {
    render(<CcRecordsClient initial={initial} options={options} />);

    expect(await screen.findByText("AP-202609-0001")).toBeInTheDocument();
    expect(screen.getByText("申请升级内存")).toBeInTheDocument();
    expect(screen.getByText("审批中")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看" })).toHaveAttribute("href", "/approvals/42");
    expect(approvalActions.getMyCcRecords).not.toHaveBeenCalled();
  });

  it("筛选条件变化后防抖重查", async () => {
    const user = userEvent.setup();
    (approvalActions.getMyCcRecords as any).mockResolvedValue({ success: true, data: [] });
    render(<CcRecordsClient initial={initial} options={options} />);

    await user.type(screen.getByPlaceholderText("单号 / 申请标题"), "AP-202609");

    await waitFor(
      () =>
        expect(approvalActions.getMyCcRecords).toHaveBeenCalledWith(
          expect.objectContaining({ keyword: "AP-202609" })
        ),
      { timeout: 3000 }
    );
  });

  it("导出按钮调用导出 action 并下载 xlsx", async () => {
    const user = userEvent.setup();
    (excelActions.exportCcRecordsToExcel as any).mockResolvedValue({
      success: true,
      data: { fileName: "抄送记录_20260924.xlsx", buffer: [1, 2, 3] },
    });
    render(<CcRecordsClient initial={initial} options={options} />);

    await user.click(screen.getByRole("button", { name: /导出 Excel/ }));

    await waitFor(() =>
      expect(excelActions.exportCcRecordsToExcel).toHaveBeenCalled()
    );
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
    // 发起人行渲染为「· 发起人」标签与姓名拼接在同一段落文本内
    expect(screen.getByText(/· 发起人/)).toBeInTheDocument();
    expect(screen.getByText(/申请员工/)).toBeInTheDocument();
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
