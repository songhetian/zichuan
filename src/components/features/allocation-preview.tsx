"use client"

import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AllocationPlan } from "@/lib/allocation"
import type { EmployeeOption } from "@/components/ui/employee-picker"

interface AllocationPreviewProps {
  plan: AllocationPlan
  /** 用于把 perEmployee 里的 employeeId 还原成「姓名 · 部门」 */
  employees: EmployeeOption[]
  className?: string
}

/** 确认按钮文案：把「实际会分配几台」写在按钮上，避免误解为全部成功 */
export function buildAllocateSubmitLabel(allocatableCount: number): string {
  return allocatableCount > 0 ? `分配可用的 ${allocatableCount} 台` : "没有可分配的设备"
}

/** 按原因归并冲突，避免 20 台逐一重复同一句话 */
function groupConflicts(plan: AllocationPlan) {
  const map = new Map<string, string[]>()
  for (const c of plan.conflicts) {
    const list = map.get(c.reason)
    if (list) list.push(c.assetNo)
    else map.set(c.reason, [c.assetNo])
  }
  return [...map.entries()].map(([reason, assetNos]) => ({ reason, assetNos }))
}

/**
 * 批量分配弹窗的「分配预览」栏。
 *
 * 均值分配 + 唯一分类封顶之后，实际可分配台数经常低于选中的台数 —— 所以必须把
 * 「谁拿几台」和「剩下的为什么分不出去」并排摊开，否则会被当成「分配坏了」。
 */
export function AllocationPreview({ plan, employees, className }: AllocationPreviewProps) {
  const employeeById = new Map(employees.map((e) => [e.id, e]))
  const conflicts = groupConflicts(plan)
  const allocatable = plan.assignments.length
  const hasOwnedConflict = plan.conflicts.some((c) => c.reason.includes("已持有"))

  return (
    <div className={cn("flex h-full flex-col gap-2 text-sm", className)}>
      <div className="text-xs font-medium text-muted-foreground">分配预览</div>
      <ul
        aria-label="分配预览"
        className="max-h-[220px] space-y-0.5 overflow-y-auto rounded-md border p-1"
      >
        {plan.perEmployee.map((row) => {
          const employee = employeeById.get(row.employeeId)
          const name = employee ? `${employee.name} · ${employee.departmentName}` : String(row.employeeId)
          return (
            <li
              key={row.employeeId}
              className={cn(
                "flex items-center justify-between gap-2 rounded-sm px-2 py-1",
                row.count === 0 && "text-muted-foreground"
              )}
            >
              <span className="truncate">{name}</span>
              <span className="shrink-0 font-mono text-xs">{row.count} 台</span>
            </li>
          )
        })}
      </ul>

      <div className="rounded-md border p-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>可分配 {allocatable} 台</span>
          </span>
          {plan.conflicts.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>冲突 {plan.conflicts.length} 台</span>
            </span>
          ) : null}
        </div>

        {allocatable === 0 && plan.conflicts.length > 0 ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-700">
            当前没有可分配的设备。
            {hasOwnedConflict
              ? "所选员工已持有对应分类的设备（唯一分类每人仅限 1 台），请改选其他员工，或先归还现有设备。"
              : "请按下面的原因调整员工或设备后再提交。"}
          </p>
        ) : null}

        {conflicts.length > 0 ? (
          <ul aria-label="冲突明细" className="mt-1.5 space-y-1">
            {conflicts.map((group) => (
              <li key={group.reason} className="text-xs text-muted-foreground">
                <span className="text-foreground">{group.reason}</span>
                <span className="ml-1">（{group.assetNos.length} 台）</span>
                <div className="font-mono">{group.assetNos.join("、")}</div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
