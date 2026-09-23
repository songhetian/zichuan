/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "@/components/ui/toaster";
import { NotificationProvider } from "@/components/features/notification-provider";

const { ioMock, handlers } = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const fakeSocket = {
    on: (ev: string, fn: (...args: unknown[]) => void) => {
      handlers[ev] = fn;
    },
    emit: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
  return { ioMock: vi.fn(() => fakeSocket), handlers };
});

vi.mock("socket.io-client", () => ({ io: ioMock }));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("@/actions/notification.actions", () => ({
  getUnreadNotificationCount: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  getMyNotifications: vi.fn().mockResolvedValue({ success: true, data: [] }),
  markNotificationsRead: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("实时通知 Provider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("收到 notification 事件：弹出 toast 并可点击跳转申请单详情", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <NotificationProvider userId={1} />
      </>
    );

    await waitFor(() => {
      expect(ioMock).toHaveBeenCalled();
    });

    handlers["notification"]?.({
      requestId: 42,
      title: "新的审批待办",
      content: "【AP-202609-0001】申请升级内存",
      createdAt: "2026-09-19T10:00:00.000Z",
    });

    expect(await screen.findByText("新的审批待办")).toBeInTheDocument();
    expect(screen.getByText("【AP-202609-0001】申请升级内存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看详情" }));
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/approvals/42");
    });
  });
});
