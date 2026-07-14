/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}))

describe("LoginForm 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("渲染登录表单，包含用户名和密码输入框", () => {
    render(<LoginForm />)

    expect(screen.getByLabelText("用户名")).toBeInTheDocument()
    expect(screen.getByLabelText("密码")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument()
  })

  it("用户名和密码为空时显示错误提示", async () => {
    render(<LoginForm />)

    const submitButton = screen.getByRole("button", { name: "登录" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText("请输入用户名")).toBeInTheDocument()
    })
  })

  it("登录成功后跳转到设备管理页", async () => {
    const { login } = await import("@/actions/auth.actions")
    vi.mocked(login).mockResolvedValue({ success: true, data: { username: "admin" } } as any)

    render(<LoginForm />)

    const usernameInput = screen.getByLabelText("用户名")
    const passwordInput = screen.getByLabelText("密码")

    fireEvent.change(usernameInput, { target: { value: "admin" } })
    fireEvent.change(passwordInput, { target: { value: "admin123" } })

    const submitButton = screen.getByRole("button", { name: "登录" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(login).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith("/assets")
    }, { timeout: 3000 })
  })

  it("登录失败时显示错误信息", async () => {
    const { login } = await import("@/actions/auth.actions")
    vi.mocked(login).mockResolvedValue({ success: false, error: "密码错误" })

    render(<LoginForm />)

    await userEvent.type(screen.getByLabelText("用户名"), "admin")
    await userEvent.type(screen.getByLabelText("密码"), "wrong")

    const submitButton = screen.getByRole("button", { name: "登录" })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText("密码错误")).toBeInTheDocument()
    })
  })
})
