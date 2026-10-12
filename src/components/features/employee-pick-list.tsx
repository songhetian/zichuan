"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TONE_CHIP } from "@/lib/status-styles";
import type { PairingEmployee } from "@/lib/allocation-pairing";

/**
 * 员工选择器里可用的最小员工信息。
 * 继承 PairingEmployee，保证「同一个对象既能进配对引擎、也能进选择列表」，避免两套结构互转。
 */
export interface PickerEmployee extends PairingEmployee {
  employeeNo: string;
  departmentId: number;
}

interface EmployeePickerProps {
  employees: readonly PickerEmployee[];
  departments: readonly { id: number; name: string }[];
  value: number | null;
  onValueChange: (employeeId: number | null) => void;
  placeholder?: string;
  /** 透传给触发器，用于 <Label htmlFor> 关联 */
  id?: string;
  ariaLabel?: string;
  /** 需要整条排除的员工（如调拨时排除当前使用人） */
  excludeIds?: readonly number[];
  contentClassName?: string;
}

/**
 * 员工选择器的「popover 形态」——单台分配 / 单台调拨这类一次只选一人的场景使用。
 * 内部就是 EmployeePickList，所以部门筛选、按部门分组、离职禁选与批量场景完全一致。
 */
export function EmployeePicker({
  employees,
  departments,
  value,
  onValueChange,
  placeholder = "选择员工",
  id,
  ariaLabel,
  excludeIds,
  contentClassName,
}: EmployeePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectable = React.useMemo(
    () => (excludeIds?.length ? employees.filter((e) => !excludeIds.includes(e.id)) : employees),
    [employees, excludeIds]
  );
  const selected = selectable.find((e) => e.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          id={id}
          aria-label={ariaLabel}
          className="h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 text-left font-normal"
        >
          <span className="flex min-w-0 flex-col leading-tight">
            {selected ? (
              <>
                <span className="truncate">{selected.name}</span>
                <span className="truncate text-xs text-muted-foreground">{selected.departmentName}</span>
              </>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <Search className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "min-w-[var(--radix-popover-trigger-width)] max-w-[min(90vw,420px)] p-3",
          contentClassName
        )}
      >
        <EmployeePickList
          employees={selectable}
          departments={departments}
          selectedIds={value == null ? [] : [value]}
          onToggle={(employeeId) => {
            onValueChange(employeeId === value ? null : employeeId);
            setOpen(false);
          }}
          idPrefix={id ? `${id}-picker` : "employee-picker"}
          listClassName="max-h-[240px]"
          searchLabel="搜索员工"
        />
      </PopoverContent>
    </Popover>
  );
}

interface EmployeePickListProps {
  employees: readonly PickerEmployee[];
  departments: readonly { id: number; name: string }[];
  /** 当前已选中的员工 id（单选传 0/1 个） */
  selectedIds: readonly number[];
  onToggle: (employeeId: number) => void;
  /** 生成 <input id> 的前缀，供 <label htmlFor> 关联（同一页面多处使用时必须区分） */
  idPrefix: string;
  /** 列表限高类，缺省 260px */
  listClassName?: string;
  /** 搜索框的无障碍名 */
  searchLabel?: string;
}

/**
 * 「部门筛选 + 自由搜索 + 按部门分组勾选」的员工选择列表。
 *
 * 设计取舍：
 * - 部门为**单选**（全部 / 具体部门）——部门是缩小范围的导航，多选只会制造额外复杂度；
 *   跨部门挑人靠搜索框（姓名 / 工号 / 部门名）。
 * - 离职员工**照常出现在列表里但不可勾选**并标注「已离职」——直接隐藏的话，
 *   搜一位离职同事时会以为系统坏了，显式标出来反而更容易暴露数据问题。
 * - 输入控件一律 `bg-card`：弹窗底是 `bg-background`（98% 米白），
 *   控件若同色就只剩一根边框，与 `variant="outline"` 按钮的纯白底也不一致。
 */
export function EmployeePickList({
  employees,
  departments,
  selectedIds,
  onToggle,
  idPrefix,
  listClassName,
  searchLabel = "搜索员工",
}: EmployeePickListProps) {
  const [departmentId, setDepartmentId] = React.useState("all");
  const [keyword, setKeyword] = React.useState("");

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return employees.filter((e) => {
      if (departmentId !== "all" && String(e.departmentId) !== departmentId) return false;
      if (!kw) return true;
      return (
        e.name.toLowerCase().includes(kw) ||
        e.employeeNo.toLowerCase().includes(kw) ||
        e.departmentName.toLowerCase().includes(kw)
      );
    });
  }, [employees, departmentId, keyword]);

  // 分组顺序跟随部门列表顺序，保证同一批数据每次渲染的分组次序稳定
  const groups = React.useMemo(() => {
    const byDepartment = new Map<number, PickerEmployee[]>();
    for (const e of filtered) {
      const list = byDepartment.get(e.departmentId);
      if (list) list.push(e);
      else byDepartment.set(e.departmentId, [e]);
    }
    const ordered: { id: number; name: string; items: PickerEmployee[] }[] = [];
    for (const d of departments) {
      const items = byDepartment.get(d.id);
      if (items?.length) {
        ordered.push({ id: d.id, name: d.name, items });
        byDepartment.delete(d.id);
      }
    }
    // 兜底：部门列表里没有的员工（理论上不会有）也不能丢
    for (const [id, items] of byDepartment) {
      ordered.push({ id, name: items[0].departmentName, items });
    }
    return ordered;
  }, [filtered, departments]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <SearchableSelect
          value={departmentId}
          onValueChange={setDepartmentId}
          placeholder="全部部门"
          ariaLabel="按部门筛选"
          triggerClassName="w-[132px] shrink-0"
          options={[
            { value: "all", label: "全部部门" },
            ...departments.map((d) => ({ value: String(d.id), label: d.name })),
          ]}
        />
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索姓名 / 工号 / 部门"
            aria-label={searchLabel}
            className="bg-card pl-9"
          />
        </div>
      </div>

      <div
        className={cn(
          "divide-y divide-border overflow-y-auto rounded-md border border-border bg-card",
          listClassName ?? "max-h-[260px]"
        )}
      >
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的员工</p>
        ) : (
          groups.map((group) => (
            <div key={group.id}>
              <p className="bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                {group.name} · {group.items.length} 人
              </p>
              <ul>
                {group.items.map((e) => {
                  const checked = selectedIds.includes(e.id);
                  const isLeft = e.status === "LEFT";
                  const inputId = `${idPrefix}-emp-${e.id}`;
                  return (
                    <li key={e.id}>
                      <div
                        className={cn(
                          "flex items-center gap-2 px-3 py-2",
                          checked && "bg-secondary",
                          isLeft && "opacity-50"
                        )}
                      >
                        <Checkbox
                          id={inputId}
                          checked={checked}
                          disabled={isLeft}
                          onCheckedChange={() => onToggle(e.id)}
                          aria-label={`选择 ${e.name}`}
                        />
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 text-sm",
                            isLeft ? "cursor-not-allowed" : "cursor-pointer"
                          )}
                        >
                          <span className="truncate">{e.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{e.employeeNo}</span>
                          {isLeft && (
                            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs", TONE_CHIP.neutral)}>
                              已离职
                            </span>
                          )}
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
