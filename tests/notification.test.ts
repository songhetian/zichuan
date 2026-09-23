import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  getMyNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from "@/actions/notification.actions";

// ============================================================
// 通知中心（M6）：我的通知 / 未读数 / 标记已读
// ============================================================

async function seedAdmin(username: string) {
  return prisma.admin.create({
    data: { username, password: "x", displayName: username },
  });
}

async function login(admin: { id: number; username: string }) {
  setTestUser({ id: admin.id, username: admin.username });
}

describe("通知中心（M6）", () => {
  afterEach(() => setTestUser(null));

  it("未登录获取通知返回请先登录", async () => {
    const res = await getMyNotifications();
    expect(res).toEqual({ success: false, error: "请先登录" });
  });

  it("只返回自己的通知，按时间倒序", async () => {
    const a = await seedAdmin("alice");
    const b = await seedAdmin("bob");
    await prisma.notification.createMany({
      data: [
        { adminId: a.id, title: "待办1", content: "c1", createdAt: new Date("2026-09-19T10:00:00Z") },
        { adminId: b.id, title: "别人的", createdAt: new Date("2026-09-19T10:05:00Z") },
        { adminId: a.id, title: "待办2", createdAt: new Date("2026-09-19T10:10:00Z") },
      ],
    });
    await login(a);
    const res = await getMyNotifications();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.map((n) => n.title)).toEqual(["待办2", "待办1"]);
  });

  it("未读数只统计自己未读", async () => {
    const a = await seedAdmin("alice");
    await prisma.notification.createMany({
      data: [
        { adminId: a.id, title: "u1", isRead: false },
        { adminId: a.id, title: "r1", isRead: true },
      ],
    });
    await login(a);
    const res = await getUnreadNotificationCount();
    expect(res).toEqual({ success: true, data: 1 });
  });

  it("不带 ids 标记全部已读", async () => {
    const a = await seedAdmin("alice");
    await prisma.notification.createMany({
      data: [
        { adminId: a.id, title: "u1", isRead: false },
        { adminId: a.id, title: "u2", isRead: false },
      ],
    });
    await login(a);
    const res = await markNotificationsRead({});
    expect(res).toEqual({ success: true, data: { ok: true } });
    const unread = await prisma.notification.count({ where: { adminId: a.id, isRead: false } });
    expect(unread).toBe(0);
  });

  it("带 ids 只标记指定通知，不误标他人", async () => {
    const a = await seedAdmin("alice");
    const b = await seedAdmin("bob");
    const n1 = await prisma.notification.create({ data: { adminId: a.id, title: "n1" } });
    await prisma.notification.create({ data: { adminId: a.id, title: "n2" } });
    await prisma.notification.create({ data: { adminId: b.id, title: "b1" } });
    await login(a);
    const res = await markNotificationsRead({ ids: [n1.id] });
    expect(res).toEqual({ success: true, data: { ok: true } });
    const unread = await prisma.notification.count({ where: { adminId: a.id, isRead: false } });
    expect(unread).toBe(1); // n2 仍未读
  });
});
