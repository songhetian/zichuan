import { cn } from "@/lib/utils"

// 状态 → 语义样式映射（带底色的胶囊，一眼可辨）
// IDLE 中性 / IN_USE 成功绿 / IN_MAINTENANCE 警告琥珀 / SCRAPPED 危险红 / IN_STOCK 信息蓝
const statusConfig: Record<string, { label: string; className: string }> = {
  IDLE: { label: "闲置", className: "bg-muted text-muted-foreground border-transparent" },
  IN_USE: { label: "在用", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  IN_MAINTENANCE: { label: "维修中", className: "bg-amber-50 text-amber-700 border-amber-200" },
  SCRAPPED: { label: "报废", className: "bg-red-50 text-red-700 border-red-200" },
  IN_STOCK: { label: "库存", className: "bg-blue-50 text-blue-700 border-blue-200" },
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
