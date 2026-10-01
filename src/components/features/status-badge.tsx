import { cn } from "@/lib/utils"
import { getStatusLabel } from "@/lib/status-labels"
import { TONE_CHIP, assetStatusTone } from "@/lib/status-styles"

export interface StatusStyle {
  label: string
  className: string
}

/**
 * 状态 → 语义样式。配色一律取自 `@/lib/status-styles`（token 驱动），
 * 未知状态兜底为中性色，避免出现英文枚举或失衡的硬编码色。
 */
export function getStatusStyle(status: string): StatusStyle {
  return {
    label: getStatusLabel(status),
    className: TONE_CHIP[assetStatusTone(status)],
  }
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
