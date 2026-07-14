"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Monitor, Cpu, Users, ArrowRightLeft,
  ClipboardCheck, BarChart3, Settings, FileText, Package,
  LayoutGrid, Wrench, ChevronDown,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"

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
  { href: "/assets", label: "设备管理", icon: Monitor },
  { href: "/templates", label: "设备模板", icon: LayoutGrid },
  {
    href: "/components",
    label: "配件库存",
    icon: Cpu,
    children: [
      { href: "/components/models", label: "配件型号" },
      { href: "/components/stock", label: "库存流水" },
    ],
  },
  { href: "/employees", label: "员工管理", icon: Users },
  { href: "/stocktake", label: "库存盘点", icon: ClipboardCheck },
  { href: "/stats", label: "统计报表", icon: BarChart3 },
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

export function Sidebar() {
  const pathname = usePathname()

  // Determine which parent menus should be expanded by default
  const getDefaultExpanded = (): string[] => {
    const expanded: string[] = []
    for (const item of navItems) {
      if (item.children) {
        const childMatch = item.children.some(
          (child) => pathname === child.href
        )
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
      prev.includes(href)
        ? prev.filter((h) => h !== href)
        : [...prev, href]
    )
  }

  const isActiveParent = (item: NavItem) => {
    if (!item.children) return false
    return item.children.some(
      (child) => pathname === child.href
    )
  }

  return (
    <div className="hidden md:flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Package className="h-6 w-6 text-primary" />
        <span className="ml-2 text-lg font-semibold">资产管理系统</span>
      </div>
      <ScrollArea className="flex-1 px-3 py-2">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            if (item.children) {
              const isExpanded = expandedItems.includes(item.href)
              const isParentActive = isActiveParent(item)

              return (
                <div key={item.href}>
                  <button
                    onClick={() => toggleExpand(item.href)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isParentActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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

            // No children - simple link
            const isActive =
              pathname === item.href ||
              (item.href !== "/assets" && pathname.startsWith(item.href))

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </ScrollArea>
    </div>
  )
}