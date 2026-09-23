"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useNotificationStore } from "@/store/notification-store";
import type { LiveNotification } from "@/lib/socket-pusher";

/**
 * 全局实时通知（M6）
 * - 连接 Socket.IO（服务端由自定义 server.ts 在启动时挂载）
 * - 收到 notification 事件 → 弹 toast（点击跳申请单详情）+ 未读角标 +1
 * - 挂载时刷新一次未读数（对齐掉线期间的遗漏）
 */
export function NotificationProvider({ userId }: { userId: number }) {
  const { toast } = useToast();
  const router = useRouter();
  const bump = useNotificationStore((s) => s.bump);
  const refresh = useNotificationStore((s) => s.refresh);
  const registeredUserId = useRef<number | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (registeredUserId.current === userId) return;
    registeredUserId.current = userId;

    let socket: Socket | null = null;
    let cancelled = false;

    (async () => {
      // Socket.IO 由自定义 server.ts 在启动时挂载，无需再初始化路由
      const { getSocket } = await import("@/lib/socket-client");
      socket = getSocket(userId);
      socket.on("notification", (n: LiveNotification) => {
        bump();
        toast({
          title: n.title,
          description: n.content ?? undefined,
          action:
            n.requestId != null ? (
              <ToastAction
                altText="查看详情"
                onClick={() => router.push(`/approvals/${n.requestId}`)}
              >
                查看详情
              </ToastAction>
            ) : undefined,
        });
      });
    })();

    return () => {
      cancelled = true;
      socket?.off("notification");
    };
  }, [userId, bump, toast, router]);

  return null;
}
