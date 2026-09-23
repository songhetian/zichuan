"use client"

import { useEffect, useState } from "react"

// 从 globals.css 的 CSS 变量解析真正的颜色（支持亮/暗两套主题实时取色）
function resolve(v: string): string {
  if (typeof window === "undefined") return "hsl(210 15% 55%)"
  const raw = getComputedStyle(document.documentElement).getPropertyValue(v).trim()
  if (!raw) return "hsl(210 15% 55%)"
  if (raw.startsWith("hsl")) return raw
  const [h, s, l] = raw.split(" ").map(Number)
  return `hsl(${h} ${s}% ${l}%)`
}

/** 供 ECharts 这类不随 CSS 变量自动换肤的库读取主题色；主题切换时自动重渲染 */
export function useThemeColors() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1)
    window.addEventListener("zet-theme-change", onChange)
    return () => window.removeEventListener("zet-theme-change", onChange)
  }, [])

  void tick

  return {
    foreground: resolve("--foreground"),
    muted: resolve("--muted-foreground"),
    border: resolve("--border"),
    card: resolve("--card"),
    primary: resolve("--primary"),
  }
}

export const THEME_CHANGE_EVENT = "zet-theme-change"