/**
 * @vitest-environment jsdom
 *
 * 离职交接单「对账确认回收」面板（DepartureHandoverPanel）。
 *
 * 背景：终审通过后系统只生成了 PENDING 交接单，**设备并没有回收**；
 * 必须由资产管理员核对实物无误后确认，才真正回收。
 * 在补这块 UI 之前，confirmHandover 有实现、有权限点、有测试，但前端零调用——
 * 流程在「最后一公里」是断的。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepartureHandoverPanel } from "@/components/features/departure-handover-panel";

const { getDepartureHandoverMock, confirmHandoverMock } = vi.hoisted(() => ({
  getDepartureHandoverMock: vi.fn(),
  confirmHandoverMock: vi.fn(),
}));

vi.mock("@/actions/approval-depart.actions", () => ({
  getDepartureHandover: getDepartureHandoverMock,
}));

vi.mock("@/actions/approval-execute.actions", () => ({
  confirmHandover: confirmHandoverMock,
}));

const pendingOrder = {
  orderId: 88,
  orderNo: "HO-202609-0001",
  status: "PENDING",
  employeeId: 7,
  items: [
    { assetId: 11, assetNo: "ZC-0001", name: "MacBook Pro 14", status: "IN_USE" },
    { assetId: 12, assetNo: "ZC-0002", name: "Dell U2723QE", status: "IN_USE" },
  ],
  assetCount: 2,
  confirmedAt: null,
  collectedAt: null,
  canConfirm: true,
};

describe("离职交接对账面板", () => {
  beforeEach(() => {
    getDepartureHandoverMock.mockReset();
    getDepartureHandoverMock.mockResolvedValue({ success: true, data: pendingOrder });
    confirmHandoverMock.mockReset();
    confirmHandoverMock.mockResolvedValue({ success: true, data: { orderId: 88, collectedAt: new Date() } });
  });

  afterEach(() => {
    cleanup();
  });

  it("待对账时列出交接单号与快照清单（对账依据），并给出回收入口", async () => {
    render(<DepartureHandoverPanel requestId={42} />);

    expect(await screen.findByText("HO-202609-0001")).toBeInTheDocument();
    expect(screen.getByText(/待对账/)).toBeInTheDocument();
    expect(screen.getByText("ZC-0001")).toBeInTheDocument();
    expect(screen.getByText("ZC-0002")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /回收/ })).toBeInTheDocument();
  });

  it("点回收要先确认一次（批量写操作，不可撤销），确认后带上备注调用对账回收", async () => {
    const user = userEvent.setup();
    const onCollected = vi.fn();
    render(<DepartureHandoverPanel requestId={42} onCollected={onCollected} />);

    // 备注在打开确认框之前填（确认框是模态，背景不可交互）
    await user.type(await screen.findByLabelText("对账备注"), "两台均已在库");

    await user.click(screen.getByRole("button", { name: /回收/ }));

    // 确认框出现，确认后才真正写库
    const confirmBtn = await screen.findByRole("button", { name: /确认回收/ });
    expect(confirmHandoverMock).not.toHaveBeenCalled();
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(confirmHandoverMock).toHaveBeenCalledWith(88, "两台均已在库");
    });
    await waitFor(() => {
      expect(onCollected).toHaveBeenCalled();
    });
  });

  it("没有对账权限的人看得到交接单，但不给出回收按钮（改由资产管理员处理）", async () => {
    getDepartureHandoverMock.mockResolvedValue({
      success: true,
      data: { ...pendingOrder, canConfirm: false },
    });
    render(<DepartureHandoverPanel requestId={42} />);

    expect(await screen.findByText("HO-202609-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /回收/ })).not.toBeInTheDocument();
    expect(screen.getByText(/资产管理员/)).toBeInTheDocument();
  });

  it("已回收后只呈现结果，不再出现回收入口", async () => {
    getDepartureHandoverMock.mockResolvedValue({
      success: true,
      data: {
        ...pendingOrder,
        status: "COLLECTED",
        confirmedAt: new Date("2026-09-30T02:00:00Z"),
        collectedAt: new Date("2026-09-30T02:00:00Z"),
      },
    });
    render(<DepartureHandoverPanel requestId={42} />);

    expect(await screen.findByText(/已回收/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /回收/ })).not.toBeInTheDocument();
  });

  it("还没有交接单（审批中）时整块不渲染，不占位、不留白", async () => {
    getDepartureHandoverMock.mockResolvedValue({ success: true, data: null });
    const { container } = render(<DepartureHandoverPanel requestId={42} />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("回收失败时把服务端原因说出来，而不是静默失败", async () => {
    const user = userEvent.setup();
    confirmHandoverMock.mockResolvedValue({ success: false, error: "交接单不满足对账条件或已回收" });
    render(<DepartureHandoverPanel requestId={42} />);

    await user.click(await screen.findByRole("button", { name: /回收/ }));
    await user.click(await screen.findByRole("button", { name: /确认回收/ }));

    // 失败后确认框保持打开（不静默关闭），提示可见
    expect(await screen.findByText("交接单不满足对账条件或已回收")).toBeInTheDocument();
  });
});
