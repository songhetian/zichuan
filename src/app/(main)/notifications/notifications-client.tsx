"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatTime } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  getMyNotifications,
  markNotificationsRead,
} from "@/actions/notification.actions";
import { useNotificationStore } from "@/store/notification-store";
import type { NotificationType } from "@prisma/client";

type NotificationItem = {
  id: number;
  requestId: number | null;
  title: string;
  content: string | null;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
};

const TYPE_LABELS: Record<NotificationItem["type"], string> = {
  APPROVAL_TODO: "待办",
  APPROVAL_RESULT: "结果",
  APPROVAL_CC: "抄送",
  SYSTEM: "系统",
};

/** 类型 Tabs：空串 = 全部 */
const TYPE_TABS: { value: "" | NotificationItem["type"]; label: string }[] = [
  { value: "", label: "全部" },
  { value: "APPROVAL_TODO", label: "待办" },
  { value: "APPROVAL_RESULT", label: "结果" },
  { value: "APPROVAL_CC", label: "抄送" },
  { value: "SYSTEM", label: "系统" },
];

export function NotificationsClient() {
  const { toast } = useToast();
  const router = useRouter();
  const refreshUnread = useNotificationStore((s) => s.refresh);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"" | NotificationItem["type"]>("");

  const load = useCallback(async () => {
    const result = await getMyNotifications();
    setLoading(false);
    if (result.success) {
      setItems(
        result.data.map((n) => ({
          ...n,
          createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
        }))
      );
    } else {
      toast({ title: "加载失败", description: result.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReadAll = async () => {
    const r = await markNotificationsRead({});
    if (r.success) {
      await load();
      await refreshUnread();
    } else {
      toast({ title: "操作失败", description: r.error, variant: "destructive" });
    }
  };

  const handleOpen = async (n: NotificationItem) => {
    if (!n.isRead) {
      await markNotificationsRead({ ids: [n.id] });
      await refreshUnread();
    }
    if (n.requestId != null) {
      router.push(`/approvals/${n.requestId}`);
    }
  };

  const unreadCount = items.filter((n) => !n.isRead).length;
  const visibleItems = typeFilter ? items.filter((n) => n.type === typeFilter) : items;
  const visibleUnreadCount = visibleItems.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-4">
      <PageHeader title="通知中心" description="审批动态与站内消息" />

      {/* ---- 类型分组 Tabs ---- */}
      <div className="flex items-center gap-1 border-b" role="tablist" aria-label="通知类型">
        {TYPE_TABS.map((tab) => {
          const tabUnread = tab.value === "" ? unreadCount : items.filter((n) => n.type === tab.value && !n.isRead).length;
          const active = typeFilter === tab.value;
          return (
            <button
              key={tab.value || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTypeFilter(tab.value)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tabUnread > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-px text-xs text-primary">
                  {tabUnread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {TYPE_TABS.find((t) => t.value === typeFilter)?.label ?? "全部"}通知
              {visibleUnreadCount > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {visibleUnreadCount} 条未读
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={load}>
                刷新
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleReadAll}
                disabled={unreadCount === 0}
              >
                全部已读
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {visibleItems.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleOpen(n)}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-md px-3 py-3 text-left transition-colors hover:bg-accent",
                    !n.isRead && "bg-primary/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!n.isRead && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <span
                      className={cn(
                        "text-sm",
                        n.isRead ? "text-muted-foreground" : "font-medium text-foreground"
                      )}
                    >
                      {n.title}
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {TYPE_LABELS[n.type] ?? n.type}
                    </span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatTime(n.createdAt)}
                    </span>
                  </div>
                  {n.content && (
                    <span className="pl-4 text-sm text-muted-foreground">{n.content}</span>
                  )}
                </button>
              </li>
            ))}
            {items.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">
                {loading ? "加载中..." : "暂无通知"}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
