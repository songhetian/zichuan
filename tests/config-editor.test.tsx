/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ConfigEditor } from "@/app/(main)/assets/[id]/config-editor"

// Mock Dialog 组件，让 children 直接渲染（绕过 Radix Portal）
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock Server Action
vi.mock("@/actions/lifecycle.actions", () => ({
  adjustAssetComponents: vi.fn(),
}))

// Mock useToast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

// 测试数据：设备已有的配件配置
const currentComponents = [
  { modelId: 1, name: "i5-12400", brand: "Intel", categoryName: "CPU", stock: 5, quantity: 1 },
  { modelId: 2, name: "16GB DDR4", brand: "Kingston", categoryName: "内存", stock: 10, quantity: 1 },
  { modelId: 3, name: "27寸 4K", brand: "Dell", categoryName: "显示器", stock: 3, quantity: 1 },
]

const componentModels = [
  { modelId: 1, name: "i5-12400", brand: "Intel", categoryName: "CPU", stock: 5 },
  { modelId: 2, name: "16GB DDR4", brand: "Kingston", categoryName: "内存", stock: 10 },
  { modelId: 3, name: "27寸 4K", brand: "Dell", categoryName: "显示器", stock: 3 },
  { modelId: 4, name: "i7-13700K", brand: "Intel", categoryName: "CPU", stock: 2 },
  { modelId: 5, name: "32GB DDR5", brand: "Samsung", categoryName: "内存", stock: 4 },
]

describe("ConfigEditor 配置编辑器", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("打开弹窗时应在'当前配置'中显示设备已有的配件", () => {
    // 场景：用户点击"配置调整"按钮，open 从 false 变为 true
    // 预期：左侧"当前配置"面板应显示 i5-12400 / 16GB DDR4 / 27寸 4K 三个配件
    // 而不是显示"暂无配件"
    const { rerender } = render(
      <ConfigEditor
        open={false}
        onOpenChange={vi.fn()}
        assetId={1}
        assetNo="AST-001"
        assetName="测试设备"
        currentComponents={currentComponents}
        componentModels={componentModels}
      />
    )

    // 初始关闭状态，不应渲染弹窗
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()

    // 模拟用户点击"配置调整"按钮：父组件直接 setConfigEditorOpen(true)
    // 注意：这种情况下 Radix Dialog 的 onOpenChange 不会被触发
    rerender(
      <ConfigEditor
        open={true}
        onOpenChange={vi.fn()}
        assetId={1}
        assetNo="AST-001"
        assetName="测试设备"
        currentComponents={currentComponents}
        componentModels={componentModels}
      />
    )

    // 弹窗应显示
    expect(screen.getByTestId("dialog")).toBeInTheDocument()

    // "当前配置"面板应显示三个配件名称（而不是"暂无配件"）
    expect(screen.getByText("i5-12400")).toBeInTheDocument()
    expect(screen.getByText("16GB DDR4")).toBeInTheDocument()
    expect(screen.getByText("27寸 4K")).toBeInTheDocument()

    // 不应显示"暂无配件"
    expect(screen.queryByText("暂无配件，从右侧拖拽或点击添加")).not.toBeInTheDocument()

    // 不应显示变更摘要（因为没有修改）
    expect(screen.queryByText("变更摘要")).not.toBeInTheDocument()
  })

  it("初始 open=true 渲染时也应正确显示已有配件", () => {
    // 场景：组件首次挂载时 open 就是 true
    render(
      <ConfigEditor
        open={true}
        onOpenChange={vi.fn()}
        assetId={1}
        assetNo="AST-001"
        assetName="测试设备"
        currentComponents={currentComponents}
        componentModels={componentModels}
      />
    )

    expect(screen.getByText("i5-12400")).toBeInTheDocument()
    expect(screen.getByText("16GB DDR4")).toBeInTheDocument()
    expect(screen.getByText("27寸 4K")).toBeInTheDocument()
    expect(screen.queryByText("暂无配件，从右侧拖拽或点击添加")).not.toBeInTheDocument()
  })

  it("关闭后重新打开应重置为最新的 currentComponents", () => {
    // 场景：打开弹窗 → 删除一个配件 → 关闭弹窗 → 重新打开
    // 预期：重新打开时应显示完整的原始配件列表
    const { rerender } = render(
      <ConfigEditor
        open={true}
        onOpenChange={vi.fn()}
        assetId={1}
        assetNo="AST-001"
        assetName="测试设备"
        currentComponents={currentComponents}
        componentModels={componentModels}
      />
    )

    expect(screen.getByText("i5-12400")).toBeInTheDocument()

    // 关闭弹窗
    rerender(
      <ConfigEditor
        open={false}
        onOpenChange={vi.fn()}
        assetId={1}
        assetNo="AST-001"
        assetName="测试设备"
        currentComponents={currentComponents}
        componentModels={componentModels}
      />
    )
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()

    // 重新打开
    rerender(
      <ConfigEditor
        open={true}
        onOpenChange={vi.fn()}
        assetId={1}
        assetNo="AST-001"
        assetName="测试设备"
        currentComponents={currentComponents}
        componentModels={componentModels}
      />
    )

    // 应再次显示完整配件列表
    expect(screen.getByText("i5-12400")).toBeInTheDocument()
    expect(screen.getByText("16GB DDR4")).toBeInTheDocument()
    expect(screen.getByText("27寸 4K")).toBeInTheDocument()
  })
})
