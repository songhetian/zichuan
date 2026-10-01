/**
 * @vitest-environment jsdom
 *
 * 「交接对账」列表页（HandoverListClient）。
 *
 * 背景：离职单终审通过只生成 PENDING 交接单，设备还没回收。
 * 回收入口原先只长在离职单详情页里 —— 资产管理员得先知道是哪张单才进得去。
 * 这个列表把待对账的单直接摆出来，并支持就地核对快照后回收。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HandoverListClient } from "@/app/(main)/approvals/handover/handover-list-client";

const { getHandoverOrdersMock, confirmHandoverMock } = vi.hoisted(() => ({
  getHandoverOrdersMock: vi.fn(),
  confirmHandoverMock: vi.fn(),
}));

vi.mock("@/actions/approval-depart.actions", () => ({
  getHandoverOrders: getHandoverOrdersMock,
}));

vi.mock("@/actions/approval-execute.actions", () => ({
  confirmHandover: confirmHandoverMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const pendingOrder = {
  orderId: 88,
  orderNo: "HO-202609-0001",
  requestId: 42,
  employeeId: 7,
  employeeName: "张三",
  employeeNo: "E-001",
  departmentName: "技术部",
  status: "PENDING",
  assetCount: 2,
  items: [
    { assetId: 11, assetNo: "ZC-0001", name: "MacBook Pro 14", status: "IN_USE" },
    { assetId: 12, assetNo: "ZC-0002", name: "Dell U2723QE", status: "IN_USE" },
  ],
  createdAt: "2026-09-30T02:00:00.000Z",
  collectedAt: null,
  canConfirm: true,
};

const collectedOrder = {
  ...pendingOrder,
  orderId: 89,
  orderNo: "HO-202609-0002",
  requestId: 43,
  employeeId: 8,
  employeeName: "李四",
  employeeNo: "E-002",
  status: "COLLECTED",
  collectedAt: "2026-09-30T06:00:00.000Z",
};

describe("交接对账列表页", () => {
  beforeEach(() => {
    getHandoverOrdersMock.mockReset();
    getHandoverOrdersMock.mockResolvedValue({ success: true, data: [pendingOrder, collectedOrder] });
    confirmHandoverMock.mockReset();
    confirmHandoverMock.mockResolvedValue({
      success: true,
      data: { orderId: 88, collectedAt: new Date() },
    });
  });

  afterEach(() => cleanup());

  it("列出待对账交接单：单号、离职员工（姓名·工号·部门）、应回收台数", () => {
    render(<HandoverListClient initial={[pendingOrder]} />);

    expect(screen.getByText("HO-202609-0001")).toBeInTheDocument();
    expect(screen.getByText(/张三/)).toBeInTheDocument();
    expect(screen.getByText(/E-001/)).toBeInTheDocument();
    expect(screen.getByText(/技术部/)).toBeInTheDocument();

    // 状态列在行内判定（「待对账」也是上方分栏的名字，全局查会歧义）
    const row = screen.getByRole("row", { name: /HO-202609-0001/ });
    expect(within(row).getByText("待对账")).toBeInTheDocument();
    expect(within(row).getByText("2 台")).toBeInTheDocument();
  });

  it("点对账回收先弹核对框：展示快照清单，确认后按单回收并刷新列表", async () => {
    const user = userEvent.setup();
    render(<HandoverListClient initial={[pendingOrder]} />);

    await user.click(screen.getByRole("button", { name: "对账回收" }));

    // 核对依据 = 生成交接单时冻结的快照清单（含维修中等非在用设备）
    expect(await screen.findByText("ZC-0001")).toBeInTheDocument();
    expect(screen.getByText("ZC-0002")).toBeInTheDocument();

    await user.type(screen.getByLabelText("对账备注"), "两台均已在库");
    await user.click(screen.getByRole("button", { name: /确认回收/ }));

    await waitFor(() => {
      expect(confirmHandoverMock).toHaveBeenCalledWith(88, "两台均已在库");
    });
    await waitFor(() => {
      expect(getHandoverOrdersMock).toHaveBeenCalled();
    });
  });

  it("已回收的单不再给回收入口（防重复回收）", () => {
    render(<HandoverListClient initial={[collectedOrder]} />);

    const row = screen.getByRole("row", { name: /HO-202609-0002/ });
    expect(within(row).getByText("已回收")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对账回收" })).not.toBeInTheDocument();
  });

  it("没有对账回收权限的人：看得到待对账单，但不给回收按钮", () => {
    render(<HandoverListClient initial={[{ ...pendingOrder, canConfirm: false }]} />);

    expect(screen.getByText("HO-202609-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对账回收" })).not.toBeInTheDocument();
    expect(screen.getByText(/资产管理员/)).toBeInTheDocument();
  });

  it("切到「已回收」按状态重新拉取，切回「待对账」同理", async () => {
    const user = userEvent.setup();
    getHandoverOrdersMock.mockResolvedValue({ success: true, data: [collectedOrder] });
    render(<HandoverListClient initial={[pendingOrder]} />);

    await user.click(screen.getByRole("button", { name: "已回收" }));

    await waitFor(() => {
      expect(getHandoverOrdersMock).toHaveBeenCalledWith({ status: "COLLECTED" });
    });
    expect(await screen.findByText("HO-202609-0002")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "待对账" }));

    await waitFor(() => {
      expect(getHandoverOrdersMock).toHaveBeenCalledWith({ status: "PENDING" });
    });
  });

  it("没有任何交接单时给出空状态说明，而不是一张空表", () => {
    render(<HandoverListClient initial={[]} />);

    expect(screen.getByText(/暂无交接单/)).toBeInTheDocument();
  });

  it("回收失败时留在核对框里说明原因，不静默关闭", async () => {
    const user = userEvent.setup();
    confirmHandoverMock.mockResolvedValue({
      success: false,
      error: "交接单不满足对账条件或已回收",
    });
    render(<HandoverListClient initial={[pendingOrder]} />);

    await user.click(screen.getByRole("button", { name: "对账回收" }));
    await user.click(screen.getByRole("button", { name: /确认回收/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "交接单不满足对账条件或已回收"
    );
  });
});
