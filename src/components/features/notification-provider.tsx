"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    const onNotification = (n: LiveNotification) => {
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
    };

    (async () => {
      // Socket.IO 由自定义 server.ts 在启动时挂载，无需再初始化路由
      const { getSocket } = await import("@/lib/socket-client");
      if (cancelled) return;
      socket = getSocket(userId);
      // 幂等重挂：getSocket 返回模块级单例，StrictMode 双挂载 / 卸载后重进
      // 会残留或已被摘掉监听——先 off 再 on，保证恰好挂一个
      socket.off("notification", onNotification);
      socket.on("notification", onNotification);
    })();

    return () => {
      cancelled = true;
      socket?.off("notification", onNotification);
    };
  }, [userId, bump, toast, router]);

  return null;
}
