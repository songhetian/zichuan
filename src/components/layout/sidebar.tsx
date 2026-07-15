"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Monitor, Cpu, Users, ArrowRightLeft,
  ClipboardCheck, Settings, FileText, Package,
  LayoutGrid, ChevronDown, LayoutDashboard,
  PanelLeftClose, PanelLeft,
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

interface SubItem {
  href: string
  label: string
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  children?: SubItem[]
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "首页", icon: LayoutDashboard },
  {
    href: "/assets",
    label: "设备管理",
    icon: Monitor,
    children: [
      { href: "/assets", label: "设备列表" },
      { href: "/templates", label: "设备模板" },
    ],
  },
  {
    href: "/components",
    label: "配件管理",
    icon: Cpu,
    children: [
      { href: "/components/models", label: "配件库存" },
      { href: "/components/stock", label: "库存流水" },
    ],
  },
  { href: "/employees", label: "员工管理", icon: Users },
  { href: "/stocktake", label: "库存盘点", icon: ClipboardCheck },
  { href: "/logs", label: "系统日志", icon: FileText },
  {
    href: "/settings",
    label: "系统设置",
    icon: Settings,
    children: [
      { href: "/settings/departments", label: "部门管理" },
      { href: "/settings/asset-categories", label: "设备分类" },
      { href: "/settings/component-categories", label: "配件分类" },
      { href: "/settings/labels", label: "标签打印" },
      { href: "/settings/account", label: "账号设置" },
    ],
  },
]

export function Sidebar({ mobileOpen }: { mobileOpen?: boolean }) {
  const pathname = usePathname()

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
    for (const item of navItems) {
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
      {/* Desktop sidebar */}
      <div
        className={cn(
          "hidden md:flex h-full flex-col border-r border-border bg-card transition-all duration-300",
          collapsed ? "w-14" : "w-56"
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex h-14 items-center border-b border-border",
            collapsed ? "justify-center px-2" : "px-4"
          )}
        >
          <Package className="h-5 w-5 shrink-0 text-primary" />
          {!collapsed && (
            <span className="ml-2 text-base font-semibold whitespace-nowrap text-foreground">资产管理系统</span>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-2">
          <nav className="sidebar-nav flex flex-col gap-1">
            {navItems.map((item) => {
              const isParentActive = isActiveParent(item)

              if (item.children) {
                if (collapsed) {
                  return (
                    <Popover key={item.href}>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "flex w-full items-center justify-center rounded-md p-2 text-sm transition-colors",
                            isParentActive
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="right" align="start" className="w-48 p-2">
                        <p className="px-2 py-1.5 text-sm font-medium text-muted-foreground">
                          {item.label}
                        </p>
                        <div className="flex flex-col gap-1">
                          {item.children.map((child) => {
                            const isChildActive = pathname === child.href
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                className={cn(
                                  "rounded-md px-3 py-2 text-sm transition-colors",
                                  isChildActive
                                    ? "text-primary font-medium bg-accent"
                                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                                )}
                              >
                                {child.label}
                              </Link>
                            )
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )
                }

                const isExpanded = expandedItems.includes(item.href)

                return (
                  <div key={item.href}>
                    <button
                      onClick={() => toggleExpand(item.href)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isParentActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="flex flex-col gap-1 mt-1">
                        {item.children.map((child) => {
                          const isChildActive = pathname === child.href
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                "rounded-md px-3 py-2 pl-10 text-sm transition-colors",
                                isChildActive
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                              )}
                            >
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

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                    href={item.href}
                    className={cn(
                      "flex w-full items-center justify-center rounded-md p-2 text-sm transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                        <item.icon className="h-4 w-4 shrink-0" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </ScrollArea>

        {/* Toggle button */}
        <div className="border-t border-border p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapsed}
                className={cn(
                  "w-full text-muted-foreground hover:bg-secondary hover:text-foreground",
                  collapsed ? "justify-center px-2" : "justify-start px-3"
                )}
              >
                {collapsed ? (
                  <PanelLeft className="h-4 w-4 shrink-0" />
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4 shrink-0" />
                    <span className="ml-2 text-sm whitespace-nowrap">收起菜单</span>
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
          "fixed inset-y-0 left-0 z-50 w-64 bg-card text-card-foreground shadow-xl transition-transform duration-300 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-14 items-center border-b border-border px-4">
          <Package className="h-6 w-6 shrink-0 text-primary" />
          <span className="ml-2 text-base font-semibold whitespace-nowrap text-foreground">资产管理系统</span>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-2">
          <nav className="sidebar-nav flex flex-col gap-1">
            {navItems.map((item) => {
              const isParentActive = isActiveParent(item)

              if (item.children) {
                const isExpanded = expandedItems.includes(item.href)

                return (
                  <div key={item.href}>
                    <button
                      onClick={() => toggleExpand(item.href)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        isParentActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="flex flex-col gap-1 mt-1">
                        {item.children.map((child) => {
                          const isChildActive = pathname === child.href
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => {}}
                              className={cn(
                                "rounded-md px-3 py-2 pl-10 text-sm transition-colors",
                                isChildActive
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                              )}
                            >
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
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </ScrollArea>
      </div>
    </>
  )
}