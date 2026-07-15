import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusConfig: Record<string, { label: string; className: string }> = {
  IDLE: { label: "闲置", className: "bg-slate-100 text-slate-700 border-slate-200" },
  IN_USE: { label: "在用", className: "bg-green-100 text-green-700 border-green-200" },
  IN_MAINTENANCE: { label: "维修中", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  SCRAPPED: { label: "报废", className: "bg-red-100 text-red-700 border-red-200" },
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, className: "" }
  return (
    <Badge variant="outline" className={cn(config.className)}>
      {config.label}
    </Badge>
  )
}
