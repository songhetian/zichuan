import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// 每个测试后清理 DOM，避免多测试文件共享 jsdom 时元素残留导致 screen 查询误命中
afterEach(() => {
  cleanup()
})
