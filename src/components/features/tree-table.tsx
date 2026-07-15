"use client"

import { useState, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChevronRight, ChevronDown, GripVertical } from "lucide-react"

export interface TreeNode {
  id: number
  name: string
  parentId: number | null
  children?: TreeNode[]
  [key: string]: any
}

interface TreeTableColumn<T extends TreeNode> {
  key: string
  header: string
  width?: string
  align?: "left" | "center" | "right"
  render?: (node: T) => React.ReactNode
}

interface TreeTableProps<T extends TreeNode> {
  data: T[]
  columns: TreeTableColumn<T>[]
  /** 操作列渲染 */
  actions?: (node: T) => React.ReactNode
  /** 每页条数 */
  pageSize?: number
  /** 空状态文案 */
  emptyText?: string
  /** 删除确认描述（用于显示实体名称） */
  getDeleteDescription?: (node: T) => string
  /** 是否启用拖拽排序 */
  draggable?: boolean
  /** 拖拽结束回调 */
  onDragEnd?: (draggedId: number, targetId: number, position: 'before' | 'after' | 'inside') => void
}

function buildTree<T extends TreeNode>(flat: T[]): T[] {
  const map = new Map<number, T>()
  const roots: T[] = []

  for (const item of flat) {
    map.set(item.id, { ...item, children: [] } as any)
  }

  for (const item of flat) {
    const node = map.get(item.id)!
    if (item.parentId != null && map.has(item.parentId)) {
      const parent = map.get(item.parentId)!
      if (!parent.children) parent.children = [] as any
      parent.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function flattenTree<T extends TreeNode>(tree: T[], depth: number = 0): (T & { _depth: number })[] {
  const result: (T & { _depth: number })[] = []
  for (const node of tree) {
    result.push({ ...node, _depth: depth } as any)
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children as T[], depth + 1))
    }
  }
  return result
}

export function TreeTable<T extends TreeNode>({
  data,
  columns,
  actions,
  pageSize = 10,
  emptyText = "暂无数据",
  draggable = false,
  onDragEnd,
}: TreeTableProps<T>) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set(data.map((c) => c.id)))
  const [page, setPage] = useState(1)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null)

  const tree = useMemo(() => buildTree(data), [data])
  const flatRows = useMemo(() => flattenTree(tree), [tree])

  const visibleRows = useMemo(() => {
    const result: (T & { _depth: number })[] = []
    for (const row of flatRows) {
      if (row.parentId != null && !expandedIds.has(row.parentId)) continue
      result.push(row)
    }
    return result
  }, [flatRows, expandedIds])

  const pagedRows = visibleRows.slice((page - 1) * pageSize, page * pageSize)

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasChildren = (id: number) => data.some((c) => c.parentId === id)

  const handleDragStart = useCallback((e: React.DragEvent, id: number) => {
    if (!draggable) return
    setDraggedId(id)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", String(id))
  }, [draggable])

  const handleDragOver = useCallback((e: React.DragEvent, targetId: number) => {
    if (!draggable || draggedId === null || draggedId === targetId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const height = rect.height

    let position: 'before' | 'after' | 'inside'
    if (y < height * 0.25) {
      position = 'before'
    } else if (y > height * 0.75) {
      position = 'after'
    } else {
      position = 'inside'
    }

    setDropTargetId(targetId)
    setDropPosition(position)
  }, [draggable, draggedId])

  const handleDragLeave = useCallback(() => {
    setDropTargetId(null)
    setDropPosition(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: number) => {
    if (!draggable || draggedId === null || draggedId === targetId) return
    e.preventDefault()

    if (dropPosition && onDragEnd) {
      onDragEnd(draggedId, targetId, dropPosition)
    }

    setDraggedId(null)
    setDropTargetId(null)
    setDropPosition(null)
  }, [draggable, draggedId, dropPosition, onDragEnd])

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDropTargetId(null)
    setDropPosition(null)
  }, [])

  return (
    <div className="space-y-2">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10" />
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={col.width ? `w-${col.width}` : ""}
                  style={{ width: col.width, textAlign: col.align || "left" }}
                >
                  {col.header}
                </TableHead>
              ))}
              {actions && <TableHead className="w-24 text-center">操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.length > 0 ? (
              pagedRows.map((row) => {
                const isParent = hasChildren(row.id)
                const isExpanded = expandedIds.has(row.id)
                const isDragging = draggedId === row.id
                const isDropTarget = dropTargetId === row.id
                return (
                  <TableRow
                    key={row.id}
                    draggable={draggable}
                    onDragStart={(e) => handleDragStart(e, row.id)}
                    onDragOver={(e) => handleDragOver(e, row.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, row.id)}
                    onDragEnd={handleDragEnd}
                    className={`relative ${isDragging ? 'opacity-50' : ''} ${
                      isDropTarget && dropPosition === 'inside' ? 'bg-primary/10' : ''
                    }`}
                  >
                    {isDropTarget && dropPosition === 'before' && (
                      <td colSpan={columns.length + (actions ? 3 : 2)} className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10 -translate-y-1/2 pointer-events-none" style={{ position: 'absolute', top: 0 }} />
                    )}
                    {isDropTarget && dropPosition === 'after' && (
                      <td colSpan={columns.length + (actions ? 3 : 2)} className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10 translate-y-1/2 pointer-events-none" style={{ position: 'absolute', bottom: 0 }} />
                    )}
                    <TableCell className="w-10">
                      <div className="flex items-center gap-1">
                        {draggable && (
                          <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                            <GripVertical className="h-4 w-4" />
                          </div>
                        )}
                        {isParent ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggleExpand(row.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <span className="w-6 inline-block" />
                        )}
                      </div>
                    </TableCell>
                    {columns.map((col, idx) => (
                      <TableCell
                        key={col.key}
                        style={{ textAlign: col.align || "left" }}
                      >
                        <span
                          style={{ paddingLeft: `${idx === 0 ? row._depth * 24 : 0}px` }}
                          className="inline-block"
                        >
                          {idx === 0 && row._depth > 0 && (
                            <span className="text-muted-foreground mr-1">└</span>
                          )}
                          {col.render
                            ? col.render(row)
                            : (row as any)[col.key]}
                        </span>
                      </TableCell>
                    ))}
                    {actions && (
                      <TableCell className="text-center">
                        {actions(row)}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (actions ? 2 : 1)}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        total={visibleRows.length}
        current={page}
        pageSize={pageSize}
        onPageChange={setPage}
      />
    </div>
  )
}