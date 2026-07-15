"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, GripVertical, Copy, ChevronRight, X } from "lucide-react";

export type BomComponent = {
  modelId: number;
  quantity: number;
  name: string;
  brand: string | null;
};

export type ComponentModelOption = {
  id: number;
  name: string;
  brand: string | null;
};

export type TemplateOption = {
  id: number;
  name: string;
  components: { modelId: number; quantity: number; modelName: string; modelBrand: string | null }[];
};

interface BomTableProps {
  modelOptions: ComponentModelOption[];
  templates: TemplateOption[];
  value: BomComponent[];
  onChange: (components: BomComponent[]) => void;
}

export function BomTable({ modelOptions, templates, value, onChange }: BomTableProps) {
  const [newModelId, setNewModelId] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTemplateId, setCopyTemplateId] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSelected, setBatchSelected] = useState<number[]>([]);

  const selectOptions = modelOptions.map((m) => ({
    value: m.id.toString(),
    label: m.brand ? `${m.name}（${m.brand}）` : m.name,
  }));

  const handleAdd = () => {
    if (!newModelId) return;
    const model = modelOptions.find((m) => m.id === Number(newModelId));
    if (!model) return;
    const qty = Number(newQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return;

    const existing = value.find((c) => c.modelId === model.id);
    if (existing) {
      onChange(value.map((c) => (c.modelId === model.id ? { ...c, quantity: c.quantity + qty } : c)));
    } else {
      onChange([...value, { modelId: model.id, quantity: qty, name: model.name, brand: model.brand }]);
    }
    setNewModelId("");
    setNewQuantity("1");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newModelId) {
      handleAdd();
    }
  };

  const handleQuickAdd = (modelId: number) => {
    const model = modelOptions.find((m) => m.id === modelId);
    if (!model) return;

    const existing = value.find((c) => c.modelId === model.id);
    if (existing) {
      onChange(value.map((c) => (c.modelId === model.id ? { ...c, quantity: c.quantity + 1 } : c)));
    } else {
      onChange([...value, { modelId: model.id, quantity: 1, name: model.name, brand: model.brand }]);
    }
  };

  const handleQuantityChange = (modelId: number, v: string) => {
    onChange(value.map((c) => (c.modelId === modelId ? { ...c, quantity: Number(v) || 0 } : c)));
  };

  const handleRemove = (modelId: number) => {
    onChange(value.filter((c) => c.modelId !== modelId));
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const next = [...value];
    const item = next[draggedIndex];
    next.splice(draggedIndex, 1);
    next.splice(index, 0, item);
    onChange(next);
    setDraggedIndex(index);
  };
  const handleDragEnd = () => setDraggedIndex(null);

  const handleCopy = () => {
    if (!copyTemplateId) return;
    const source = templates.find((t) => t.id === Number(copyTemplateId));
    if (!source) return;
    const merged = [...value];
    source.components.forEach((c) => {
      const existing = merged.find((item) => item.modelId === c.modelId);
      if (existing) {
        existing.quantity += c.quantity;
      } else {
        merged.push({ modelId: c.modelId, quantity: c.quantity, name: c.modelName, brand: c.modelBrand });
      }
    });
    onChange(merged);
    setCopyOpen(false);
    setCopyTemplateId("");
  };

  const handleBatchAdd = () => {
    if (batchSelected.length === 0) return;

    const merged = [...value];
    batchSelected.forEach((modelId) => {
      const model = modelOptions.find((m) => m.id === modelId);
      if (!model) return;

      const existing = merged.find((item) => item.modelId === model.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        merged.push({ modelId: model.id, quantity: 1, name: model.name, brand: model.brand });
      }
    });

    onChange(merged);
    setBatchOpen(false);
    setBatchSelected([]);
  };

  const toggleBatchSelect = (modelId: number) => {
    setBatchSelected((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  const copyOptions = templates.map((t) => ({ value: t.id.toString(), label: t.name }));

  const availableModels = useMemo(
    () => modelOptions.filter((m) => !value.find((c) => c.modelId === m.id)),
    [modelOptions, value]
  );

  const selectedModelIds = new Set(value.map((c) => c.modelId));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setBatchOpen(true)}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4 mr-1" />
            批量添加
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setCopyOpen(true)}
            disabled={!templates.length}
            className="h-8"
          >
            <Copy className="h-4 w-4 mr-2" />
            复制配件
          </Button>
        </div>
      </div>

      {availableModels.length > 0 && availableModels.length <= 10 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center mr-1">快速添加:</span>
          {availableModels.map((model) => (
            <Button
              key={model.id}
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => handleQuickAdd(model.id)}
              className="h-7 px-3 text-xs font-normal"
            >
              {model.name}
              {model.brand && <span className="ml-1 text-muted-foreground">({model.brand})</span>}
            </Button>
          ))}
        </div>
      )}

      {availableModels.length > 10 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">常用配件:</span>
          <div className="flex flex-wrap gap-2">
            {availableModels.slice(0, 6).map((model) => (
              <Button
                key={model.id}
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => handleQuickAdd(model.id)}
                className="h-7 px-3 text-xs font-normal"
              >
                {model.name}
                {model.brand && <span className="ml-1 text-muted-foreground">({model.brand})</span>}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setBatchOpen(true)}
              className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部 <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {value.length > 0 ? (
          value.map((c, index) => (
            <div
              key={c.modelId}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border bg-card transition-all duration-150",
                "hover:border-primary/30 hover:shadow-sm",
                draggedIndex === index && "opacity-50 border-primary"
              )}
            >
              <div className="cursor-move text-muted-foreground hover:text-foreground transition-colors">
                <GripVertical className="h-4 w-4" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{c.name}</div>
                {c.brand && <div className="text-xs text-muted-foreground">{c.brand}</div>}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center border rounded-md overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(c.modelId, String(Math.max(1, c.quantity - 1)))}
                    className="px-2 h-8 text-xs hover:bg-secondary transition-colors"
                  >
                    -
                  </button>
                  <span className="w-10 h-8 flex items-center justify-center text-sm font-medium border-x">
                    {c.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(c.modelId, String(c.quantity + 1))}
                    className="px-2 h-8 text-xs hover:bg-secondary transition-colors"
                  >
                    +
                  </button>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-red-50"
                  title="移除"
                  type="button"
                  onClick={() => handleRemove(c.modelId)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 border rounded-lg">
            <div className="mb-2 text-muted-foreground">
              <svg className="w-12 h-12 mx-auto text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">暂无配件配置</p>
            <p className="text-xs text-muted-foreground/70 mt-1">点击上方按钮添加或从其他模板复制</p>
          </div>
        )}
      </div>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>从其他模板复制配件</DialogTitle>
            <DialogDescription>选择要复制配件的源模板，配件将追加到当前清单中</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-sm">源模板</Label>
            <SearchableSelect
              options={copyOptions}
              value={copyTemplateId}
              onValueChange={setCopyTemplateId}
              placeholder="选择模板"
              emptyText="无可选模板"
              triggerClassName="w-full"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCopyOpen(false)}>取消</Button>
            <Button type="button" onClick={handleCopy} disabled={!copyTemplateId}>确认复制</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-xl max-h-[70vh]">
          <DialogHeader>
            <DialogTitle>批量添加配件</DialogTitle>
            <DialogDescription>勾选要添加的配件，点击确认后将以数量1添加到清单中</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto max-h-[40vh]">
            {modelOptions.map((model) => (
              <div
                key={model.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  selectedModelIds.has(model.id)
                    ? "opacity-50 cursor-not-allowed"
                    : batchSelected.includes(model.id)
                    ? "bg-primary/5 border-primary"
                    : "hover:bg-secondary border-border"
                }`}
              >
                <Checkbox
                  checked={batchSelected.includes(model.id)}
                  onCheckedChange={() => !selectedModelIds.has(model.id) && toggleBatchSelect(model.id)}
                  disabled={selectedModelIds.has(model.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{model.name}</div>
                  {model.brand && <div className="text-xs text-muted-foreground">{model.brand}</div>}
                </div>
                {selectedModelIds.has(model.id) && (
                  <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">已添加</span>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <div className="text-sm text-muted-foreground mr-4">
              已选择 {batchSelected.length} 项
            </div>
            <Button variant="outline" type="button" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button type="button" onClick={handleBatchAdd} disabled={batchSelected.length === 0}>
              确认添加 ({batchSelected.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
