import { cn } from "@/lib/utils"
import { getStatusLabel } from "@/lib/status-labels"

// 状态 → 语义样式映射（纸币感暖调胶囊，一眼可辨）
// IDLE 中性暖灰 / IN_USE 松绿 / IN_MAINTENANCE 铜色 / SCRAPPED 砖红 / RESERVED 审批预占紫
const statusConfig: Record<string, { label: string; className: string }> = {
  IDLE: { label: "闲置", className: "bg-muted text-muted-foreground border-transparent" },
  IN_USE: { label: "在用", className: "bg-emerald-100/70 text-emerald-800 border-emerald-300/60" },
  IN_MAINTENANCE: { label: "维修中", className: "bg-amber-100/80 text-amber-800 border-amber-300/60" },
  SCRAPPED: { label: "报废", className: "bg-red-100/80 text-red-800 border-red-300/60" },
  RESERVED: { label: "预占", className: "bg-violet-100/70 text-violet-800 border-violet-300/60" },
}

export interface StatusStyle {
  label: string
  className: string
}

export function getStatusStyle(status: string): StatusStyle {
  return (
    statusConfig[status] ?? {
      // 兜底也走中文标签，避免 R8 禁止的英文枚举外泄
      label: getStatusLabel(status),
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
