import { cn } from "@/lib/utils"

// 状态 → 语义样式映射（纸币感暖调胶囊，一眼可辨）
// IDLE 中性暖灰 / IN_USE 松绿 / IN_MAINTENANCE 铜色 / SCRAPPED 砖红 / IN_STOCK 蓝灰
const statusConfig: Record<string, { label: string; className: string }> = {
  IDLE: { label: "闲置", className: "bg-muted text-muted-foreground border-transparent" },
  IN_USE: { label: "在用", className: "bg-emerald-100/70 text-emerald-800 border-emerald-300/60" },
  IN_MAINTENANCE: { label: "维修中", className: "bg-amber-100/80 text-amber-800 border-amber-300/60" },
  SCRAPPED: { label: "报废", className: "bg-red-100/80 text-red-800 border-red-300/60" },
  IN_STOCK: { label: "库存", className: "bg-slate-100/80 text-slate-700 border-slate-300/60" },
}

export interface StatusStyle {
  label: string
  className: string
}

export function getStatusStyle(status: string): StatusStyle {
  return (
    statusConfig[status] ?? {
      label: status,
      className: "bg-muted text-muted-foreground border-transparent",
    }
  )
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, className } = getStatusStyle(status)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  )
}
