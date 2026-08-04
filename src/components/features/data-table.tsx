"use client"

import {
  ColumnDef,
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
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { PagePagination } from "@/components/ui/page-pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useState, useEffect } from "react"
import { Search, Inbox, ArrowUpDown, X } from "lucide-react"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchKey?: string
  searchPlaceholder?: string
  enableRowSelection?: boolean
  onRowSelectionChange?: (selectedRows: TData[]) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "搜索...",
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
      {searchKey && (
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <div className="relative max-w-sm w-full">
            <Input
              placeholder={searchPlaceholder}
              value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
              onChange={(e) =>
                table.getColumn(searchKey)?.setFilterValue(e.target.value)
              }
              className="pr-8"
            />
            {(table.getColumn(searchKey)?.getFilterValue() as string) && (
              <button
                type="button"
                onClick={() => table.getColumn(searchKey)?.setFilterValue("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/40 border-b border-border hover:bg-muted/40">
                {headerGroup.headers.map((header) => {
                  const align = (header.column.columnDef.meta as { align?: string } | undefined)?.align
                  const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"
                  return (
                  <TableHead key={header.id} className={`font-normal min-w-[80px] h-11 text-sm text-muted-foreground ${alignClass}`}>
                    {header.isPlaceholder
                      ? null
                      : header.column.getCanSort() ? (
                          <button
                            onClick={header.column.getToggleSortingHandler()}
                            className={`flex items-center gap-1 w-full h-full text-muted-foreground hover:text-foreground transition-colors ${align === "center" ? "justify-center" : "justify-start"}`}
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
                <>
                  <TableRow
                    key={`row-${row.id}`}
                    data-state={row.getIsSelected() && "selected"}
                    className={`group transition-colors duration-150 ${rowIndex % 2 === 1 ? 'bg-muted/15' : ''} hover:bg-accent/50 ${renderExpandedRow ? 'cursor-pointer' : ''} ${row.getIsSelected() ? '!bg-primary/8 border-l-2 border-l-primary' : ''}`}
                    onClick={renderExpandedRow ? () => row.toggleExpanded() : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align
                      const alignClass = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"
                      return (
                      <TableCell key={cell.id} className={`py-2.5 align-top ${alignClass}`}>
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
                </>
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