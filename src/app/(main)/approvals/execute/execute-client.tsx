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
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
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
  const canExecute = usePermission("asset.upgrade.execute");
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
    const result = await getPendingExecutionRequests();
    setLoading(false);
    if (result.success) setItems(result.data);
    else toast({ title: "加载失败", description: result.error, variant: "destructive" });
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
    const result = await getExecutableDetail(requestId);
    setDetailLoading(false);
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
    const result = await run();
    setSubmitting(false);
    if (result.success) {
      toast({ title: "执行成功", description: okHint });
      closeDetail();
      await load();
    } else {
      toast({ title: "执行失败", description: result.error, variant: "destructive" });
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
      <PageHeader title="待执行变更" description="审批已通过、由资产管理员执行的升级/降级、更换、维修申请" />

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
                      disabled={!canExecute}
                      title={canExecute ? undefined : "没有执行权限"}
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
              {detail?.businessType === "ASSET_REPLACE" || detail?.businessType === "ASSET_REPAIR"
                ? "选定替换机"
                : "执行配件变更"}
            </DialogTitle>
            {detail && (
              <DialogDescription>
                单号 {detail.requestNo} · 设备 {detail.assetNo}
                {detail.assetName ? ` · ${detail.assetName}` : ""}
                {detail.categoryName ? ` · 类别「${detail.categoryName}」` : ""}
                {detail.action && (
                  <Badge variant="default" className="ml-2">
                    {detail.action === "UPGRADE" ? "升级" : "降级"}
                  </Badge>
                )}
              </DialogDescription>
            )}
          </DialogHeader>

          {detailLoading ? (
            <div className="py-8 text-center text-muted-foreground">加载中...</div>
          ) : detail ? (
            <>
              {detail.businessType === "ASSET_REPLACE" || detail.businessType === "ASSET_REPAIR" ? (
                /* 更换/维修：选择替换机 */
                <div className="space-y-4">
                  <div>
                    <Label className="mb-1 block text-sm text-muted-foreground">申请原因</Label>
                    <p className="text-sm">{detail.reason || "—"}</p>
                  </div>
                  <div>
                    <Label className="mb-1 block text-sm text-muted-foreground">选择替换机</Label>
                    <Select
                      value={replacementAssetId ? String(replacementAssetId) : ""}
                      onValueChange={(v) => setReplacementAssetId(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择一台闲置设备" />
                      </SelectTrigger>
                      <SelectContent>
                        {detail.availableAssets?.map((a) => (
                          <SelectItem key={a.assetId} value={String(a.assetId)}>
                            {a.assetNo} · {a.assetName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(!detail.availableAssets || detail.availableAssets.length === 0) && (
                      <p className="mt-1 text-xs text-muted-foreground">暂无可用的闲置设备</p>
                    )}
                  </div>
                </div>
              ) : (
                /* 升级/降级：配件调整 */
                <div className="space-y-4">
                {/* 当前配件 */}
                <div>
                  <Label className="mb-1 block text-sm text-muted-foreground">设备当前配件</Label>
                  {!detail.currentComponents || detail.currentComponents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">该设备暂无配件</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {detail.currentComponents.map((c) => (
                        <Badge key={c.assetComponentId} variant="outline">
                          {c.modelName} ×{c.quantity}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* 变更行 */}
                <div>
                  <Label className="mb-1 block text-sm text-muted-foreground">变更明细（增加=从库存出库，减少=退回库存）</Label>
                  <div className="space-y-2">
                    {rows.map((r) => {
                      const stock = detail.categoryModels?.find((m) => m.modelId === r.modelId)?.stock;
                      return (
                        <div key={r.key} className="flex items-center gap-2">
                          <div className="w-[110px]">
                            <Select
                              value={r.modelId ? String(r.modelId) : ""}
                              onValueChange={(v) => onModelChange(r.key, Number(v))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="选型号" />
                              </SelectTrigger>
                              <SelectContent>
                                {detail.categoryModels?.map((m) => (
                                  <SelectItem key={m.modelId} value={String(m.modelId)}>
                                    {m.modelName}（库存 {m.stock}）
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-[110px]">
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
                          </div>
                          <Input
                            type="number"
                            min={1}
                            className="w-20"
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
                          <span className="w-24 truncate text-sm text-muted-foreground">{r.modelName}</span>
                          {r.isAdd && r.modelId !== 0 && (
                            <span className="w-20 text-xs text-muted-foreground">
                              {stock !== undefined ? `剩余库存 ${stock}` : ""}
                            </span>
                          )}
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(r.key)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
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
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground">无法获取详情</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}