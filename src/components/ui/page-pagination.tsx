"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface PagePaginationProps {
  current: number
  total: number
  onPageChange: (page: number) => void
  showQuickJump?: boolean
}

/**
 * 生成页码数组，多于7页时用 -1 表示省略号
 */
function getPageNumbers(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: number[] = [1]

  if (current <= 3) {
    // 当前页靠前：1 2 3 4 ... N
    for (let i = 2; i <= 4; i++) pages.push(i)
    pages.push(-1, total)
  } else if (current >= total - 2) {
    // 当前页靠后：1 ... N-3 N-2 N-1 N
    pages.push(-1)
    for (let i = total - 3; i < total; i++) pages.push(i)
    pages.push(total)
  } else {
    // 中间：1 ... cur-1 cur cur+1 ... N
    pages.push(-1)
    pages.push(current - 1, current, current + 1)
    pages.push(-1, total)
  }

  return pages
}

export function PagePagination({
  current,
  total,
  onPageChange,
  showQuickJump = true,
}: PagePaginationProps) {
  const pages = useMemo(() => getPageNumbers(current, total), [current, total])
  const [jumpValue, setJumpValue] = useState("")

  if (total <= 1) return null

  const handleJump = () => {
    const page = parseInt(jumpValue, 10)
    if (!isNaN(page) && page >= 1 && page <= total && page !== current) {
      onPageChange(page)
    }
    setJumpValue("")
  }

  return (
    <div className="flex items-center gap-1">
      {showQuickJump && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onPageChange(1)}
          disabled={current === 1}
          title="首页"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onPageChange(current - 1)}
        disabled={current === 1}
        aria-label="上一页"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>

      {pages.map((page, idx) =>
        page === -1 ? (
          <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted-foreground select-none">
            ...
          </span>
        ) : (
          <Button
            key={page}
            variant={page === current ? "default" : "outline"}
            size="sm"
            className={`h-7 min-w-[28px] px-1 p-0 text-xs ${page === current ? "pointer-events-none" : ""}`}
            onClick={() => onPageChange(page)}
          >
            {page}
          </Button>
        )
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onPageChange(current + 1)}
        disabled={current === total}
        aria-label="下一页"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      {showQuickJump && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onPageChange(total)}
          disabled={current === total}
          title="末页"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      )}
      {/* 页码跳转输入 */}
      {total > 3 && (
        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-muted-foreground">跳至</span>
          <Input
            type="number"
            min={1}
            max={total}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleJump(); }}
            onBlur={handleJump}
            className="h-7 w-12 text-xs text-center px-1"
            placeholder=""
          />
          <span className="text-xs text-muted-foreground">页</span>
        </div>
      )}
    </div>
  )
}
