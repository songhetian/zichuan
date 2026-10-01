"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import { getStatusLabel } from "@/lib/status-labels";
import {
  getHandoverOrders,
  type HandoverOrderListItem,
} from "@/actions/approval-depart.actions";
import { confirmHandover } from "@/actions/approval-execute.actions";

const STATUS_TEXT: Record<string, string> = {
  PENDING: "待对账",
  COLLECTED: "已回收",
};

type TabValue = "" | "PENDING" | "COLLECTED";

const TABS: { value: TabValue; label: string }[] = [
  { value: "PENDING", label: "待对账" },
  { value: "COLLECTED", label: "已回收" },
  { value: "", label: "全部" },
];

/**
 * 「交接对账」列表页。
 *
 * 为什么需要它：离职单终审通过只生成 PENDING 交接单，**设备还没回收**；
 * 但回收入口原先只长在离职单详情页里，资产管理员得先知道是哪张单才进得去。
 * 这里把待对账的单集中摆出来，就地核对快照后回收（回收口径与详情页同一 action）。
 */
export function HandoverListClient({ initial }: { initial: HandoverOrderListItem[] }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState(initial);
  // 默认落在「待对账」：这是资产管理员进这个页面的目的
  const [tab, setTab] = useState<TabValue>("PENDING");
  const [active, setActive] = useState<HandoverOrderListItem | null>(null);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openCheck = (order: HandoverOrderListItem) => {
    setActive(order);
    setRemark("");
    setError(null);
  };

  const reload = async (next: TabValue = tab) => {
    const res = await getHandoverOrders(next ? { status: next } : undefined);
    if (res.success) setOrders(res.data);
  };

  const changeTab = async (next: TabValue) => {
    setTab(next);
    await reload(next);
  };

  const runConfirm = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    const res = await confirmHandover(active.orderId, remark.trim() || undefined);
    setBusy(false);
    if (res.success) {
      toast({
        variant: "success",
        title: "已回收",
        description: `${active.assetCount} 台设备已置为闲置`,
      });
      setActive(null);
      await reload();
    } else {
      // 失败留在弹窗里说明原因，不静默关闭
      setError(res.error ?? "对账回收失败");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="交接对账"
        description="离职单通过后设备冻结为交接单，核对实物无误后确认回收至闲置池"
      />

      <div className="flex items-center gap-2 border-b">
        {TABS.map((t) => (
          <button
            key={t.value || "all"}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => changeTab(t.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>交接单号</TableHead>
              <TableHead>离职员工</TableHead>
              <TableHead className="text-right">应回收</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>生成时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  暂无交接单。离职单终审通过后会自动生成待对账单并通知资产管理员。
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.orderId}>
                <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                <TableCell>
                  <span className="font-medium">{o.employeeName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {o.employeeNo} · {o.departmentName}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.assetCount} 台</TableCell>
                <TableCell className="text-sm">{STATUS_TEXT[o.status] ?? o.status}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatTime(o.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  {o.status === "PENDING" && o.canConfirm ? (
                    <Button type="button" size="sm" onClick={() => openCheck(o)}>
                      对账回收
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {o.status === "COLLECTED" ? "已完成" : "由资产管理员处理"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={active !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setActive(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <PackageCheck className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div className="min-w-0">
                <DialogTitle>对账回收</DialogTitle>
                <DialogDescription className="mt-1">
                  交接单 <span className="font-mono">{active?.orderNo}</span>
                  {active ? ` · ${active.employeeName}（${active.employeeNo} · ${active.departmentName}）` : ""}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              请按下面这份清单逐台核对实物（清单在离职单通过时冻结）：
            </p>
            <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
              {active?.items.map((item) => (
                <li key={item.assetId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {item.assetNo}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {getStatusLabel(item.status)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5">
              <Label htmlFor="handover-list-remark" className="text-xs text-muted-foreground">
                对账备注
              </Label>
              <Textarea
                id="handover-list-remark"
                rows={2}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="选填，如：两台均已在库"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={busy}>
              取消
            </Button>
            <Button onClick={runConfirm} disabled={busy}>
              {busy ? "处理中..." : `确认回收 ${active?.assetCount ?? 0} 台设备`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
