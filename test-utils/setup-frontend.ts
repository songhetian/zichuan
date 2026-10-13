import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { assertSafeTestDb } from "./db-guard"

// 安全闸门：防止误把写库测试跑到真实库上（真实数据不可碰）
assertSafeTestDb()

// jsdom 不提供 ResizeObserver，而 cmdk / Radix Popper 依赖它
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// jsdom 不实现 scrollIntoView，cmdk 在选中/过滤时会调用
// node 环境（纯导入测试）下 Element 不存在，需保护
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom 不实现 Pointer Capture，Radix Select 的列表项在 pointerdown 时调用会抛错
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
}

// 每个测试后清理 DOM，避免多测试文件共享 jsdom 时元素残留导致 screen 查询误命中
afterEach(() => {
  cleanup()
})
