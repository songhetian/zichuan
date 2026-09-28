"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import {
  getPendingExecutionRequests,
  getExecutableDetail,
  executeApprovedChange,
  executeReplaceChange,
  executeRepairChange,
  PendingExecutionRequest,
  ExecutableDetail,
} from "@/actions/approval-execute.actions";

type AdjustmentRow = {
  key: string;
  modelId: number;
  modelName: string;
  quantityDelta: number;
  isAdd: boolean; // true=从库存加，false=从设备减
};

const ACTION_BADGE: Record<string, { label: string; variant: "default" | "secondary" }> = {
  UPGRADE: { label: "升级", variant: "default" },
  DOWNGRADE: { label: "降级", variant: "secondary" },
};

const TYPE_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  ASSET_UPGRADE: { label: "升级/降级", variant: "default" },
  ASSET_REPLACE: { label: "更换", variant: "secondary" },
  ASSET_REPAIR: { label: "维修", variant: "outline" },
};

const TYPE_TABS = [
  { value: "", label: "全部" },
  { value: "ASSET_UPGRADE", label: "升级/降级" },
  { value: "ASSET_REPLACE", label: "更换" },
  { value: "ASSET_REPAIR", label: "维修" },
];

export function ExecuteClient() {
  const { toast } = useToast();
  const [items, setItems] = useState<PendingExecutionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ExecutableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [replacementAssetId, setReplacementAssetId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getPendingExecutionRequests();
      if (result.success) setItems(result.data);
      else toast({ title: "加载失败", description: result.error, variant: "destructive" });
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleItems = typeFilter ? items.filter((r) => r.businessType === typeFilter) : items;

  const openDetail = async (requestId: number) => {
    setOpenId(requestId);
    setDetail(null);
    setRows([]);
    setReplacementAssetId(null);
    setDetailLoading(true);
    try {
      const result = await getExecutableDetail(requestId);
      if (result.success) {
        setDetail(result.data);
        if (result.data.currentComponents) {
          setRows([
            {
              key: `${Date.now()}`,
              modelId: 0,
              modelName: "",
              quantityDelta: 1,
              isAdd: true,
            },
          ]);
        }
      } else {
        toast({ title: "获取详情失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => setOpenId(null);

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { key: `${Date.now()}-${prev.length}`, modelId: 0, modelName: "", quantityDelta: 1, isAdd: true },
    ]);

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const onModelChange = (key: string, modelId: number) => {
    const comp = detail?.currentComponents?.find((c) => c.modelId === modelId);
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const name =
          detail?.categoryModels?.find((m) => m.modelId === modelId)?.modelName ??
          comp?.modelName ??
          "";
        return { ...r, modelId, modelName: name };
      })
    );
  };

  const runExecute = async (
    run: () => Promise<{ success: boolean; error?: string }>,
    okHint: string
  ) => {
    setSubmitting(true);
    try {
      const result = await run();
      if (result.success) {
        toast({ title: "执行成功", description: okHint });
        closeDetail();
        await load();
      } else {
        toast({ title: "执行失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "执行失败", description: "执行异常，请稍后重试", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    if (!detail) return;

    // 更换 / 维修：选替换机
    if (detail.businessType === "ASSET_REPLACE" || detail.businessType === "ASSET_REPAIR") {
      if (!replacementAssetId) {
        toast({ title: "请选择替换机", variant: "destructive" });
        return;
      }
      return runExecute(
        () =>
          detail.businessType === "ASSET_REPLACE"
            ? executeReplaceChange(detail.requestId, replacementAssetId)
            : executeRepairChange(detail.requestId, replacementAssetId),
        detail.businessType === "ASSET_REPLACE" ? "设备更换已生效" : "维修替换已生效"
      );
    }

    // 升级 / 降级：配件调整
    const valid = rows.filter((r) => r.modelId !== 0 && r.quantityDelta > 0);
    if (valid.length === 0) {
      toast({ title: "请选择配件型号和数量", variant: "destructive" });
      return;
    }
    // 转成 { modelId, quantityDelta: 加则为正，减则为负 }
    const adjustments = valid.map((r) => ({
      modelId: r.modelId,
      quantityDelta: r.isAdd ? r.quantityDelta : -r.quantityDelta,
    }));

    return runExecute(
      () => executeApprovedChange(detail.requestId, adjustments),
      "配件变更已生效"
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title="待执行变更" description="审批已通过、由你完成的升级/降级、更换、维修申请" />

      <div className="flex items-center gap-2 border-b">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value || "all"}
            type="button"
            onClick={() => setTypeFilter(tab.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              typeFilter === tab.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>待执行申请</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">单号</TableHead>
                <TableHead className="w-[90px]">类型</TableHead>
                <TableHead>设备</TableHead>
                <TableHead className="w-[110px]">配件类别</TableHead>
                <TableHead className="w-[80px]">动作</TableHead>
                <TableHead>申请原因</TableHead>
                <TableHead className="w-[140px]">提交时间</TableHead>
                <TableHead className="w-[90px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.requestNo}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_BADGE[r.businessType]?.variant ?? "outline"}>
                      {TYPE_BADGE[r.businessType]?.label ?? r.businessType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.assetNo}
                    {r.assetName ? ` · ${r.assetName}` : ""}
                  </TableCell>
                  <TableCell>{r.categoryName}</TableCell>
                  <TableCell>
                    {r.action ? (
                      <Badge variant={ACTION_BADGE[r.action]?.variant ?? "secondary"}>
                        {ACTION_BADGE[r.action]?.label ?? r.action}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="truncate">{r.reason}</TableCell>
                  <TableCell>{formatTime(r.submittedAt)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => openDetail(r.id)}
                    >
                      执行
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {visibleItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无待执行申请"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={openId !== null} onOpenChange={(v) => !v && closeDetail()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.businessType === "ASSET_REPLACE"
                ? "执行设备更换"
                : detail?.businessType === "ASSET_REPAIR"
                  ? "执行设备维修"
                  : "执行配件变更"}
            </DialogTitle>
            <DialogDescription>该申请已审批通过，确认后由你完成最终执行</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-10 text-center text-muted-foreground">加载中...</div>
          ) : detail ? (
            <div className="space-y-4 text-sm">
              {/* 元信息条 */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">单号</dt>
                  <dd className="mt-0.5 font-mono font-medium">{detail.requestNo}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">业务类型</dt>
                  <dd className="mt-0.5 font-medium">
                    {TYPE_BADGE[detail.businessType]?.label ?? detail.businessType}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">设备</dt>
                  <dd className="mt-0.5 truncate font-medium">
                    {detail.assetNo}
                    {detail.assetName ? ` · ${detail.assetName}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">配件类别</dt>
                  <dd className="mt-0.5 font-medium">{detail.categoryName || "—"}</dd>
                </div>
              </dl>

              {/* 申请原因 */}
              <div className="rounded-md border border-border/70 bg-card p-3">
                <p className="mb-1 text-xs text-muted-foreground">申请原因</p>
                <p className="whitespace-pre-wrap leading-relaxed">{detail.reason || "—"}</p>
              </div>

              {detail.businessType === "ASSET_REPLACE" || detail.businessType === "ASSET_REPAIR" ? (
                /* 更换/维修：选择替换机 */
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">选择替换机</Label>
                  <SearchableSelect
                    options={(detail.availableAssets ?? []).map((a) => ({
                      value: String(a.assetId),
                      label: a.assetNo,
                      description: a.assetName,
                    }))}
                    value={replacementAssetId ? String(replacementAssetId) : ""}
                    onValueChange={(v) => setReplacementAssetId(v ? Number(v) : null)}
                    placeholder="搜索并选择一台闲置设备"
                    searchPlaceholder="按设备编号 / 名称搜索"
                    emptyText="无可用的闲置设备"
                    triggerClassName="w-full"
                  />
                  {(!detail.availableAssets || detail.availableAssets.length === 0) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      当前无可选的闲置设备，请先归还设备后再执行
                    </p>
                  )}
                </div>
              ) : (
                /* 升级/降级：配件调整 */
                <div className="space-y-4">
                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">设备当前配件</Label>
                    {!detail.currentComponents || detail.currentComponents.length === 0 ? (
                      <p className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        该设备暂无配件
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {detail.currentComponents.map((c) => (
                          <span
                            key={c.assetComponentId}
                            className="inline-flex items-baseline gap-1.5 rounded-md border border-border/80 bg-card px-2.5 py-1.5"
                          >
                            <span className="text-sm text-foreground">{c.modelName}</span>
                            <span className="text-xs text-muted-foreground">×{c.quantity}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">
                      变更明细{" "}
                      <span className="font-normal">（增加=从库存出库，减少=退回库存）</span>
                    </Label>
                    <div className="overflow-hidden rounded-lg border border-border/80">
                      <div className="grid grid-cols-[1fr_7rem_5rem_2.25rem] items-center gap-2 border-b border-border/80 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                        <span>配件型号</span>
                        <span>操作</span>
                        <span>数量</span>
                        <span />
                      </div>
                      <div className="divide-y divide-border/70">
                        {rows.map((r) => (
                          <div key={r.key} className="grid grid-cols-[1fr_7rem_5rem_2.25rem] items-center gap-2 bg-card px-3 py-2.5">
                            <Select
                              value={r.modelId ? String(r.modelId) : ""}
                              onValueChange={(v) => onModelChange(r.key, Number(v))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="选择型号" />
                              </SelectTrigger>
                              <SelectContent>
                                {detail.categoryModels?.map((m) => (
                                  <SelectItem key={m.modelId} value={String(m.modelId)}>
                                    {m.modelName}（库存 {m.stock}）
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={r.isAdd ? "add" : "remove"}
                              onValueChange={(v) =>
                                setRows((prev) =>
                                  prev.map((x) => (x.key === r.key ? { ...x, isAdd: v === "add" } : x))
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="add">增加</SelectItem>
                                <SelectItem value="remove">减少</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              min={1}
                              className="w-full"
                              value={r.quantityDelta}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((x) =>
                                    x.key === r.key
                                      ? { ...x, quantityDelta: Math.max(1, Number(e.target.value) || 1) }
                                      : x
                                  )
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9"
                              onClick={() => removeRow(r.key)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {rows.length === 0 && (
                          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                            暂无变更项，点击下方「加一行」添加
                          </div>
                        )}
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addRow}>
                      <Plus className="mr-1 h-4 w-4" /> 加一行
                    </Button>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDetail} disabled={submitting}>
                  取消
                </Button>
                <Button type="button" onClick={submit} disabled={submitting || detailLoading}>
                  {submitting ? "执行中..." : "确认执行"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="py-10 text-center text-muted-foreground">无法获取详情</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}