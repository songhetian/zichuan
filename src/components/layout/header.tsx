"use client"

import { useAuthStore } from "@/store/auth-store"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LogOut, Menu } from "lucide-react"
import { CommandPalette } from "@/components/features/command-palette"

export function Header({ mobileMenuOpen, onMobileMenuToggle }: { mobileMenuOpen?: boolean; onMobileMenuToggle?: () => void }) {
  const { username, logout } = useAuthStore()
  const router = useRouter()

  const handleLogout = () => {
    logout()
    router.push("/login")
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-4">
        <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={onMobileMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="text-sm text-muted-foreground">
          当前用户：<span className="font-medium text-foreground">{username}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <CommandPalette />
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </Button>
      </div>
    </header>
  )
}
