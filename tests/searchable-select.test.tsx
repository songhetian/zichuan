import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SearchableSelect } from "@/components/ui/searchable-select"

const options = [
  { value: "idle", label: "闲置" },
  { value: "in_use", label: "在用" },
  { value: "maintenance", label: "维修中" },
]

async function openSelect(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("combobox")
  await user.click(trigger)
}

describe("SearchableSelect 搜索过滤", () => {
  it("打开后输入关键词，只显示匹配的选项", async () => {
    const user = userEvent.setup()
    render(<SearchableSelect options={options} value="" onValueChange={() => {}} placeholder="全部状态" />)

    await openSelect(user)
    // 初始显示全部 3 个选项
    expect(screen.getByText("闲置")).toBeDefined()
    expect(screen.getByText("维修中")).toBeDefined()

    const searchInput = screen.getByPlaceholderText("全部状态（搜索）")
    await user.type(searchInput, "维修")

    await waitFor(() => {
      expect(screen.getByText("维修中")).toBeDefined()
      expect(screen.queryByText("闲置")).toBeNull()
      expect(screen.queryByText("在用")).toBeNull()
    })
  })

  it("无匹配时显示空态文案", async () => {
    const user = userEvent.setup()
    render(<SearchableSelect options={options} value="" onValueChange={() => {}} placeholder="全部状态" emptyText="没有匹配的选项" />)

    await openSelect(user)
    const searchInput = screen.getByPlaceholderText("全部状态（搜索）")
    await user.type(searchInput, "不存在的词")

    await waitFor(() => {
      expect(screen.getByText("没有匹配的选项")).toBeDefined()
    })
  })

  it("点击选项触发 onValueChange 并关闭", async () => {
    const user = userEvent.setup()
    let selected = ""
    render(
      <SearchableSelect
        options={options}
        value={selected}
        onValueChange={(v) => { selected = v }}
        placeholder="全部状态"
      />
    )

    await openSelect(user)
    await user.click(screen.getByText("在用"))
    expect(selected).toBe("in_use")
  })
})
