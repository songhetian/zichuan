"use client"

import { useEffect, useState } from "react"
import { useAuthStore } from "@/store/auth-store"
import { useRouter, usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogOut, Menu, Bell, ChevronRight } from "lucide-react"
import Link from "next/link"
import { CommandPalette } from "@/components/features/command-palette"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { logout } from "@/actions/auth.actions"
import { useNotificationStore } from "@/store/notification-store"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  getMyNotifications,
  markNotificationsRead,
} from "@/actions/notification.actions"
import { formatTime } from "@/lib/utils"
import type { NotificationType } from "@prisma/client"

const TYPE_LABELS: Record<NotificationType, string> = {
  APPROVAL_TODO: "待办",
  APPROVAL_RESULT: "结果",
  APPROVAL_CC: "抄送",
  SYSTEM: "系统",
}

type BellItem = {
  id: number;
  requestId: number | null;
  title: string;
  content: string | null;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
}

export function Header({ mobileMenuOpen, onMobileMenuToggle }: { mobileMenuOpen?: boolean; onMobileMenuToggle?: () => void }) {
  const { username } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const unread = useNotificationStore((s) => s.unread)
  const refresh = useNotificationStore((s) => s.refresh)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BellItem[]>([])
  const [loading, setLoading] = useState(false)

  // 路由变化时对齐未读数（通知中心/详情页处理完通知后刷新角标）
  useEffect(() => {
    refresh()
  }, [pathname, refresh])

  // 打开弹框时加载未读消息（最多 8 条）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    getMyNotifications().then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.success) {
        setItems(
          res.data
            .filter((n) => !n.isRead)
            .slice(0, 8)
            .map((n) => ({
              ...n,
              createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
            }))
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const handleOpenItem = async (n: BellItem) => {
    setOpen(false)
    if (!n.isRead) {
      await markNotificationsRead({ ids: [n.id] })
      await refresh()
    }
    if (n.requestId != null) {
      router.push(`/approvals/${n.requestId}`)
    }
  }

  const handleLogout = async () => {
    await logout()
    router.push("/login")
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card/70 px-4 md:px-6 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={onMobileMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="text-sm text-muted-foreground">
          当前用户：<span className="font-medium text-foreground">{username}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <CommandPalette />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="relative" aria-label="通知中心">
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-medium text-foreground">未读消息</span>
              {unread > 0 && (
                <span className="text-xs text-muted-foreground">{unread} 条未读</span>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  加载中...
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  暂无未读消息
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => handleOpenItem(n)}
                        className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          <span className="truncate text-sm font-medium text-foreground">
                            {n.title}
                          </span>
                          <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {TYPE_LABELS[n.type] ?? n.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 pl-4">
                          {n.content && (
                            <span className="truncate text-xs text-muted-foreground">
                              {n.content}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {formatTime(n.createdAt)}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-border">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1 px-4 py-2.5 text-sm text-primary transition-colors hover:bg-accent"
              >
                查看全部
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </Button>
      </div>
    </header>
  )
}
