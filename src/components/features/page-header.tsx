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
    <div className="flex items-center justify-between pb-4">
      <div className="flex items-center gap-3">
        {showBack && (
          <Button type="button" variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
