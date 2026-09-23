"use server";

import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { requireAuthSafe } from "@/lib/auth";

// ============================================================
// 通知中心（M6）：我的通知 / 未读数 / 标记已读
// 写通知见 src/lib/notification.ts（审批引擎事务内落库）
// ============================================================

export async function getMyNotifications(): Promise<
  ActionResult<
    {
      id: number;
      requestId: number | null;
      title: string;
      content: string | null;
      type: NotificationType;
      isRead: boolean;
      createdAt: Date;
    }[]
  >
> {
  return requireAuthSafe(async (user) => {
    const notifications = await prisma.notification.findMany({
      where: { adminId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return {
      success: true,
      data: notifications.map((n) => ({
        id: n.id,
        requestId: n.requestId,
        title: n.title,
        content: n.content,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
    };
  });
}

export async function getUnreadNotificationCount(): Promise<ActionResult<number>> {
  return requireAuthSafe(async (user) => {
    const count = await prisma.notification.count({
      where: { adminId: user.id, isRead: false },
    });
    return { success: true, data: count };
  });
}

export async function markNotificationsRead(input: {
  ids?: number[];
}): Promise<ActionResult<{ ok: true }>> {
  return requireAuthSafe(async (user) => {
    const ids = input.ids ?? [];
    await prisma.notification.updateMany({
      where: {
        adminId: user.id,
        ...(ids.length > 0 ? { id: { in: ids } } : { isRead: false }),
      },
      data: { isRead: true },
    });
    return { success: true, data: { ok: true } };
  });
}
