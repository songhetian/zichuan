"use client";

import * as React from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmployeePickList, type PickerEmployee } from "@/components/features/employee-pick-list";
import { TONE_CHIP, TONE_SOFT, TONE_TEXT } from "@/lib/status-styles";
import {
  annotatePairConflicts,
  buildAllocationPairs,
  summarizePairing,
  type AllocationConflict,
  type PairingAsset,
  type PairingCategory,
} from "@/lib/allocation-pairing";

export interface AllocationPairPayload {
  assetId: number;
  employeeId: number;
}

interface BatchAllocateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待分配设备（已按状态机预筛，只含「闲置」） */
  assets: readonly PairingAsset[];
  /** 因状态不合格被排除的设备数量 —— 只用于如实提示，不再让文案说谎 */
  excludedCount: number;
  /** 前端持有的全量资产，用于 R4 唯一性预校验 */
  allAssets: readonly PairingAsset[];
  categories: readonly PairingCategory[];
  employees: readonly PickerEmployee[];
  departments: readonly { id: number; name: string }[];
  loading: boolean;
  /**
   * 提交。返回服务端判定的冲突清单：
   * 空数组 = 全部成功（宿主负责关闭弹窗）；非空 = 服务端拒绝，留在弹窗里高亮。
   */
  onConfirm: (pairs: AllocationPairPayload[]) => Promise<AllocationConflict[]>;
}

/**
 * 批量分配：勾选多位员工，与选中的设备**严格一一对应**后一次提交。
 *
 * 为什么是「自动配对 + 显式展示」而不是黑盒：
 * 配对靠「设备资产编号升序 × 员工勾选顺序」，一旦顺序不合意就会出现
 * 「某人拿到显示器、而他要的是笔记本」这种没人能一眼看出的错误，
 * 所以配对结果必须看得见、能逐行换人、冲突能就地摘除。
 */
export function BatchAllocateDialog({
  open,
  onOpenChange,
  assets,
  excludedCount,
  allAssets,
  categories,
  employees,
  departments,
  loading,
  onConfirm,
}: BatchAllocateDialogProps) {
  // 员工按勾选顺序排列 —— 这个数组同时是「已选人员」和「配对顺序」的唯一来源
  const [employeeIds, setEmployeeIds] = React.useState<number[]>([]);
  // 服务端拒绝后回填的结构化冲突；任何选择变化都会清空
  const [serverConflicts, setServerConflicts] = React.useState<AllocationConflict[]>([]);

  React.useEffect(() => {
    if (!open) {
      setEmployeeIds([]);
      setServerConflicts([]);
    }
  }, [open]);

  const orderedEmployees = React.useMemo(
    () =>
      employeeIds
        .map((id) => employees.find((e) => e.id === id))
        .filter((e): e is PickerEmployee => Boolean(e)),
    [employeeIds, employees]
  );

  const pairing = React.useMemo(
    () => annotatePairConflicts(buildAllocationPairs(assets, orderedEmployees), {
      allAssets,
      categories,
    }),
    [assets, orderedEmployees, allAssets, categories]
  );
  const summary = React.useMemo(() => summarizePairing(pairing), [pairing]);

  const serverReasonByAsset = React.useMemo(
    () => new Map(serverConflicts.map((c) => [c.assetId, c.reason])),
    [serverConflicts]
  );

  const blockingCount =
    summary.conflictCount +
    pairing.pairs.filter((p) => p.conflict === null && serverReasonByAsset.has(p.asset.id)).length;

  const canSubmit = summary.canSubmit && serverConflicts.length === 0;

  const mutate = (updater: (prev: number[]) => number[]) => {
    setServerConflicts([]);
    setEmployeeIds(updater);
  };

  const toggleEmployee = (id: number) =>
    mutate((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 换人 = 与目标行交换使用人，维持严格 1:1 不变 */
  const swapEmployee = (rowIndex: number, employeeId: number) =>
    mutate((prev) => {
      const next = [...prev];
      const target = next.indexOf(employeeId);
      if (target < 0 || target === rowIndex) return prev;
      [next[rowIndex], next[target]] = [next[target], next[rowIndex]];
      return next;
    });

  const removeAt = (rowIndex: number) => mutate((prev) => prev.filter((_, i) => i !== rowIndex));

  const submit = async () => {
    if (!canSubmit || loading) return;
    const payload = pairing.pairs.map((p) => ({
      assetId: p.asset.id,
      employeeId: p.employee.id,
    }));
    const conflicts = await onConfirm(payload);
    setServerConflicts(conflicts ?? []);
  };

  // 提交按钮被禁用时必须说明原因，否则用户只会觉得「按钮坏了」
  const blockReason = assets.length === 0
    ? "所选设备中没有可分配的闲置设备"
    : summary.missingEmployees > 0
      ? `还差 ${summary.missingEmployees} 位员工`
      : summary.extraEmployees > 0
        ? `多选了 ${summary.extraEmployees} 位员工`
        : blockingCount > 0
          ? `有 ${blockingCount} 对存在冲突`
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>批量分配设备</DialogTitle>
          <DialogDescription>
            已选 {assets.length} 台闲置设备，需与 {assets.length} 位员工严格一一对应。
            设备按资产编号升序、员工按勾选顺序自动配对，可逐行换人。
          </DialogDescription>
        </DialogHeader>

        {excludedCount > 0 && (
          <p className={cn("rounded-md border px-3 py-2 text-xs", TONE_CHIP.warning)}>
            另有 {excludedCount} 台所选设备不是「闲置」状态，未纳入本次分配。
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section aria-label="选择员工" className="min-w-0 space-y-2">
            <h3 className="font-medium">选择员工</h3>
            <EmployeePickList
              employees={employees}
              departments={departments}
              selectedIds={employeeIds}
              onToggle={toggleEmployee}
              idPrefix="batch-allocate"
              listClassName="max-h-[280px]"
              searchLabel="搜索待分配员工"
            />
          </section>

          <section aria-label="配对结果" className="min-w-0 space-y-2">
            <h3 className="font-medium">配对结果</h3>
            <div className="max-h-[328px] overflow-y-auto rounded-md border border-border bg-card">
              <div className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,88px)] gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <span>#</span>
                <span>设备</span>
                <span>使用人</span>
              </div>

              <ul className="divide-y divide-border" aria-label="设备与使用人的配对结果">
                {pairing.pairs.map((row, rowIndex) => {
                  const reason = row.conflict?.message ?? serverReasonByAsset.get(row.asset.id) ?? null;
                  return (
                    <li
                      key={row.asset.id}
                      className={cn("px-3 py-2", reason && cn(TONE_SOFT.danger, "border-l-2 border-destructive"))}
                    >
                      <div className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,88px)] items-center gap-2 text-sm">
                        <span className="text-xs text-muted-foreground">{row.index}</span>
                        <span className="min-w-0 truncate" title={`${row.asset.assetNo} ${row.asset.name}`}>
                          {row.asset.assetNo}
                        </span>
                        <span className="min-w-0 truncate" title={row.employee.name}>
                          {row.employee.name}
                        </span>
                      </div>

                      {reason && <p className={cn("mt-1 text-xs", TONE_TEXT.danger)}>{reason}</p>}

                      <div className="mt-1 flex justify-end gap-3">
                        <SwapControl
                          candidates={orderedEmployees}
                          currentEmployeeId={row.employee.id}
                          onPick={(employeeId) => swapEmployee(rowIndex, employeeId)}
                          rowIndex={row.index}
                        />
                        <button
                          type="button"
                          onClick={() => removeAt(rowIndex)}
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          摘除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {pairing.pairs.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  还没有可配对的组合
                </p>
              )}

              {summary.pairCount > 0 && summary.pairCount < assets.length && (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  还有 {assets.length - summary.pairCount} 台设备待配对
                </p>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md border px-2.5 py-1 text-xs", TONE_CHIP.neutral)}>
              已选 {summary.assetCount} 台
            </span>
            <span className={cn("rounded-md border px-2.5 py-1 text-xs", TONE_CHIP.neutral)}>
              已选 {summary.employeeCount} 人
            </span>
            {blockReason && (
              <span className={cn("rounded-md border px-2.5 py-1 text-xs", TONE_CHIP.warning)}>
                {blockReason}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={submit} disabled={loading || !canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  分配中…
                </>
              ) : (
                "确认分配"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 逐行换人：与目标行交换使用人，保持严格 1:1 */
function SwapControl({
  candidates,
  currentEmployeeId,
  onPick,
  rowIndex,
}: {
  candidates: readonly PickerEmployee[];
  currentEmployeeId: number;
  onPick: (employeeId: number) => void;
  rowIndex: number;
}) {
  const [open, setOpen] = React.useState(false);
  const others = candidates.filter((e) => e.id !== currentEmployeeId);

  if (others.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`为第 ${rowIndex} 台设备换人`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
          换人
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          与下列人员交换（保持一一对应）
        </p>
        <ul>
          {others.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(e.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">{e.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.departmentName}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
