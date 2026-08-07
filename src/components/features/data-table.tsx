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

// TanStack 默认列宽为 150，未显式设置 size 的列都会落到这个值。
// 为避免把所有列都强制成 150px（反而破坏自适应），仅对"非默认宽度"应用 style.width。
const DEFAULT_COLUMN_SIZE = 150

// 将列的 size / maxSize 映射为真实单元格样式，使列宽约束真正生效
// （TanStack 默认不会自动把 size 写到 DOM，导致列宽全靠浏览器自由分配 → "布局怪"）
function getColStyle<TData, TValue>(column: Column<TData, TValue>): CSSProperties {
  const size = column.getSize()
  const maxSize = column.columnDef.maxSize
  const style: CSSProperties = {}
  if (typeof size === "number" && size !== DEFAULT_COLUMN_SIZE) {
    style.width = `${size}px`
  }
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
}

export function DataTable<TData, TValue>({
  columns,
  data,
  enableRowSelection = false,
  onRowSelectionChange,
  renderExpandedRow,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = useState({})
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
      <div className="rounded-lg border border-border overflow-auto max-h-[70vh]">
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="group sticky top-0 z-10 bg-muted border-b border-border">
                {headerGroup.headers.map((header) => {
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)?.align
                  const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"
                  return (
                  <TableHead key={header.id} style={getColStyle(header.column)} className={`font-medium h-11 text-sm text-muted-foreground ${alignClass}`}>
                    {header.isPlaceholder
                      ? null
                      : header.column.getCanSort() ? (
                          <button
                            onClick={header.column.getToggleSortingHandler()}
                            className={`flex items-center gap-1 w-full h-full text-muted-foreground hover:text-foreground transition-colors ${align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start"}`}
                          >
                            <span className="whitespace-nowrap">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <ArrowUpDown className={`h-3 w-3 shrink-0 ${header.column.getIsSorted() === 'asc' ? 'rotate-0' : header.column.getIsSorted() === 'desc' ? 'rotate-180' : 'opacity-0 group-hover:opacity-50'}`} />
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
                      className={`group transition-colors duration-150 ${rowIndex % 2 === 1 ? 'bg-muted/10' : ''} hover:bg-accent/50 ${renderExpandedRow ? 'cursor-pointer' : ''} ${row.getIsSelected() ? '!bg-primary/10 border-l-2 border-l-primary' : ''}`}
                      onClick={renderExpandedRow ? () => row.toggleExpanded() : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align
                        const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"
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
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2">
                    {data.length === 0 ? (
                      <>
                        <Inbox className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-muted-foreground">暂无数据</p>
                      </>
                    ) : (
                      <>
                        <Search className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-muted-foreground">未找到匹配的记录</p>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {table.getRowModel().rows.length > 0 && (
      <div className="flex items-center justify-between py-1">
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