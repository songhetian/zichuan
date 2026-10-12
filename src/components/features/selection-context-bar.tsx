"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SelectionSummary } from "@/lib/asset-selection-summary"

interface SelectionContextBarProps {
  summary: SelectionSummary
  /** 该分类的分配规则说明（如「唯一分类：每人仅限一台」），无则省略整行 */
  ruleText?: string
  icon: LucideIcon
  accentClassName?: string
  className?: string
}

/**
 * 分配/调拨弹窗顶部的「设备上下文条」。
 *
 * 原先这些弹窗只有一个标题 + 一个下拉，看不出正在操作哪台设备（单台分配点错了
 * 也不知道）。这里统一把「几台 / 什么分类 / 编号区间 / 触发的分配规则」摆在最上面。
 */
export function SelectionContextBar({
  summary,
  ruleText,
  icon: Icon,
  accentClassName = "text-primary",
  className,
}: SelectionContextBarProps) {
  if (summary.count === 0) return null

  return (
    <div className={cn("rounded-lg border border-border bg-muted/40 px-3 py-2", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", accentClassName)} />
        <span className="font-medium text-foreground">{summary.count} 台</span>
        {summary.categoryText ? (
          <span className="text-muted-foreground">· {summary.categoryText}</span>
        ) : null}
        {summary.assetNoRange ? (
          <span className="font-mono text-muted-foreground">{summary.assetNoRange}</span>
        ) : null}
      </div>
      {ruleText ? (
        <div className="mt-1 pl-[22px] text-xs text-muted-foreground">{ruleText}</div>
      ) : null}
    </div>
  )
}
