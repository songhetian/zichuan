import { cn } from "@/lib/utils"

const statusConfig: Record<string, { label: string; dotColor: string }> = {
  IDLE: { label: "闲置", dotColor: "bg-muted-foreground" },
  IN_USE: { label: "在用", dotColor: "bg-primary" },
  IN_MAINTENANCE: { label: "维修中", dotColor: "bg-amber-500" },
  SCRAPPED: { label: "报废", dotColor: "bg-red-500" },
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, dotColor: "bg-muted-foreground" }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", config.dotColor)} />
      {config.label}
    </span>
  )
}
