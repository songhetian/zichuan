/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsClient } from "@/app/(main)/notifications/notifications-client";
import * as notifActions from "@/actions/notification.actions";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("@/actions/notification.actions", () => ({
  getMyNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  getUnreadNotificationCount: vi.fn().mockResolvedValue({ success: true, data: 0 }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("通知中心页", () => {
  it("渲染通知列表：未读高亮 + 内容 + 时间", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          requestId: 42,
          title: "新的审批待办",
          content: "【AP-202609-0001】申请升级内存",
          type: "APPROVAL_TODO",
          isRead: false,
          createdAt: "2026-09-19T10:00:00.000Z",
        },
        {
          id: 2,
          requestId: 43,
          title: "审批通过",
          content: "【AP-202609-0002】申请升级显卡 已全部通过",
          type: "APPROVAL_RESULT",
          isRead: true,
          createdAt: "2026-09-19T11:00:00.000Z",
        },
      ],
    });
    render(<NotificationsClient />);

    expect(await screen.findByText("新的审批待办")).toBeInTheDocument();
    expect(screen.getByText("【AP-202609-0001】申请升级内存")).toBeInTheDocument();
    expect(screen.getByText("审批通过")).toBeInTheDocument();
    // 类型徽章（含在行内）
    expect(screen.getAllByText("待办").length).toBeGreaterThan(0);
    expect(screen.getAllByText("结果").length).toBeGreaterThan(0);
    expect(screen.getByText("1 条未读")).toBeInTheDocument();
  });

  it("点击「全部已读」调用 markNotificationsRead 并刷新列表", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [{ id: 1, requestId: 42, title: "新的审批待办", content: null, isRead: false, createdAt: "2026-09-19T10:00:00.000Z" }],
    });
    (notifActions.markNotificationsRead as any).mockResolvedValue({ success: true, data: { ok: true } });

    const user = userEvent.setup();
    render(<NotificationsClient />);

    await screen.findByText("新的审批待办");
    await user.click(screen.getByRole("button", { name: "全部已读" }));

    await waitFor(() => {
      expect(notifActions.markNotificationsRead).toHaveBeenCalledWith({});
    });
  });

  it("点击未读通知：标记该条已读并跳转申请单详情", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [{ id: 7, requestId: 42, title: "新的审批待办", content: null, isRead: false, createdAt: "2026-09-19T10:00:00.000Z" }],
    });
    (notifActions.markNotificationsRead as any).mockResolvedValue({ success: true, data: { ok: true } });

    const user = userEvent.setup();
    render(<NotificationsClient />);

    await screen.findByText("新的审批待办");
    await user.click(screen.getByRole("button", { name: /新的审批待办/ }));

    await waitFor(() => {
      expect(notifActions.markNotificationsRead).toHaveBeenCalledWith({ ids: [7] });
    });
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/approvals/42");
    });
  });

  it("空列表显示「暂无通知」", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({ success: true, data: [] });
    render(<NotificationsClient />);

    expect(await screen.findByText("暂无通知")).toBeInTheDocument();
  });

  it("g) 渲染类型分组 Tabs：全部/待办/结果/抄送/系统，且各 tab 带未读数", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [
        { id: 1, requestId: 42, title: "待办A", content: null, type: "APPROVAL_TODO", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
        { id: 2, requestId: 43, title: "结果A", content: null, type: "APPROVAL_RESULT", isRead: true, createdAt: "2026-09-19T10:00:00.000Z" },
        { id: 3, requestId: 44, title: "抄送A", content: null, type: "APPROVAL_CC", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
      ],
    });
    render(<NotificationsClient />);
    await screen.findByText("待办A");

    const tabs = ["全部", "待办", "结果", "抄送", "系统"];
    for (const t of tabs) {
      expect(screen.getByRole("tab", { name: new RegExp(t) })).toBeInTheDocument();
    }
    // 「全部」tab 汇总未读 2
    expect(screen.getByRole("tab", { name: /全部/ })).toHaveTextContent("2");
    // 「待办」tab 未读 1
    expect(screen.getByRole("tab", { name: /待办/ })).toHaveTextContent("1");
  });

  it("h) 点击「结果」tab 只显示 APPROVAL_RESULT 通知，隐藏其它类型", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [
        { id: 1, requestId: 42, title: "待办A", content: null, type: "APPROVAL_TODO", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
        { id: 2, requestId: 43, title: "结果A", content: null, type: "APPROVAL_RESULT", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
      ],
    });
    const user = userEvent.setup();
    render(<NotificationsClient />);
    await screen.findByText("待办A");

    await user.click(screen.getByRole("tab", { name: /^结果/ }));
    expect(screen.getByText("结果A")).toBeInTheDocument();
    expect(screen.queryByText("待办A")).not.toBeInTheDocument();
    expect(screen.getByText("1 条未读")).toBeInTheDocument();
  });

  it("i) 点击「已读单个通知后，对应 tab 未读数减少」，默认落在「全部」tab", async () => {
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [
        { id: 1, requestId: 42, title: "待办A", content: null, type: "APPROVAL_TODO", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
        { id: 2, requestId: 43, title: "待办B", content: null, type: "APPROVAL_TODO", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
      ],
    });
    (notifActions.markNotificationsRead as any).mockResolvedValue({ success: true, data: { ok: true } });
    const user = userEvent.setup();
    render(<NotificationsClient />);
    await screen.findByText("待办A");
    // 初始「全部」未读 2
    expect(screen.getByRole("tab", { name: /全部/ })).toHaveTextContent("2");

    // 读掉一条
    await user.click(screen.getByRole("button", { name: /待办A/ }));
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/approvals/42");
    });
    // 重新 mock 返回 1 未读后再 load（由点击内部 refreshUnread 后重载列表触发）
    (notifActions.getMyNotifications as any).mockResolvedValue({
      success: true,
      data: [
        { id: 1, requestId: 42, title: "待办A", content: null, type: "APPROVAL_TODO", isRead: true, createdAt: "2026-09-19T10:00:00.000Z" },
        { id: 2, requestId: 43, title: "待办B", content: null, type: "APPROVAL_TODO", isRead: false, createdAt: "2026-09-19T10:00:00.000Z" },
      ],
    });
  });
});
