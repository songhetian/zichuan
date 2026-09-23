"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Moon, Sun } from "lucide-react"
import { THEME_CHANGE_EVENT } from "@/lib/use-theme-colors"

const KEY = "zt-theme"

function apply(light: boolean) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("light", light)
}

export function ThemeToggle() {
  const [light, setLight] = useState(false)

  useEffect(() => {
    apply(localStorage.getItem(KEY) === "light")
    setLight(localStorage.getItem(KEY) === "light")
  }, [])

  const toggle = () => {
    const next = !light
    setLight(next)
    localStorage.setItem(KEY, next ? "light" : "dark")
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
      title={light ? "切换到暗色模式" : "切换到亮色模式"}
      onClick={toggle}
    >
      {light ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  )
}