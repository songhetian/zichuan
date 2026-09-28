"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

interface Option {
  value: string
  label: string
  group?: string
  /** 副行说明（如工号），存在时选项以两行展示 */
  description?: string
}

interface SearchableSelectProps {
  options: Option[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  emptyText?: string
  searchPlaceholder?: string
  ariaLabel?: string
  className?: string
  triggerClassName?: string
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "选择...",
  emptyText = "无匹配项",
  searchPlaceholder = "搜索...",
  ariaLabel,
  className,
  triggerClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)

  const selected = React.useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("h-auto min-h-9 justify-between gap-2 px-3 py-1.5 text-left font-normal", triggerClassName)}
        >
          <span className="flex min-w-0 flex-col leading-tight">
            {selected ? (
              <>
                <span className="truncate">{selected.label}</span>
                {selected.description && (
                  <span className="truncate text-xs text-muted-foreground">{selected.description}</span>
                )}
              </>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <Search className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 min-w-[var(--radix-popover-trigger-width)] max-w-[min(90vw,360px)]"
        align="start"
      >
        <CommandPrimitive>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandPrimitive.Input
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={searchPlaceholder}
            />
          </div>
          <CommandPrimitive.List className="max-h-[360px] overflow-y-auto p-1">
            <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </CommandPrimitive.Empty>
            {options.map((option) => (
              <CommandPrimitive.Item
                  key={option.value}
                  value={`${option.label}${option.description ? ` ${option.description}` : ""}`}
                  onSelect={() => {
                    onValueChange(option.value === value ? "" : option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                    value === option.value && "bg-accent"
                  )}
                >
                  {option.description ? (
                    <span className="flex w-full flex-col leading-tight">
                      <span className="truncate">{option.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  ) : (
                    <span className="truncate">{option.label}</span>
                  )}
                </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  )
}
