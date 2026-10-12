"use client"

import * as React from "react"
import { Search, Check, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"

export interface EmployeeOption {
  id: number
  name: string
  /** 工号，用于搜索与展示 */
  employeeNo?: string
  /** 部门 id，用于部门筛选；必填，缺失会导致部门筛选静默失效 */
  departmentId: number
  departmentName: string
}

interface SharedProps {
  employees: EmployeeOption[]
  placeholder?: string
  triggerClassName?: string
  /** 需要排除的员工 id（如调拨时排除当前使用人） */
  excludeIds?: number[]
  emptyText?: string
  /** 员工那一行的标题文案，默认「选择员工」；调拨场景传「目标员工」 */
  employeeLabel?: string
}

interface SingleProps extends SharedProps {
  mode?: "single"
  value: string
  onValueChange: (value: string) => void
}

interface MultipleProps extends SharedProps {
  mode: "multiple"
  value: number[]
  onValueChange: (value: number[]) => void
  /**
   * 员工 id → 「为什么这个人给不了」的短理由（如「已持有电脑主机」）。
   * 由调用方按 planAllocation 的同一口径算好后传入，这里只负责就地标出来 ——
   * 否则用户要等选完人、看到预览里一片冲突，才知道这些人本来就不该选。
   */
  unavailableReasons?: Map<number, string>
}

export type EmployeePickerProps = SingleProps | MultipleProps

/**
 * 统一选人控件。
 *
 * 两种模式**都是固定两行**：第一行「选择部门」（下拉），第二行才是员工。
 *
 * - `mode="single"`（默认）：第二行是 Popover 单选，用于各处「选一个员工」。
 * - `mode="multiple"`：第二行是内联多选面板（不套 Popover），用于批量分配的选人区。
 *
 * 部门行列在员工行**外面**（而不是塞进员工的 Popover 里），既是产品要求，
 * 也顺带绕开了「嵌套的 Radix Popover 会把内层 portal 判成外部点击」的老坑。
 *
 * 部门列表由 employees 推导（不额外接收 departments prop）：调用方不必把部门数组
 * 一路透传到深层组件，也不会出现「部门列表与员工数据不一致」。
 */
export function EmployeePicker(props: EmployeePickerProps) {
  if (props.mode === "multiple") return <MultiEmployeePicker {...props} />
  return <SingleEmployeePicker {...props} />
}

/**
 * 部门筛选 + 关键字过滤（单选/多选共用）。
 *
 * 部门列表由 employees 推导，只保留「确实有员工」的部门，点进去不会是空列表。
 * 关键字同时匹配姓名 / 工号 / 部门名。
 */
function useEmployeeFilter(selectable: EmployeeOption[]) {
  const [departmentFilter, setDepartmentFilter] = React.useState<number | null>(null)
  const [keyword, setKeyword] = React.useState("")

  const departmentOptions = React.useMemo(() => {
    const map = new Map<number, string>()
    for (const e of selectable) map.set(e.departmentId, e.departmentName)
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  }, [selectable])

  const visible = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return selectable.filter((e) => {
      if (departmentFilter !== null && e.departmentId !== departmentFilter) return false
      if (!kw) return true
      return (
        e.name.toLowerCase().includes(kw) ||
        (e.employeeNo ?? "").toLowerCase().includes(kw) ||
        e.departmentName.toLowerCase().includes(kw)
      )
    })
  }, [selectable, departmentFilter, keyword])

  const reset = React.useCallback(() => {
    setKeyword("")
    setDepartmentFilter(null)
  }, [])

  return { departmentFilter, setDepartmentFilter, keyword, setKeyword, departmentOptions, visible, reset }
}

/** 部门下拉的选项（含「全部部门」）；两行选人区的第一行共用 */
function useDepartmentSelectOptions(departmentOptions: { id: number; name: string }[]) {
  return React.useMemo(
    () => [
      { value: "", label: "全部部门" },
      ...departmentOptions.map((d) => ({ value: String(d.id), label: d.name })),
    ],
    [departmentOptions]
  )
}

function MultiEmployeePicker({
  employees,
  value,
  onValueChange,
  placeholder = "选择员工",
  excludeIds = [],
  emptyText = "无匹配员工",
  employeeLabel = "选择员工",
  unavailableReasons,
}: MultipleProps) {
  const selectable = React.useMemo(
    () => employees.filter((e) => !excludeIds.includes(e.id)),
    [employees, excludeIds]
  )

  const { departmentFilter, setDepartmentFilter, keyword, setKeyword, departmentOptions, visible } =
    useEmployeeFilter(selectable)

  const departmentSelectOptions = useDepartmentSelectOptions(departmentOptions)

  const toggle = (id: number) => {
    if (value.includes(id)) onValueChange(value.filter((v) => v !== id))
    else onValueChange([...value, id])
  }

  const toggleAllVisible = () => {
    const visibleIds = visible.map((e) => e.id)
    const allSelected = visibleIds.every((id) => value.includes(id))
    onValueChange(
      allSelected
        ? value.filter((id) => !visibleIds.includes(id))
        : [...value, ...visibleIds.filter((id) => !value.includes(id))]
    )
  }

  const selected = React.useMemo(
    () => selectable.filter((e) => value.includes(e.id)),
    [selectable, value]
  )

  return (
    <div className="space-y-3">
      {/* 第一行：先选部门，把员工名单缩到你要的那一拨 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-normal text-muted-foreground">选择部门</Label>
        <SearchableSelect
          options={departmentSelectOptions}
          value={departmentFilter === null ? "" : String(departmentFilter)}
          onValueChange={(v) => setDepartmentFilter(v === "" ? null : Number(v))}
          ariaLabel="选择部门"
          placeholder="选择部门"
          triggerClassName="w-full"
        />
      </div>

      {/* 第二行：再选员工（可多选） */}
      <div className="space-y-1.5">
        <Label className="text-xs font-normal text-muted-foreground">{employeeLabel}（可多选）</Label>
        <div className="overflow-hidden rounded-md border">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索姓名 / 工号 / 部门"
              aria-label="搜索姓名 / 工号 / 部门"
              className="h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={toggleAllVisible}
            className="w-full border-b px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            全选当前结果（{visible.length} 人）
          </button>
          <div role="group" aria-label={placeholder} className="max-h-[200px] overflow-y-auto p-1">
            {visible.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
            ) : (
              visible.map((employee) => {
                const unavailable = unavailableReasons?.get(employee.id)
                return (
                  <div
                    key={employee.id}
                    onClick={() => toggle(employee.id)}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    {/* 勾选框自己处理点击并阻断冒泡，保证整行点击只切换一次 */}
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={employee.name}
                        checked={value.includes(employee.id)}
                        onCheckedChange={() => toggle(employee.id)}
                      />
                    </span>
                    <span className="truncate font-medium">{employee.name}</span>
                    {employee.employeeNo ? (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {employee.employeeNo}
                      </span>
                    ) : null}
                    {unavailable ? (
                      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                        {unavailable}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {employee.departmentName}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">已选 {selected.length} 人</span>
          {selected.map((employee) => (
            <span
              key={employee.id}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2 pr-1 text-xs"
            >
              {employee.name}
              <button
                type="button"
                aria-label={`移除 ${employee.name}`}
                onClick={() => toggle(employee.id)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => onValueChange([])}
            className="rounded-full px-2 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            清空
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SingleEmployeePicker({
  employees,
  value,
  onValueChange,
  placeholder = "选择员工",
  triggerClassName,
  excludeIds = [],
  emptyText = "无匹配员工",
  employeeLabel = "选择员工",
}: SingleProps) {
  const [open, setOpen] = React.useState(false)

  const selectable = React.useMemo(
    () => employees.filter((e) => !excludeIds.includes(e.id)),
    [employees, excludeIds]
  )

  const selected = React.useMemo(
    () => employees.find((e) => String(e.id) === value),
    [employees, value]
  )

  const { departmentFilter, setDepartmentFilter, keyword, setKeyword, departmentOptions, visible, reset } =
    useEmployeeFilter(selectable)

  const departmentSelectOptions = useDepartmentSelectOptions(departmentOptions)

  // 收起时清空筛选，避免下次展开还残留上次的搜索词/部门
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next) reset()
    },
    [reset]
  )

  const handleSelect = (id: number) => {
    onValueChange(String(id))
    handleOpenChange(false)
  }

  return (
    <div className="space-y-3">
      {/* 第一行：先选部门，把员工名单缩到你要的那一拨 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-normal text-muted-foreground">选择部门</Label>
        <SearchableSelect
          options={departmentSelectOptions}
          value={departmentFilter === null ? "" : String(departmentFilter)}
          onValueChange={(v) => setDepartmentFilter(v === "" ? null : Number(v))}
          ariaLabel="选择部门"
          placeholder="全部部门"
          triggerClassName={triggerClassName}
        />
      </div>

      {/* 第二行：再选员工 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-normal text-muted-foreground">{employeeLabel}</Label>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={placeholder}
              className={cn("h-9 justify-between font-normal", triggerClassName)}
            >
              <span className="truncate">
                {selected ? `${selected.name} · ${selected.departmentName}` : placeholder}
              </span>
              <Search className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0 min-w-[var(--radix-popover-trigger-width)] max-w-[min(92vw,420px)]"
            align="start"
          >
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索姓名 / 工号 / 部门"
                aria-label="搜索姓名 / 工号 / 部门"
                className="h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div role="listbox" className="max-h-[260px] overflow-y-auto p-1">
              {visible.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
              ) : (
                visible.map((employee) => {
                  const isSelected = String(employee.id) === value
                  return (
                    <button
                      key={employee.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(employee.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent"
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "opacity-100 text-primary" : "opacity-0"
                        )}
                      />
                      <span className="truncate font-medium">{employee.name}</span>
                      {employee.employeeNo ? (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {employee.employeeNo}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {employee.departmentName}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
