import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
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

  it("默认不强制 text-center，表头应由基础组件决定（默认左对齐）", () => {
    render(<DataTable columns={columns} data={data} />)

    const headers = screen.getAllByRole("columnheader")
    // "名称" 列头 — 取第一个 th 匹配
    const nameHeader = screen.getAllByText("名称")[0].closest("th")
    expect(nameHeader?.className).not.toContain("text-center")
  })

  it("meta.align 为 center 的列，表头应有 text-center", () => {
    render(<DataTable columns={columns} data={data} />)

    const statusHeader = screen.getAllByText("状态")[0].closest("th")
    expect(statusHeader?.className).toContain("text-center")
  })

  it("默认单元格不强制 text-center", () => {
    render(<DataTable columns={columns} data={data} />)

    const cell = screen.getAllByText("测试设备")[0].closest("td")
    expect(cell?.className).not.toContain("text-center")
  })

  it("meta.align 为 center 的列，单元格应有 text-center", () => {
    render(<DataTable columns={columns} data={data} />)

    const statusCells = screen.getAllByText("IDLE")
    const firstStatusCell = statusCells[0].closest("td")
    expect(firstStatusCell?.className).toContain("text-center")
  })
})
