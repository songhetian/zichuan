"use client"
import { ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, RotateCcw } from "lucide-react"

interface FilterItem {
  key: string
  content: ReactNode
}

interface FilterBarProps {
  items: FilterItem[]
  searchValue?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void
  onReset?: () => void
  /** 是否显示重置按钮，默认 false */
  showReset?: boolean
}

export function FilterBar({
  items,
  searchValue,
  searchPlaceholder = "搜索...",
  onSearchChange,
  onReset,
  showReset = false,
}: FilterBarProps) {
  const hasFilters = items.length > 0 || onSearchChange

  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <div key={item.key}>{item.content}</div>
      ))}
      {onSearchChange && (
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchValue || ""}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
      )}
      {showReset && onReset && (
        <Button type="button" variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重置
        </Button>
      )}
    </div>
  )
}
