"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmployeeDevicePreview } from "@/components/features/employee-device-preview";
import {
  getDepartureCheckInfo,
  type DepartureCheckInfo,
} from "@/actions/approval-depart.actions";

type CheckState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; info: DepartureCheckInfo };

/**
 * 离职审批的「核对设备」入口。
 *
 * 离职流程的两个节点（部门主管 → 资产管理员）都要在**点通过之前**看清
 * 这名员工名下有哪些设备。面板固定挂在审批操作区上方，形成「核对 → 通过」的顺序。
 *
 * 数据走 getDepartureCheckInfo（授权口径 = 你是这张单的相关人），
 * 而不是 /employees/[id]：那两个角色都没有 `employee.view` 权限。
 */
export function DepartureCheckPanel({ requestId }: { requestId: number }) {
  const [state, setState] = useState<CheckState>({ phase: "loading" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    getDepartureCheckInfo(requestId)
      .then((res) => {
        if (cancelled) return;
        if (res.success) setState({ phase: "ready", info: res.data });
        else setState({ phase: "error", message: res.error ?? "加载失败" });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error", message: "加载异常，请稍后重试" });
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (state.phase === "error") {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        无法加载名下设备：{state.message}
      </div>
    );
  }

  if (state.phase === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">正在读取该员工名下设备…</p>
      </div>
    );
  }

  const { employee, assets } = state.info;
  const count = assets.length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/20 bg-primary/[0.02] px-4 py-3">
        <ClipboardCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">通过前请先核对名下设备</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {count === 0
              ? "该员工名下暂无设备，可直接通过。"
              : `${count} 台设备待交接，请确认实物已回收或已在交接中，再予以通过。`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setOpen(true)}
        >
          查看名下设备
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-3xl">
          <DialogHeader>
            <DialogTitle>查看 {employee.name} 名下设备</DialogTitle>
            <DialogDescription>
              {`共 ${count} 台，核对实物无误后再通过本申请。本页只读。`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <EmployeeDevicePreview employee={employee} assets={assets} embedded />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
