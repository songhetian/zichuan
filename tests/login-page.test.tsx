/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LoginForm } from "@/app/login/login-form"

// Mock login action
vi.mock("@/actions/auth.actions", () => ({
  login: vi.fn(),
}))

// Mock zustand auth store
const mockAuthLogin = vi.fn()
vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: any) => selector({ login: mockAuthLogin, logout: vi.fn() }),
}))

// Mock next/navigation
const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), refresh: vi.fn(), replace: mockReplace, prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}))

describe("LoginForm 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("渲染登录表单，包含工号和密码输入框", () => {
    render(<LoginForm />)

    expect(screen.getByLabelText("工号")).toBeInTheDocument()
    expect(screen.getByLabelText("密码")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument()
  })

  it("工号和密码为空时显示错误提示", async () => {
    render(<LoginForm />)

    const submitButton = screen.getByRole("button", { name: "登录" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText("请输入工号")).toBeInTheDocument()
    })
  })

  it("登录成功后跳转到仪表盘", async () => {
    const { login } = await import("@/actions/auth.actions")
    vi.mocked(login).mockResolvedValue({ success: true, data: { username: "admin", mustChangePassword: false } } as any)

    render(<LoginForm />)

    const usernameInput = screen.getByLabelText("工号")
    const passwordInput = screen.getByLabelText("密码")

    fireEvent.change(usernameInput, { target: { value: "admin" } })
    fireEvent.change(passwordInput, { target: { value: "admin123" } })

    const submitButton = screen.getByRole("button", { name: "登录" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(login).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith("/dashboard")
    }, { timeout: 3000 })
  })

  it("首次登录（默认密码）跳转到强制改密页", async () => {
    const { login } = await import("@/actions/auth.actions")
    vi.mocked(login).mockResolvedValue({ success: true, data: { username: "emp1", mustChangePassword: true } } as any)

    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText("工号"), { target: { value: "emp1" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "登录" }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/force-password")
    }, { timeout: 3000 })
  })

  it("登录失败时显示错误信息", async () => {
    const { login } = await import("@/actions/auth.actions")
    vi.mocked(login).mockResolvedValue({ success: false, error: "密码错误" })

    render(<LoginForm />)

    await userEvent.type(screen.getByLabelText("工号"), "admin")
    await userEvent.type(screen.getByLabelText("密码"), "wrong")

    const submitButton = screen.getByRole("button", { name: "登录" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText("密码错误")).toBeInTheDocument()
    })
  })
})
