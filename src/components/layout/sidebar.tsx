"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Package,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { navItems, NavItem, SECTION_ORDER } from "@/components/layout/nav-config"
import { useAuthStore } from "@/store/auth-store"

export function Sidebar({ mobileOpen }: { mobileOpen?: boolean }) {
  const pathname = usePathname()
  const permissions = useAuthStore((s) => s.permissions)

  // 权限裁剪：perm 缺省/空 → 登录即可见；否则需拥有该权限点
  const canSee = (perm?: string) => !perm || permissions == null || permissions.includes(perm)
  const visibleNav: NavItem[] = navItems.reduce<NavItem[]>((acc, item) => {
    if (item.children) {
      const children = item.children.filter((c) => canSee(c.perm))
      if (children.length === 0) return acc
      acc.push({ ...item, children })
    } else if (canSee(item.perm)) {
      acc.push(item)
    }
    return acc
  }, [])

  // 按分区分组（SECTION_ORDER 决定顺序，未列出的 section 追加）
  const sectionLabels = Array.from(
    new Set([
      ...SECTION_ORDER,
      ...visibleNav.map((n) => n.section || "工作台"),
    ])
  )
  const groups = sectionLabels
    .map((section) => ({ section, items: visibleNav.filter((n) => (n.section || "工作台") === section) }))
    .filter((g) => g.items.length > 0)

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar-collapsed") === "true"
    }
    return false
  })

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem("sidebar-collapsed", String(next))
  }

  const getDefaultExpanded = (): string[] => {
    const expanded: string[] = []
    for (const item of visibleNav) {
      if (item.children) {
        const childMatch = item.children.some((child) => pathname === child.href)
        if (childMatch) {
          expanded.push(item.href)
        }
      }
    }
    return expanded
  }

  const [expandedItems, setExpandedItems] = useState<string[]>(getDefaultExpanded)

  const toggleExpand = (href: string) => {
    setExpandedItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    )
  }

  const isActiveParent = (item: NavItem) => {
    if (!item.children) return false
    return item.children.some((child) => pathname === child.href)
  }

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    (item.href !== "/assets" && pathname.startsWith(item.href))

  return (
    <>
      {/* 逐项浮现动画 */}
      <style>{`
        .nav-enter { animation: navItemIn .4s cubic-bezier(.22,1,.36,1) both; }
        @keyframes navItemIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .nav-chev { transition: transform .28s cubic-bezier(.22,1,.36,1), color .2s; }
        .nav-chev.open { transform: rotate(180deg); }
      `}</style>

      {/* Desktop sidebar */}
      <div
        className={cn(
          "relative hidden md:flex h-full flex-col border-r border-border bg-sidebar transition-all duration-300",
          collapsed ? "w-14" : "w-60"
        )}
      >
        {/* 顶部柔和光晕（仅在展开态） */}
        {!collapsed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-0 h-28 opacity-60"
            style={{
              background:
                "radial-gradient(60% 100% at 15% 0%, hsl(var(--primary) / 0.07), transparent 70%)",
            }}
          />
        )}

        {/* Header */}
        <div
          className={cn(
            "relative z-10 flex h-16 items-center border-b border-border/70",
            collapsed ? "justify-center px-2" : "px-4"
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]">
            <Package className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="ml-3 min-w-0">
              <p className="truncate font-display text-[15px] leading-tight tracking-tight text-foreground">
                资产管理系统
              </p>
              <p className="text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground/60">
                Asset Center
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="relative z-10 flex-1 px-3 py-3">
          {collapsed ? (
            <nav className="sidebar-nav flex flex-col gap-1.5">
              {visibleNav.map((item) => {
                const isParentActive = isActiveParent(item)
                const active = isActive(item)

                if (item.children) {
                  return (
                    <Popover key={item.href}>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "flex w-full items-center justify-center rounded-lg p-2 transition-all duration-200",
                            isParentActive
                              ? "bg-primary/10 text-primary"
                              : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                          )}
                        >
                          <item.icon className="h-[18px] w-[18px] shrink-0" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" align="start" className="w-48 p-2">
                        <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                          {item.label}
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {item.children.map((child) => {
                            const isChildActive = pathname === child.href
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={cn(
                                  "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                                  isChildActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                                )}
                              >
                                {isChildActive && (
                                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                                )}
                                {child.label}
                              </Link>
                            )
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )
                }

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex w-full items-center justify-center rounded-lg p-2 transition-all duration-200",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-foreground/80 hover:bg-secondary hover:text-foreground"
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </nav>
          ) : (
            <nav className="sidebar-nav flex flex-col gap-0.5">
              {groups.map(({ section, items }) => (
                <div key={section} className="flex flex-col">
                  {/* 分区小标题 */}
                  <button
                    type="button"
                    className="mt-1 first:mt-0 flex items-center gap-2 px-2.5 py-1.5"
                    title={section}
                  >
                    <span className="h-[3px] w-[3px] rounded-full bg-primary/50" />
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/55">
                      {section}
                    </span>
                    <span className="pointer-events-none h-px flex-1 bg-gradient-to-r from-border/80 to-transparent" />
                  </button>

                  <div className="flex flex-col gap-0.5">
                    {items.map((item, index) => {
                      const isParentActive = isActiveParent(item)
                      const active = isActive(item)

                      if (item.children) {
                        const isExpanded = expandedItems.includes(item.href)
                        return (
                          <div className="nav-enter" style={{ animationDelay: `${index * 0.03}s` }} key={item.href}>
                            <button
                              onClick={() => toggleExpand(item.href)}
                              className={cn(
                                "group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13.5px] transition-all duration-200",
                                isParentActive
                                  ? "bg-primary/[0.07] text-primary"
                                  : "text-foreground/80 hover:bg-secondary/80 hover:text-foreground"
                              )}
                            >
                              {isParentActive && (
                                <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                              )}
                              <item.icon className={cn("h-[18px] w-[18px] shrink-0", isParentActive ? "text-primary" : "text-current opacity-90")} />
                              <span className="flex-1 text-left">{item.label}</span>
                              <ChevronDown
                                className={cn(
                                  "nav-chev h-4 w-4 shrink-0 text-muted-foreground/70 group-hover:text-foreground",
                                  isExpanded && "open text-primary"
                                )}
                              />
                            </button>
                            {isExpanded && (
                              <div className="mt-0.5 mb-1 ml-[13px] flex flex-col gap-0.5 border-l border-border/70 pl-3">
                                {item.children.map((child) => {
                                  const isChildActive = pathname === child.href
                                  return (
                                    <Link
                                      key={child.href}
                                      href={child.href}
                                      className={cn(
                                        "relative rounded-md px-3 py-[7px] text-[13.5px] transition-colors duration-150",
                                        isChildActive
                                          ? "text-primary"
                                          : "text-foreground/80 hover:bg-secondary/80 hover:text-foreground"
                                      )}
                                    >
                                      {isChildActive && (
                                        <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                                      )}
                                      {child.label}
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      }

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "nav-enter group relative flex items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13.5px] transition-all duration-200",
                            active
                              ? "bg-primary/[0.07] text-primary"
                              : "text-foreground/80 hover:bg-secondary/80 hover:text-foreground"
                          )}
                          style={{ animationDelay: `${index * 0.03}s` }}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                          )}
                          <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-current opacity-90")} />
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          )}
        </ScrollArea>

        {/* Toggle button */}
        <div className="border-t border-border/70 p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapsed}
                className={cn(
                  "w-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                  collapsed ? "justify-center px-2" : "justify-start px-3"
                )}
              >
                {collapsed ? (
                  <PanelLeft className="h-4 w-4 shrink-0" />
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4 shrink-0" />
                    <span className="ml-2 text-[13.5px] whitespace-nowrap">收起菜单</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {collapsed ? "展开菜单" : "收起菜单"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Mobile sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-card-foreground shadow-xl transition-transform duration-300 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center border-b border-border/70 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Package className="h-5 w-5" />
          </div>
          <div className="ml-3 min-w-0">
            <p className="truncate font-display text-[15px] font-semibold leading-tight text-foreground">
              资产管理系统
            </p>
          </div>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-3">
          <nav className="sidebar-nav flex flex-col gap-0.5">
            {groups.map(({ section, items }) => (
              <div key={section} className="flex flex-col">
                <p className="mt-1 first:mt-0 mb-1 flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/55">
                  <span className="h-[3px] w-[3px] rounded-full bg-primary/50" />
                  {section}
                </p>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const isParentActive = isActiveParent(item)

                    if (item.children) {
                      const isExpanded = expandedItems.includes(item.href)
                      return (
                        <div key={item.href}>
                          <button
                            onClick={() => toggleExpand(item.href)}
                            className={cn(
                              "relative flex w-full items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13.5px] transition-all duration-200",
                              isParentActive
                                ? "bg-primary/[0.07] text-primary"
                                : "text-foreground/80 hover:bg-secondary/80 hover:text-foreground"
                            )}
                          >
                            <item.icon className="h-[18px] w-[18px] shrink-0" />
                            <span className="flex-1 text-left">{item.label}</span>
                            <ChevronDown
                              className={cn(
                                "nav-chev h-4 w-4 shrink-0 text-muted-foreground/70",
                                isExpanded && "open text-primary"
                              )}
                            />
                          </button>
                          {isExpanded && (
                            <div className="mt-0.5 mb-1 ml-[13px] flex flex-col gap-0.5 border-l border-border/70 pl-3">
                              {item.children.map((child) => {
                                const isChildActive = pathname === child.href
                                return (
                                  <Link
                                    key={child.href}
                                    href={child.href}
                                    onClick={() => {}}
                                    className={cn(
                                      "relative rounded-md px-3 py-[7px] text-[13.5px] transition-colors duration-150",
                                      isChildActive
                                        ? "text-primary"
                                        : "text-foreground/80 hover:bg-secondary/80 hover:text-foreground"
                                    )}
                                  >
                                    {isChildActive && (
                                      <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                                    )}
                                    {child.label}
                                  </Link>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    }

                    const active = isActive(item)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => {}}
                        className={cn(
                          "relative flex items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13.5px] transition-all duration-200",
                          active
                            ? "bg-primary/[0.07] text-primary"
                            : "text-foreground/80 hover:bg-secondary/80 hover:text-foreground"
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                        )}
                        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-current opacity-90")} />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </div>
    </>
  )
}