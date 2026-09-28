"use client"

import {
  ColumnDef,
  Column,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
  ExpandedState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { PagePagination } from "@/components/ui/page-pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useState, useEffect, Fragment, type CSSProperties } from "react"
import { Search, Inbox, ArrowUpDown } from "lucide-react"

// TanStack 默认列宽为 150。为让 table-fixed 按预期分布列宽，
// 必须给 ALL 列都写入真实宽度（否则未设宽度的列会被挤到几乎 0，导致换行错位）。
const DEFAULT_COLUMN_SIZE = 150

function getColStyle<TData, TValue>(column: Column<TData, TValue>): CSSProperties {
  const size = column.getSize() ?? DEFAULT_COLUMN_SIZE
  const maxSize = column.columnDef.maxSize
  const style: CSSProperties = { width: `${size}px` }
  // maxSize 默认值极大（MAX_SAFE_INTEGER），仅当显式设置且非默认时才应用
  if (typeof maxSize === "number" && maxSize < 100000) {
    style.maxWidth = `${maxSize}px`
  }
  return style
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  enableRowSelection?: boolean
  onRowSelectionChange?: (selectedRows: TData[]) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
  defaultSorting?: SortingState
  /** 隐藏内置客户端分页控件（配合服务端分页，由外部 PagePagination 驱动） */
  hidePagination?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  enableRowSelection = false,
  onRowSelectionChange,
  renderExpandedRow,
  defaultSorting = [],
  hidePagination = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = useState({})
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // hidePagination 时由外部服务端分页提供数据，禁用内置分页模型
    getPaginationRowModel: hidePagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: renderExpandedRow ? getExpandedRowModel() : undefined,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    enableRowSelection,
    state: { sorting, columnFilters, rowSelection, expanded },
    initialState: {
      pagination: { pageSize: 10 },
    },
  })

  // 通知父组件选中行变化
  useEffect(() => {
    if (onRowSelectionChange) {
      const selectedRows = table.getFilteredSelectedRowModel().rows.map(row => row.original)
      onRowSelectionChange(selectedRows)
    }
  }, [rowSelection, onRowSelectionChange, table])

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
        <Table className="table-fixed w-full">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="group sticky top-0 z-10 bg-secondary/80 backdrop-blur-md border-b border-border/80">
                {headerGroup.headers.map((header) => {
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)?.align
                  const alignClass = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"
                  return (
                  <TableHead key={header.id} style={getColStyle(header.column)} className={`font-medium h-11 text-sm text-muted-foreground whitespace-nowrap ${alignClass}`}>
                    {header.isPlaceholder
                      ? null
                      : header.column.getCanSort() ? (
                          <button
                            onClick={header.column.getToggleSortingHandler()}
                            className={`relative flex items-center w-full h-full text-muted-foreground hover:text-foreground transition-colors ${align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center"}`}
                          >
                            <span className="whitespace-nowrap">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            {/* 排序图标绝对定位在列末尾，不占位，避免表头文字相对内容错位 */}
                            <ArrowUpDown className={`absolute right-1 h-3 w-3 shrink-0 ${header.column.getIsSorted() === 'asc' ? 'rotate-0 opacity-100' : header.column.getIsSorted() === 'desc' ? 'rotate-180 opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                  </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, rowIndex) => (
                <Fragment key={row.id}>
                    <TableRow
                      key={`row-${row.id}`}
                      data-state={row.getIsSelected() && "selected"}
                      className={`group transition-colors duration-150 ${rowIndex % 2 === 1 ? 'bg-muted/[0.07]' : ''} border-b border-border/60 hover:bg-accent/30 ${renderExpandedRow ? 'cursor-pointer' : ''} ${row.getIsSelected() ? '!bg-primary/[0.08] border-l-2 border-l-primary' : ''}`}
                      onClick={renderExpandedRow ? () => row.toggleExpanded() : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align
                        const alignClass = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"
                        return (
                        <TableCell key={cell.id} style={getColStyle(cell.column)} className={`py-2.5 align-middle ${alignClass}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                      )
                    })}
                  </TableRow>
                  {row.getIsExpanded() && renderExpandedRow && (
                    <TableRow key={`expanded-${row.id}`}>
                      <TableCell colSpan={columns.length} className="p-0">
                        {renderExpandedRow(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2.5">
                    {data.length === 0 ? (
                      <>
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30">
                          <Inbox className="h-6 w-6 text-muted-foreground/60" />
                        </span>
                        <p className="text-sm text-muted-foreground">暂无数据</p>
                      </>
                    ) : (
                      <>
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30">
                          <Search className="h-6 w-6 text-muted-foreground/60" />
                        </span>
                        <p className="text-sm text-muted-foreground">未找到匹配的记录</p>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {!hidePagination && table.getRowModel().rows.length > 0 && (
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            共 {table.getFilteredRowModel().rows.length} 条
          </span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(v) => table.setPageSize(Number(v))}
          >
            <SelectTrigger className="h-7 w-[80px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 条/页</SelectItem>
              <SelectItem value="20">20 条/页</SelectItem>
              <SelectItem value="50">50 条/页</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <PagePagination
          current={table.getState().pagination.pageIndex + 1}
          total={table.getPageCount()}
          onPageChange={(page) => table.setPageIndex(page - 1)}
        />
      </div>
      )}
    </div>
  )
}