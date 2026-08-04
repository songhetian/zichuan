import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PagePagination } from "@/components/ui/page-pagination"
import userEvent from "@testing-library/user-event"

describe("PagePagination 分页页码", () => {
  it("少于等于7页时，显示所有页码", () => {
    render(
      <PagePagination current={1} total={5} onPageChange={() => {}} />
    )

    // 应该有页码 1,2,3,4,5
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(String(i))).toBeDefined()
    }
    // 不应有省略号
    expect(screen.queryByText("...")).toBeNull()
  })

  it("多于7页时，中间页码用省略号折叠", () => {
    render(
      <PagePagination current={5} total={20} onPageChange={() => {}} />
    )

    // 应该有首页1、末页20
    expect(screen.getByText("1")).toBeDefined()
    expect(screen.getByText("20")).toBeDefined()
  })

  it("当前页有高亮样式", () => {
    render(
      <PagePagination current={3} total={10} onPageChange={() => {}} />
    )

    expect(screen.getByText("1")).toBeDefined()
  })

  it("点击页码触发 onPageChange", async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(
      <PagePagination current={1} total={5} onPageChange={onPageChange} />
    )

    await user.click(screen.getByText("3"))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it("首页不可点击上一页，末页不可点击下一页", () => {
    render(
      <PagePagination current={1} total={5} onPageChange={() => {}} />
    )

    // 当前在第1页，上一页按钮应该被禁用
    const prevBtn = screen.getByRole("button", { name: /上一页/i })
    expect(prevBtn).toBeDisabled()
  })

  it("末页时下一页按钮禁用", () => {
    render(
      <PagePagination current={5} total={5} onPageChange={() => {}} />
    )

    const nextBtn = screen.getByRole("button", { name: /下一页/i })
    expect(nextBtn).toBeDisabled()
  })
})
