import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { DataTable } from "@/components/features/data-table"
import { ColumnDef } from "@tanstack/react-table"

type TestRow = { id: number; name: string; status: string }

const columns: ColumnDef<TestRow>[] = [
  { accessorKey: "name", header: "名称" },
  {
    accessorKey: "status",
    header: "状态",
    meta: { align: "center" as const },
  },
]

const data: TestRow[] = [
  { id: 1, name: "测试设备", status: "IDLE" },
  { id: 2, name: "另一台设备", status: "IN_USE" },
]

describe("DataTable 列对齐", () => {
  afterEach(() => {
    cleanup()
  })

  it("默认表头居中对齐", () => {
    render(<DataTable columns={columns} data={data} />)

    const headers = screen.getAllByRole("columnheader")
    // "名称" 列头 — 取第一个 th 匹配
    const nameHeader = screen.getAllByText("名称")[0].closest("th")
    expect(nameHeader?.className).toContain("text-center")
  })

  it("meta.align 为 center 的列，表头应有 text-center", () => {
    render(<DataTable columns={columns} data={data} />)

    const statusHeader = screen.getAllByText("状态")[0].closest("th")
    expect(statusHeader?.className).toContain("text-center")
  })

  it("默认单元格居中对齐", () => {
    render(<DataTable columns={columns} data={data} />)

    const cell = screen.getAllByText("测试设备")[0].closest("td")
    expect(cell?.className).toContain("text-center")
  })

  it("meta.align 为 center 的列，单元格应有 text-center", () => {
    render(<DataTable columns={columns} data={data} />)

    const statusCells = screen.getAllByText("IDLE")
    const firstStatusCell = statusCells[0].closest("td")
    expect(firstStatusCell?.className).toContain("text-center")
  })
})

describe("DataTable 选中态上抛", () => {
  afterEach(() => {
    cleanup()
  })

  const selectableColumns: ColumnDef<TestRow>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          aria-label="全选"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`选择 ${row.original.name}`}
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    },
    ...columns,
  ]

  it("勾选单行后，回调收到该行的原始数据", () => {
    const spy = vi.fn()
    render(
      <DataTable
        columns={selectableColumns}
        data={data}
        enableRowSelection
        onRowSelectionChange={spy}
      />
    )

    fireEvent.click(screen.getByLabelText("选择 测试设备"))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toEqual([data[0]])
  })

  it("全选后，回调收到全部原始数据；取消全选后回调收到空数组", () => {
    const spy = vi.fn()
    render(
      <DataTable
        columns={selectableColumns}
        data={data}
        enableRowSelection
        onRowSelectionChange={spy}
      />
    )

    fireEvent.click(screen.getByLabelText("全选"))
    expect(spy.mock.calls.at(-1)?.[0]).toEqual(data)

    fireEvent.click(screen.getByLabelText("全选"))
    expect(spy.mock.calls.at(-1)?.[0]).toEqual([])
  })
})
