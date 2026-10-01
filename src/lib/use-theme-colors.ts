"use client"

import { useEffect, useState } from "react"

/** 主题切换事件名。切换主题的组件负责 dispatch，图表借它重渲染（canvas 不随 CSS 变量换肤）。 */
export const THEME_CHANGE_EVENT = "zet-theme-change"

/** 分类标识色 token（与 globals.css 的 --cat-* 同源）。
 *  DOM 上用 `bg-cat-*` 类名，canvas（ECharts）用下面解析出的具体色值。 */
const CATEGORICAL_TOKENS = [
  "--cat-indigo",
  "--cat-violet",
  "--cat-blue",
  "--cat-emerald",
  "--cat-sky",
  "--cat-rose",
  "--cat-cyan",
  "--cat-teal",
  "--cat-purple",
  "--cat-pink",
  "--cat-fuchsia",
] as const

/**
 * 取不到色值时的兜底色（SSR 期间、变量缺失、解析失败）。
 * 必须是 zrender 能解析的完整色值——理由见 `tokenValueToColor` 的注释。
 */
const FALLBACK_COLOR = "#8c90a0"

/** HSL → `#rrggbb`（图表用色都不带透明度） */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) =>
    lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0")
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

/**
 * 把 globals.css 的 CSS 变量值转成 canvas（ECharts / zrender）能用的色值。
 *
 * globals.css 的 token 是**不带 `hsl()` 包裹的 HSL 三元组**（`237 56% 34%`），
 * 这样 Tailwind 侧才能写 `hsl(var(--cat-indigo))`。而 canvas 需要完整色值，
 * 所以在这里做转换。两条踩过的坑（2026-09-29，曾导致驾驶舱柱状图 / 环形图**全部同色**）：
 *
 * 1. **必须用 `parseFloat`，不能用 `Number`** —— `Number("56%")` 是 `NaN`，
 *    拼出来的是 `hsl(237 NaN% NaN%)`，属非法颜色。canvas 对非法 `fillStyle`
 *    **既不报错也不改色**（保持上一个有效值），于是所有柱子/扇区静默落到同一个颜色。
 * 2. **输出格式必须 zrender 能解析** —— zrender 的 `color.parse` 支持 `#hex` / `rgb()` /
 *    逗号版 `hsl(h, s%, l%)`，唯独**不认空格版 `hsl(h s% l%)`**（浏览器自己认，但 zrender
 *    的颜色运算如动画插值、hover 提亮会拿不到色值）。因此这里统一输出 `#rrggbb`。
 */
export function tokenValueToColor(raw: string): string {
  const value = (raw ?? "").trim()
  if (!value) return FALLBACK_COLOR
  // 已经是完整颜色语法 → 原样返回（给将来可能出现的 hex / oklch 等 token 留口）
  if (/^(#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\()/i.test(value)) {
    return value
  }
  // HSL 三元组："237 56% 34%"（% 可省略，分隔符容忍空格与逗号）
  const parts = value.split(/[\s,/]+/).map(parseFloat)
  const [h, s, l] = parts
  if (parts.length < 3 || !Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return FALLBACK_COLOR
  }
  return hslToHex(h, s, l)
}

/** 从文档根节点读取 CSS 变量并转成 canvas 色值 */
function resolve(v: string): string {
  if (typeof window === "undefined") return FALLBACK_COLOR
  return tokenValueToColor(
    getComputedStyle(document.documentElement).getPropertyValue(v)
  )
}

/** 供 ECharts 这类不随 CSS 变量自动换肤的库读取主题色；主题切换时自动重渲染 */
export function useThemeColors() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // 挂载后再取一次：首帧有可能早于样式表生效（那时会整片落到兜底色）
    setTick((t) => t + 1)
    const onChange = () => setTick((t) => t + 1)
    window.addEventListener(THEME_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  }, [])

  void tick

  return {
    foreground: resolve("--foreground"),
    muted: resolve("--muted-foreground"),
    border: resolve("--border"),
    card: resolve("--card"),
    primary: resolve("--primary"),
    // 语义色：canvas（ECharts）取不到 CSS 变量，只能在这里解析成具体色值。
    // DOM 里的状态色请直接用 @/lib/status-styles 的 TONE_* 类名，不要走这里。
    success: resolve("--success"),
    warning: resolve("--warning"),
    destructive: resolve("--destructive"),
    info: resolve("--info"),
    violet: resolve("--violet"),
    /** 资产状态 → 图表颜色。与 StatusBadge 的语义角色严格一致（曾出现「在用」在驾驶舱是蓝、在统计页是绿的漂移） */
    status: {
      IDLE: resolve("--muted-foreground"),
      IN_USE: resolve("--success"),
      IN_MAINTENANCE: resolve("--warning"),
      SCRAPPED: resolve("--destructive"),
      RESERVED: resolve("--violet"),
    } as Record<string, string>,
    /** 分类标识色的 canvas 版本：给「部门 × 分类」等多序列图表用，避免另建一套静态调色板 */
    categorical: CATEGORICAL_TOKENS.map((t) => resolve(t)),
  }
}
