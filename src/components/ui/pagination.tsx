"use client"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationProps {
  total: number
  current: number
  pageSize?: number
  /** 是否显示每页条数选择器 */
  showSizeChanger?: boolean
  /** 是否显示"共 X 条记录" */
  showTotal?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
}

const PAGE_SIZE_OPTIONS = [10, 20, 50]

export function Pagination({
  total,
  current,
  pageSize = 10,
  showSizeChanger = false,
  showTotal = true,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-3">
        {showTotal && (
          <span className="text-xs text-muted-foreground">
            共 {total} 条记录
          </span>
        )}
        {showSizeChanger && onPageSizeChange && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>每页</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s.toString()} className="text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>条</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onPageChange(Math.max(1, current - 1))}
          disabled={current <= 1}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs px-1 min-w-[3rem] text-center">
          {current} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onPageChange(Math.min(totalPages, current + 1))}
          disabled={current >= totalPages}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}