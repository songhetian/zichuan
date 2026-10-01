"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Moon, Sun } from "lucide-react"
import { THEME_CHANGE_EVENT } from "@/lib/use-theme-colors"

const KEY = "zt-theme"

/** 亮色为默认（:root），仅在选择暗色时才挂 .dark */
function apply(dark: boolean) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", dark)
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(KEY) === "dark"
    apply(stored)
    setIsDark(stored)
  }, [])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem(KEY, next ? "dark" : "light")
    apply(next)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT))
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="切换明暗模式"
      title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      onClick={toggle}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}
