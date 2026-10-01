/**
 * @vitest-environment jsdom
 *
 * 离职申请单详情页（/approvals/[id]）的「核对设备」接线。
 *
 * 部门主管与资产管理员审批的是同一个页面，所以入口只需加在这一处；
 * 但又必须是**顺序**的：先核对，再通过。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ApprovalDetailClient } from "@/app/(main)/approvals/[id]/approval-detail-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const {
  getApprovalRequestByIdMock,
  getMyTodoTasksMock,
  getDepartureCheckInfoMock,
  getDepartureHandoverMock,
  getAssetComponentsMock,
  confirmHandoverMock,
} = vi.hoisted(() => ({
  getApprovalRequestByIdMock: vi.fn(),
  getMyTodoTasksMock: vi.fn(),
  getDepartureCheckInfoMock: vi.fn(),
  getDepartureHandoverMock: vi.fn(),
  getAssetComponentsMock: vi.fn(),
  confirmHandoverMock: vi.fn(),
}));

vi.mock("@/actions/approval.actions", () => ({
  getApprovalRequestById: getApprovalRequestByIdMock,
  getMyTodoTasks: getMyTodoTasksMock,
  approveTask: vi.fn(),
  rejectTask: vi.fn(),
}));

vi.mock("@/actions/approval-depart.actions", () => ({
  getDepartureCheckInfo: getDepartureCheckInfoMock,
  getDepartureHandover: getDepartureHandoverMock,
}));

vi.mock("@/actions/approval-execute.actions", () => ({
  confirmHandover: confirmHandoverMock,
}));

vi.mock("@/actions/employee.actions", () => ({
  getAssetComponents: getAssetComponentsMock,
}));

const employee = {
  id: 7,
  employeeNo: "EMP0007",
  name: "张三",
  departmentId: 1,
  departmentName: "技术部",
  phone: "13800000000",
  email: null,
  assetCount: 2,
  createdAt: "2025-01-05T00:00:00.000Z",
};

const departDetail = {
  id: 42,
  requestNo: "AP-202609-0001",
  title: "员工离职交接",
  status: "PENDING",
  businessType: "ASSET_DEPART",
  version: 1,
  initiatorName: "李四",
  currentNodeName: "部门主管审批",
  payload: {
    targetEmployeeId: 7,
    reason: "个人原因离职",
    targetEmployeeName: "张三",
    targetEmployeeNo: "EMP0007",
    targetDepartmentName: "技术部",
  },
  submittedAt: "2026-09-30T01:00:00.000Z",
  finishedAt: null,
  logs: [],
};

function mockDetail(detail: Record<string, unknown>) {
  getApprovalRequestByIdMock.mockResolvedValue({ success: true, data: detail });
}

describe("离职申请单详情的核对入口", () => {
  beforeEach(() => {
    getApprovalRequestByIdMock.mockReset();
    getMyTodoTasksMock.mockReset();
    getMyTodoTasksMock.mockResolvedValue({ success: true, data: [] });
    getDepartureCheckInfoMock.mockReset();
    getDepartureCheckInfoMock.mockResolvedValue({
      success: true,
      data: {
        employee,
        assets: [
          {
            id: 11,
            assetNo: "ZC-0001",
            name: "MacBook Pro 14",
            status: "IN_USE",
            templateName: "MacBook Pro 14 英寸",
            categoryName: "笔记本电脑",
            location: null,
            purchaseDate: null,
            warrantyMonths: null,
            notes: null,
          },
        ],
      },
    });
    getDepartureHandoverMock.mockReset();
    getDepartureHandoverMock.mockResolvedValue({ success: true, data: null });
    getAssetComponentsMock.mockReset();
    getAssetComponentsMock.mockResolvedValue({ success: true, data: [] });
    confirmHandoverMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("离职单显示「谁要离职」（姓名/工号/部门），而不是一个无意义的空设备行", async () => {
    mockDetail(departDetail);
    render(<ApprovalDetailClient requestId={42} />);

    expect(await screen.findByText("离职员工")).toBeInTheDocument();

    const row = screen.getByText("离职员工").closest("div") as HTMLElement;
    expect(row).toHaveTextContent("张三");
    expect(row).toHaveTextContent("EMP0007");
    expect(row).toHaveTextContent("技术部");

    // 离职单没有「设备」这一项（payload 里根本没有 assetId）
    expect(screen.queryByText("设备")).not.toBeInTheDocument();
  });

  it("核对入口排在「通过」按钮之前：检查完毕，再通过", async () => {
    mockDetail(departDetail);
    getMyTodoTasksMock.mockResolvedValue({
      success: true,
      data: [
        {
          id: 5,
          requestId: 42,
          requestNo: "AP-202609-0001",
          title: "员工离职交接",
          nodeName: "部门主管审批",
          status: "PENDING",
          createdAt: "2026-09-30T01:00:00.000Z",
        },
      ],
    });

    render(<ApprovalDetailClient requestId={42} />);

    const check = await screen.findByText("通过前请先核对名下设备");
    const approveBtn = screen.getByRole("button", { name: "通过" });

    // approveBtn 在 check 之后 → 计算顺序为「核对 → 通过」
    expect(check.compareDocumentPosition(approveBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("终审通过后同一个页面给出「对账确认回收」入口", async () => {
    mockDetail({ ...departDetail, status: "APPROVED", currentNodeName: null });
    getDepartureHandoverMock.mockResolvedValue({
      success: true,
      data: {
        orderId: 88,
        orderNo: "HO-202609-0001",
        status: "PENDING",
        employeeId: 7,
        items: [{ assetId: 11, assetNo: "ZC-0001", name: "MacBook Pro 14", status: "IN_USE" }],
        assetCount: 1,
        confirmedAt: null,
        collectedAt: null,
        canConfirm: true,
      },
    });

    render(<ApprovalDetailClient requestId={42} />);

    expect(await screen.findByText("HO-202609-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /回收/ })).toBeInTheDocument();
  });

  it("非离职单（退回）不出现核对面板，避免误接线", async () => {
    mockDetail({
      ...departDetail,
      businessType: "ASSET_RETURN",
      payload: { assetId: 11, assetNo: "ZC-0001", assetName: "MacBook Pro 14", reason: "不再使用" },
    });

    render(<ApprovalDetailClient requestId={42} />);

    // 用「申请原因」当加载完成信号（单号与发起人在同一个文本节点里，精确匹配不到）
    expect(await screen.findByText("不再使用")).toBeInTheDocument();
    expect(screen.queryByText("通过前请先核对名下设备")).not.toBeInTheDocument();
    expect(getDepartureCheckInfoMock).not.toHaveBeenCalled();
    expect(getDepartureHandoverMock).not.toHaveBeenCalled();
  });
});
