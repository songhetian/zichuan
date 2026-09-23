import { Prisma, NotificationType } from "@prisma/client";

/**
 * 站内通知落库（M6）
 * 审批引擎在各触发点于 $transaction 内调用 createNotifications，
 * 保证通知与审批数据强一致；事务提交后由调用方触发实时推送（见 socket-pusher.ts）。
 */

export interface NotificationItem {
  adminId: number;
  requestId: number | null;
  /** 通知类型（spec §4），缺省按 SYSTEM 落库 */
  type?: NotificationType;
  title: string;
  content?: string | null;
}

/** 事务内批量落库（空数组直接跳过） */
export async function createNotifications(
  tx: Prisma.TransactionClient,
  items: NotificationItem[]
): Promise<void> {
  if (items.length === 0) return;
  await tx.notification.createMany({
    data: items.map((it) => ({
      adminId: it.adminId,
      requestId: it.requestId,
      type: it.type ?? "SYSTEM",
      title: it.title,
      content: it.content ?? null,
    })),
  });
}

/** 同一接收人只留一条（审批人优先于抄送，避免重复打扰） */
export function dedupeNotifications(items: NotificationItem[]): NotificationItem[] {
  const seen = new Set<number>();
  return items.filter((it) => {
    if (seen.has(it.adminId)) return false;
    seen.add(it.adminId);
    return true;
  });
}
