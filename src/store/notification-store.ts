import { create } from "zustand";

// 未读通知数（Header 铃铛角标）：通知到达 bump +1；进页面/进通知中心 refresh 对齐
interface NotificationState {
  unread: number;
  refresh: () => Promise<void>;
  bump: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  refresh: async () => {
    const { getUnreadNotificationCount } = await import(
      "@/actions/notification.actions"
    );
    const res = await getUnreadNotificationCount();
    if (res.success) set({ unread: res.data });
  },
  bump: () => set((s) => ({ unread: s.unread + 1 })),
}));
