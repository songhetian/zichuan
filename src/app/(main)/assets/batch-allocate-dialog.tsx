"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { EmployeePicker, type EmployeeOption } from "@/components/ui/employee-picker";
import { SelectionContextBar } from "@/components/features/selection-context-bar";
import { AllocationPreview, buildAllocateSubmitLabel } from "@/components/features/allocation-preview";
import { summarizeSelection } from "@/lib/asset-selection-summary";
import { describeAllocationRule } from "@/lib/allocation-rule-text";
import { planAllocation, type AllocationAsset, type AllocationEmployee } from "@/lib/allocation";
import { allocateAssetsToEmployees } from "@/actions/lifecycle.actions";
import { useToast } from "@/hooks/use-toast";

/** 弹窗只需要这几个字段，不依赖列表页的 AssetItem 全量类型 */
export interface SelectableAsset {
  id: number;
  assetNo: string;
  status: string;
  categoryId: number;
  categoryName: string;
  employeeId: number | null;
}

export interface AllocationCategoryOption {
  id: number;
  name: string;
  unique: boolean;
}

interface BatchAllocateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前选中的设备 */
  assets: SelectableAsset[];
  employees: EmployeeOption[];
  categories: AllocationCategoryOption[];
  /** 每个员工已持有的「唯一」分类 id（由页面用全量快照算好；弹窗只有选中设备） */
  employeeOwnedUniqueCategories: Map<number, number[]>;
  /** 分配成功后回调，供列表页清空选中与刷新 */
  onAllocated: () => void;
}

/**
 * 批量分配弹窗：左栏多选员工，右栏实时分配预览。
 *
 * 预校验与提交走同一个 `planAllocation`（前端预览 / 服务端复核），所以「预览里说能分
 * 4 台」和「实际落 4 台」不会出现口径不一致。
 */
export function BatchAllocateDialog({
  open,
  onOpenChange,
  assets,
  employees,
  categories,
  employeeOwnedUniqueCategories,
  onAllocated,
}: BatchAllocateDialogProps) {
  const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const uniqueCategoryIds = new Set(categories.filter((c) => c.unique).map((c) => c.id));

  const summary = summarizeSelection(
    assets.map((a) => ({ assetNo: a.assetNo, categoryName: a.categoryName }))
  );
  const categoryIds = [...new Set(assets.map((a) => a.categoryId))];
  const ruleText =
    categoryIds.length === 1
      ? describeAllocationRule(categories.find((c) => c.id === categoryIds[0]))
      : undefined;

  // 员工多于设备时禁止提交：配额会算出 0，用户无法核对「谁多拿了一台」
  const employeeOverflow = employeeIds.length > assets.length;

  // 「唯一分类」下已持有该分类的员工，槽位会被 planAllocation 判无效（口径完全一致，
  // 只认唯一分类）。就地标在选人列表里，免得选完才在预览里看到一整片冲突。
  const unavailableReasons = new Map<number, string>();
  for (const e of employees) {
    const owned = employeeOwnedUniqueCategories.get(e.id);
    if (!owned || owned.length === 0) continue;
    const hit = owned.find((id) => categoryIds.includes(id));
    if (hit === undefined) continue;
    const name = categories.find((c) => c.id === hit)?.name ?? "同类设备";
    unavailableReasons.set(e.id, `已持有${name}`);
  }

  const plan =
    employeeIds.length === 0 || employeeOverflow
      ? null
      : planAllocation(
          assets.map<AllocationAsset>((a) => ({
            id: a.id,
            assetNo: a.assetNo,
            status: a.status,
            categoryId: a.categoryId,
            categoryName: a.categoryName,
            categoryUnique: uniqueCategoryIds.has(a.categoryId),
            employeeId: a.employeeId,
          })),
          employeeIds
            .map((id) => employees.find((e) => e.id === id))
            .filter((e): e is EmployeeOption => Boolean(e))
            .map<AllocationEmployee>((e) => ({
              id: e.id,
              name: e.name,
              employeeNo: e.employeeNo ?? "",
              departmentId: e.departmentId,
              departmentName: e.departmentName,
              ownedUniqueCategoryIds: employeeOwnedUniqueCategories.get(e.id) ?? [],
            }))
        );

  const close = () => {
    setEmployeeIds([]);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!plan || plan.assignments.length === 0) return;
    setLoading(true);
    const result = await allocateAssetsToEmployees({
      assignments: plan.assignments,
      operator: "admin",
      remark: "批量分配",
    });
    setLoading(false);

    if (!result.success) {
      toast({ title: "批量分配失败", description: result.error, variant: "destructive" });
      return;
    }

    const { allocatedCount, skipped } = result.data;
    toast({
      title: `已分配 ${allocatedCount} 台`,
      description:
        skipped.length > 0
          ? `跳过 ${skipped.length} 台：${skipped[0].reason}${skipped.length > 1 ? " 等" : ""}`
          : undefined,
    });
    setEmployeeIds([]);
    onOpenChange(false);
    onAllocated();
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量分配设备</DialogTitle>
          <DialogDescription>
            为选中的 {assets.length} 台设备指定使用人，可分给多位员工
          </DialogDescription>
        </DialogHeader>

        <SelectionContextBar
          summary={summary}
          ruleText={ruleText}
          icon={UserPlus}
          accentClassName="text-emerald-500"
        />

        {employeeOverflow ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            已选 {employeeIds.length} 位员工，多于 {assets.length} 台设备。请减少员工，或补选设备后再分配。
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <EmployeePicker
            mode="multiple"
            employees={employees}
            value={employeeIds}
            onValueChange={setEmployeeIds}
            placeholder="选择员工"
            unavailableReasons={unavailableReasons}
          />
          <div className="space-y-2">
            {plan ? (
              <AllocationPreview plan={plan} employees={employees} />
            ) : (
              <div className="flex h-full min-h-[140px] items-center justify-center rounded-md border border-dashed px-4 text-center text-xs text-muted-foreground">
                选择员工后，这里会显示每人分到几台，以及分不出去的原因
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t-0">
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !plan || plan.assignments.length === 0}
          >
            {loading ? "分配中..." : buildAllocateSubmitLabel(plan?.assignments.length ?? 0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
