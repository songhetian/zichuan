"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  showBack?: boolean
  action?: React.ReactNode
}

export function PageHeader({ title, description, showBack, action }: PageHeaderProps) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {showBack && (
          <Button type="button" variant="ghost" size="icon" onClick={() => router.back()} aria-label="返回">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h1 className="font-display text-2xl md:text-3xl tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
      {action && (
        <div className="flex flex-wrap gap-2 sm:justify-end">{action}</div>
      )}
    </div>
  )
}
