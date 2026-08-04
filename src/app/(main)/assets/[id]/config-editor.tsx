"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GripVertical,
  Plus,
  Minus,
  X,
  Search,
  Package,
  Check,
  Undo2,
} from "lucide-react";
import { adjustAssetComponents } from "@/actions/lifecycle.actions";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

// ============================================================
// 类型定义
// ============================================================

interface ComponentItem {
  modelId: number;
  name: string;
  brand: string | null;
  categoryName: string;
  stock: number;
}

interface CurrentComponent extends ComponentItem {
  quantity: number;
}

interface ConfigEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: number;
  assetNo: string;
  assetName: string;
  currentComponents: CurrentComponent[];
  componentModels: ComponentItem[];
  disabled?: boolean;
}

// ============================================================
// 主组件：拖拽式配置编辑器
// ============================================================

export function ConfigEditor({
  open,
  onOpenChange,
  assetId,
  assetNo,
  assetName,
  currentComponents,
  componentModels,
  disabled,
}: ConfigEditorProps) {
  const router = useRouter();
  const { toast } = useToast();

  // 当前配置（本地副本，用于编辑）
  const [current, setCurrent] = useState<CurrentComponent[]>([]);
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [draggedItem, setDraggedItem] = useState<{
    type: "library" | "current";
    modelId: number;
  } | null>(null);
  const [dragOverZone, setDragOverZone] = useState<"current" | "library" | null>(null);
  // 待删除确认：modelId → true（用户点击 × 后需二次确认）
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  // 弹窗打开时初始化当前配置
  // 注意：必须用 useEffect 监听 open，而不是 onOpenChange 回调
  // 因为 Radix Dialog 是受控组件，当 open 从外部按钮变为 true 时，
  // onOpenChange 不会被触发（它只在用户点击关闭按钮/ESC/遮罩时触发）
  useEffect(() => {
    if (open) {
      setCurrent(currentComponents.map((c) => ({ ...c })));
      setRemark("");
      setSearch("");
      setPendingDelete(null);
    }
    // 仅在 open 变化时初始化，避免编辑过程中被父组件 re-render 覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
  };

  // 过滤配件库（搜索 + 排除已在当前配置中的）
  const libraryItems = useMemo(() => {
    const currentIds = new Set(current.map((c) => c.modelId));
    return componentModels.filter((m) => {
      if (currentIds.has(m.modelId)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        (m.brand ?? "").toLowerCase().includes(q) ||
        m.categoryName.toLowerCase().includes(q)
      );
    });
  }, [componentModels, current, search]);

  // ===== 当前配置操作 =====

  // 点击 × 后进入待确认状态（不立即删除）
  const requestDelete = (modelId: number) => {
    setPendingDelete(modelId);
  };

  // 确认删除：真正从当前配置移除
  const confirmDelete = (modelId: number) => {
    setCurrent((prev) => prev.filter((c) => c.modelId !== modelId));
    setPendingDelete(null);
  };

  // 取消删除
  const cancelDelete = () => {
    setPendingDelete(null);
  };

  const changeCurrentQty = (modelId: number, delta: number) => {
    setCurrent((prev) =>
      prev.map((c) => {
        if (c.modelId === modelId) {
          // 数量最低保留 1（要删除请点 ×）
          const newQty = Math.max(1, c.quantity + delta);
          return { ...c, quantity: newQty };
        }
        return c;
      })
    );
  };

  const addToCurrent = (item: ComponentItem) => {
    setCurrent((prev) => {
      const existing = prev.find((c) => c.modelId === item.modelId);
      if (existing) {
        return prev.map((c) =>
          c.modelId === item.modelId
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  // ===== 拖拽事件 =====

  const handleDragStart = (type: "library" | "current", modelId: number) => {
    setDraggedItem({ type, modelId });
  };

  const handleDragOver = (e: React.DragEvent, zone: "current" | "library") => {
    e.preventDefault();
    setDragOverZone(zone);
  };

  const handleDrop = (zone: "current" | "library") => {
    if (!draggedItem) return;

    if (zone === "current" && draggedItem.type === "library") {
      // 从配件库拖到当前配置 = 添加
      const item = componentModels.find((m) => m.modelId === draggedItem.modelId);
      if (item) addToCurrent(item);
    } else if (zone === "library" && draggedItem.type === "current") {
      // 从当前配置拖回配件库 = 请求确认删除
      requestDelete(draggedItem.modelId);
    }

    setDraggedItem(null);
    setDragOverZone(null);
  };

  // ===== 计算调整差异 =====

  interface AdjustmentDetail {
    modelId: number;
    name: string;
    brand: string | null;
    categoryName: string;
    quantityDelta: number;
    oldQty: number;
    newQty: number;
    isNew: boolean;
    isRemoved: boolean;
  }

  const adjustments = useMemo<AdjustmentDetail[]>(() => {
    const result: AdjustmentDetail[] = [];

    // 原有配件的变化（数量变化或被删除）
    for (const orig of currentComponents) {
      const now = current.find((c) => c.modelId === orig.modelId);
      const delta = now ? now.quantity - orig.quantity : -orig.quantity;
      if (delta !== 0) {
        const model = componentModels.find((m) => m.modelId === orig.modelId);
        result.push({
          modelId: orig.modelId,
          name: model?.name ?? orig.name,
          brand: model?.brand ?? orig.brand,
          categoryName: model?.categoryName ?? orig.categoryName,
          quantityDelta: delta,
          oldQty: orig.quantity,
          newQty: now ? now.quantity : 0,
          isNew: false,
          isRemoved: !now,
        });
      }
    }

    // 新增的配件
    for (const now of current) {
      const existed = currentComponents.find((c) => c.modelId === now.modelId);
      if (!existed) {
        result.push({
          modelId: now.modelId,
          name: now.name,
          brand: now.brand,
          categoryName: now.categoryName,
          quantityDelta: now.quantity,
          oldQty: 0,
          newQty: now.quantity,
          isNew: true,
          isRemoved: false,
        });
      }
    }

    return result;
  }, [current, currentComponents, componentModels]);

  // 按分类分组
  const adjustmentsByCategory = useMemo(() => {
    const groups: Record<string, AdjustmentDetail[]> = {};
    for (const a of adjustments) {
      if (!groups[a.categoryName]) groups[a.categoryName] = [];
      groups[a.categoryName].push(a);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [adjustments]);

  // 新增和减少的数量统计
  const addCount = adjustments.filter((a) => a.quantityDelta > 0).reduce((s, a) => s + a.quantityDelta, 0);
  const removeCount = adjustments.filter((a) => a.quantityDelta < 0).reduce((s, a) => s + Math.abs(a.quantityDelta), 0);

  const hasChanges = adjustments.length > 0;

  // ===== 提交 =====

  const handleSubmit = async () => {
    if (!hasChanges) return;
    setLoading(true);
    const result = await adjustAssetComponents({
      assetId,
      adjustments: adjustments.map((a) => ({ modelId: a.modelId, quantityDelta: a.quantityDelta })),
      operator: "admin",
      remark: remark.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "配置调整成功" });
      handleOpenChange(false);
      router.refresh();
    } else {
      toast({ title: "调整失败", description: result.error, variant: "destructive" });
    }
  };

  // ===== 渲染 =====

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            配置调整
            <Badge variant="secondary" className="ml-2 font-mono">{assetNo}</Badge>
          </DialogTitle>
          <DialogDescription>
            拖拽配件库中的配件到当前配置即可添加；点击 × 移除配件（需二次确认）；数量调整支持升级 / 降级 / 改配
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
          {/* ===== 左侧：当前配置 ===== */}
          <div
            className={`flex flex-col rounded-lg border-2 border-dashed transition-colors ${
              dragOverZone === "current" ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => handleDragOver(e, "current")}
            onDragLeave={() => setDragOverZone(null)}
            onDrop={() => handleDrop("current")}
          >
            <div className="px-3 py-2 border-b bg-muted/50">
              <p className="text-sm font-medium">当前配置</p>
              <p className="text-xs text-muted-foreground">{current.length} 项</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[280px] max-h-[400px]">
              {current.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  {dragOverZone === "current" ? "松开添加配件" : "暂无配件，从右侧拖拽或点击添加"}
                </div>
              ) : (
                current.map((c) => {
                  // 查找原数量（用于显示数量变化提示）
                  const orig = currentComponents.find((o) => o.modelId === c.modelId);
                  const origQty = orig?.quantity;
                  const qtyChanged = origQty != null && origQty !== c.quantity;
                  const isPendingDelete = pendingDelete === c.modelId;

                  return (
                    <div
                      key={c.modelId}
                      draggable={!isPendingDelete}
                      onDragStart={() => handleDragStart("current", c.modelId)}
                      className={`group flex items-center gap-2 p-2 rounded-md border transition-shadow ${
                        isPendingDelete
                          ? "border-destructive bg-destructive/5"
                          : "bg-background hover:shadow-sm cursor-grab active:cursor-grabbing"
                      }`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                            {c.categoryName}
                          </Badge>
                          <span className="text-sm font-medium truncate">{c.name}</span>
                          {/* 新增的配件标记 */}
                          {!orig && (
                            <Badge variant="default" className="text-xs px-1.5 py-0 h-5">
                              新增
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{c.brand ?? "无品牌"}</p>
                      </div>

                      {isPendingDelete ? (
                        // 待删除确认状态：显示确认/取消按钮
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-destructive mr-1">确认删除?</span>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => confirmDelete(c.modelId)}
                            title="确认删除"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={cancelDelete}
                            title="取消"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        // 正常状态：数量调整 + 删除按钮
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => changeCurrentQty(c.modelId, -1)}
                            disabled={c.quantity <= 1}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <div className="flex flex-col items-center min-w-[40px]">
                            <span className="text-sm font-mono leading-tight">×{c.quantity}</span>
                            {qtyChanged && origQty != null && (
                              <span className="text-[10px] text-muted-foreground line-through leading-tight">
                                原 ×{origQty}
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => changeCurrentQty(c.modelId, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => requestDelete(c.modelId)}
                            title="移除"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ===== 右侧：配件库 ===== */}
          <div
            className={`flex flex-col rounded-lg border-2 border-dashed transition-colors ${
              dragOverZone === "library" ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => handleDragOver(e, "library")}
            onDragLeave={() => setDragOverZone(null)}
            onDrop={() => handleDrop("library")}
          >
            <div className="px-3 py-2 border-b bg-muted/50">
              <p className="text-sm font-medium">配件库</p>
              <p className="text-xs text-muted-foreground">点击 + 或拖拽到左侧添加</p>
            </div>
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜索配件..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-7 text-sm"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[240px] max-h-[360px]">
              {libraryItems.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  {search ? "无匹配配件" : "配件库为空"}
                </div>
              ) : (
                libraryItems.map((m) => (
                  <div
                    key={m.modelId}
                    draggable
                    onDragStart={() => handleDragStart("library", m.modelId)}
                    className="group flex items-center gap-2 p-2 rounded-md border bg-background hover:shadow-sm hover:border-primary/30 transition-all cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                          {m.categoryName}
                        </Badge>
                        <span className="text-sm font-medium truncate">{m.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {m.brand ?? "无品牌"} · 库存 {m.stock}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                      onClick={() => addToCurrent(m)}
                      disabled={m.stock <= 0}
                      title={m.stock <= 0 ? "库存不足" : "添加"}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ===== 变更摘要 + 备注 + 提交 ===== */}
        <div className="border-t pt-3 space-y-3">
          {hasChanges && (
            <div className="rounded-lg border bg-background shadow-sm overflow-hidden">
              {/* 标题栏 */}
              <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">变更摘要</span>
                  <span className="text-xs text-muted-foreground">
                    {adjustments.length} 项修改 · {addCount} 新增 / {removeCount} 移除
                  </span>
                </div>
                {addCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[11px] text-emerald-600">+{addCount}</span>
                    {removeCount > 0 && (
                      <>
                        <span className="text-muted-foreground/30">|</span>
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-[11px] text-red-500">-{removeCount}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 分类分组内容 */}
              <div className="p-2.5 space-y-2.5 max-h-[200px] overflow-y-auto">
                {adjustmentsByCategory.map(([category, items]) => (
                  <div key={category}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-muted/50 rounded">{category}</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="space-y-1">
                      {items.map((item) => (
                        <div
                          key={item.modelId}
                          className={`flex items-center justify-between px-2 py-1.5 rounded-md text-sm ${
                            item.quantityDelta > 0
                              ? "bg-emerald-50/70 border border-emerald-100"
                              : "bg-red-50/70 border border-red-100"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-1 h-4 rounded-full shrink-0 ${
                                item.quantityDelta > 0 ? "bg-emerald-500" : "bg-red-500"
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium truncate">{item.name}</span>
                                {item.isNew && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-emerald-500/20 text-emerald-600 font-medium">
                                  新
                                </span>
                                )}
                                {item.isRemoved && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-red-500/20 text-red-600 font-medium">
                                  撤
                                </span>
                                )}
                              </div>
                              {item.brand && (
                                <span className="text-[11px] text-muted-foreground">{item.brand}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!item.isNew && !item.isRemoved && (
                              <span className="text-[11px] text-muted-foreground font-mono">
                                ×{item.oldQty}
                                <span className="mx-1">→</span>
                                ×{item.newQty}
                              </span>
                            )}
                            <span
                              className={`text-xs font-semibold font-mono min-w-[32px] text-right ${
                                item.quantityDelta > 0 ? "text-emerald-600" : "text-red-500"
                              }`}
                            >
                              {item.quantityDelta > 0 ? "+" : ""}
                              {item.quantityDelta}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">备注（可选）</Label>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="例如：更换显示器"
                className="h-8 text-sm"
              />
            </div>
            <Button onClick={handleSubmit} disabled={!hasChanges || loading || disabled}>
              {loading ? "调整中..." : hasChanges ? `确认调整 (${adjustments.length} 项)` : "无变更"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
