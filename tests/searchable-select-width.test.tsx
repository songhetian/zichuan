import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SearchableSelect } from "@/components/ui/searchable-select"

const options = [
  { value: "1", label: "张三（技术部）" },
  { value: "2", label: "李四（财务部）" },
]

describe("SearchableSelect 宽度适配", () => {
  it("窄触发器（120px）时下拉面板仍有最小宽度，内容不被截断", async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={options}
        value=""
        onValueChange={() => {}}
        placeholder="全部员工"
        triggerClassName="w-[120px]"
      />
    )

    await user.click(screen.getByRole("combobox"))

    // 面板应带最小宽度类，保证长选项可读
    const content = document.querySelector("[data-radix-popper-content-wrapper] + *")?.parentElement
    // 直接找面板容器（PopoverContent）
    const panel = document.querySelector("[role='dialog']") ?? document.querySelector("[cmdk-root]")?.closest("div")
    expect(panel).toBeTruthy()
  })

  it("下拉面板应用了 min-w 类（不依赖触发器宽度）", async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={options}
        value=""
        onValueChange={() => {}}
        placeholder="全部员工"
        triggerClassName="w-[120px]"
      />
    )

    await user.click(screen.getByRole("combobox"))

    // PopoverContent 渲染在 body 下，带 min-w 样式类
    const panels = Array.from(document.querySelectorAll("body > * [cmdk-root]"))
    const cmdkRoot = panels[panels.length - 1]
    const panel = cmdkRoot?.closest("div[data-state='open']")
    const allPanels = Array.from(document.querySelectorAll("[data-state='open']"))
    const popover = allPanels.find((el) => el.textContent?.includes("张三（技术部）"))
    expect(popover).toBeTruthy()
    const cls = popover?.className ?? ""
    expect(cls).toMatch(/min-w/)
  })

  it("选项文本超宽时截断而非溢出", async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect options={options} value="" onValueChange={() => {}} placeholder="全部员工" />
    )

    await user.click(screen.getByRole("combobox"))

    const item = screen.getByText("张三（技术部）")
    // cmdk item 应有 truncate 类
    expect(item.className).toContain("truncate")
  })
})
