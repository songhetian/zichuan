"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, GripVertical, Copy, Search, X, Check } from "lucide-react";
import { categoryDotClass } from "@/lib/status-styles";

export type BomComponent = {
  modelId: number;
  quantity: number;
  name: string;
  brand: string | null;
  categoryId?: number;
  categoryName?: string;
};

export type ComponentModelOption = {
  id: number;
  name: string;
  brand: string | null;
  categoryId: number;
  categoryName: string;
};

export type ComponentCategoryOption = {
  id: number;
  name: string;
};

export type TemplateOption = {
  id: number;
  name: string;
  components: { modelId: number; quantity: number; modelName: string; modelBrand: string | null }[];
};

interface BomTableProps {
  modelOptions: ComponentModelOption[];
  templates: TemplateOption[];
  categories: ComponentCategoryOption[];
  value: BomComponent[];
  onChange: (components: BomComponent[]) => void;
}

// ============================================================
// 分类配色：仅用于「一眼区分分类」的小圆点/色条（始终与分类名文字同时出现，
// 不承载状态语义）。色值走 @/lib/status-styles 的分类调色板 token，随主题自适应。
// ============================================================
function getCategoryColor(name?: string): string {
  return categoryDotClass(name);
}

function getCategoryDotClass(name?: string): string {
  return getCategoryColor(name);
}

export function BomTable({ modelOptions, templates, categories, value, onChange }: BomTableProps) {
  // 主添加区状态
  const [searchKeyword, setSearchKeyword] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [newQuantity, setNewQuantity] = useState("1");
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);

  // 拖拽 + 对话框
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTemplateId, setCopyTemplateId] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSelected, setBatchSelected] = useState<number[]>([]);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchCategoryId, setBatchCategoryId] = useState<number | null>(null);

  const selectedModelIds = useMemo(() => new Set(value.map((c) => c.modelId)), [value]);

  // 筛选 + 搜索后的可添加配件
  const filteredModels = useMemo(() => {
    let list = modelOptions.filter((m) => !selectedModelIds.has(m.id));
    if (activeCategoryId !== null) {
      list = list.filter((m) => m.categoryId === activeCategoryId);
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(kw) ||
          (m.brand ?? "").toLowerCase().includes(kw) ||
          m.categoryName.toLowerCase().includes(kw)
      );
    }
    return list;
  }, [modelOptions, selectedModelIds, activeCategoryId, searchKeyword]);

  // 智能建议：当前筛选下的前 6 个（搜索为空时显示）
  const suggestions = useMemo(() => {
    if (searchKeyword.trim()) return [];
    return filteredModels.slice(0, 6);
  }, [filteredModels, searchKeyword]);

  // 搜索下拉是否显示
  const showSearchDropdown = searchFocused && searchKeyword.trim().length > 0;

  // 重置高亮当搜索词变化
  useEffect(() => {
    setHighlightIndex(0);
  }, [searchKeyword, activeCategoryId]);

  // 点击外部关闭搜索下拉
  useEffect(() => {
    if (!searchFocused) return;
    const handler = (e: MouseEvent) => {
      if (searchResultsRef.current && !searchResultsRef.current.contains(e.target as Node)
          && searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchFocused]);

  const handleAddById = (modelId: number, qty?: number) => {
    const model = modelOptions.find((m) => m.id === modelId);
    if (!model) return;
    const quantity = qty ?? Number(newQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    const existing = value.find((c) => c.modelId === model.id);
    if (existing) {
      onChange(value.map((c) => (c.modelId === model.id ? { ...c, quantity: c.quantity + quantity } : c)));
    } else {
      onChange([...value, {
        modelId: model.id,
        quantity,
        name: model.name,
        brand: model.brand,
        categoryId: model.categoryId,
        categoryName: model.categoryName,
      }]);
    }
    setSearchKeyword("");
    setNewQuantity("1");
    setSearchFocused(false);
    searchInputRef.current?.focus();
  };

  const handleQuickAdd = (modelId: number) => {
    handleAddById(modelId, 1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && filteredModels.length > 0) {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filteredModels.length - 1));
    } else if (e.key === "ArrowUp" && filteredModels.length > 0) {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filteredModels[highlightIndex]) {
      e.preventDefault();
      handleAddById(filteredModels[highlightIndex].id);
    } else if (e.key === "Escape") {
      setSearchFocused(false);
    }
  };

  const handleQuantityChange = (modelId: number, v: string) => {
    onChange(value.map((c) => (c.modelId === modelId ? { ...c, quantity: Number(v) || 0 } : c)));
  };

  /** 失焦归一到 >=1 的整数：允许输入过程中为空/0，但不允许提交 0 件 */
  const handleQuantityBlur = (modelId: number) => {
    onChange(
      value.map((c) =>
        c.modelId === modelId ? { ...c, quantity: Math.max(1, Math.floor(Number(c.quantity) || 1)) } : c
      )
    );
  };

  const handleRemove = (modelId: number) => {
    onChange(value.filter((c) => c.modelId !== modelId));
  };

  /** 把第 from 项移到 to 位置（鼠标拖拽与键盘排序共用） */
  const moveItem = (from: number, to: number) => {
    if (from === to || to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    moveItem(draggedIndex, index);
    setDraggedIndex(index);
  };
  const handleDragEnd = () => setDraggedIndex(null);

  const handleCopy = () => {
    if (!copyTemplateId) return;
    const source = templates.find((t) => t.id === Number(copyTemplateId));
    if (!source) return;
    const merged = [...value];
    source.components.forEach((c) => {
      const model = modelOptions.find((m) => m.id === c.modelId);
      const existing = merged.find((item) => item.modelId === c.modelId);
      if (existing) {
        existing.quantity += c.quantity;
      } else {
        merged.push({
          modelId: c.modelId,
          quantity: c.quantity,
          name: c.modelName,
          brand: c.modelBrand,
          categoryId: model?.categoryId,
          categoryName: model?.categoryName,
        });
      }
    });
    onChange(merged);
    setCopyOpen(false);
    setCopyTemplateId("");
  };

  // 批量添加对话框
  const batchFiltered = useMemo(() => {
    let list = modelOptions.filter((m) => !selectedModelIds.has(m.id));
    if (batchCategoryId !== null) {
      list = list.filter((m) => m.categoryId === batchCategoryId);
    }
    if (batchSearch.trim()) {
      const kw = batchSearch.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(kw) ||
          (m.brand ?? "").toLowerCase().includes(kw) ||
          m.categoryName.toLowerCase().includes(kw)
      );
    }
    return list;
  }, [modelOptions, selectedModelIds, batchCategoryId, batchSearch]);

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
        merged.push({
          modelId: model.id,
          quantity: 1,
          name: model.name,
          brand: model.brand,
          categoryId: model.categoryId,
          categoryName: model.categoryName,
        });
      }
    });
    onChange(merged);
    setBatchOpen(false);
    setBatchSelected([]);
    setBatchSearch("");
    setBatchCategoryId(null);
  };

  const toggleBatchSelect = (modelId: number) => {
    setBatchSelected((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  return (
    <div className="space-y-3">
      {/* ===== 主添加区：搜索 + 分类筛选 + 数量 + 添加按钮 ===== */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {/* 搜索 + 下拉结果 */}
          <div className="relative flex-1" ref={searchResultsRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索配件名称、品牌或分类..."
              aria-label="搜索配件（名称、品牌或分类）"
              role="combobox"
              aria-expanded={showSearchDropdown}
              aria-autocomplete="list"
              aria-controls="bom-search-results"
              className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-card text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
            {/* 搜索下拉结果 */}
            {showSearchDropdown && (
              <div
                id="bom-search-results"
                role="listbox"
                aria-label="配件搜索结果"
                className="absolute z-50 top-full left-0 right-0 mt-1 max-h-[280px] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
              >
                {filteredModels.length > 0 ? (
                  filteredModels.map((model, idx) => (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={idx === highlightIndex}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      onClick={() => handleAddById(model.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors",
                        idx === highlightIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      )}
                    >
                      <span className={cn("w-1 h-4 rounded-full shrink-0", getCategoryDotClass(model.categoryName))} />
                      <span className="flex-1 min-w-0 truncate">{model.name}</span>
                      {model.brand && (
                        <span className="text-xs text-muted-foreground shrink-0">{model.brand}</span>
                      )}
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                        {model.categoryName}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    无匹配的配件
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 数量输入 */}
          <div className="flex items-center border border-input rounded-md overflow-hidden shrink-0 bg-card">
            <button
              type="button"
              aria-label="减少要添加的数量"
              disabled={Number(newQuantity) <= 1}
              onClick={() => setNewQuantity(String(Math.max(1, Number(newQuantity) - 1)))}
              className="px-3 h-10 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              −
            </button>
            <input
              type="number"
              min="1"
              value={newQuantity}
              aria-label="要添加的数量"
              onChange={(e) => setNewQuantity(e.target.value)}
              className="w-12 h-10 text-center text-sm border-x border-input bg-card outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="增加要添加的数量"
              onClick={() => setNewQuantity(String(Number(newQuantity) + 1))}
              className="px-3 h-10 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              +
            </button>
          </div>

          {/* 添加按钮（仅在有搜索词时高亮） */}
          <Button
            type="button"
            disabled={!searchKeyword.trim() || filteredModels.length === 0}
            title={!searchKeyword.trim() ? "先搜索并选中要添加的配件" : undefined}
            onClick={() => {
              if (filteredModels[highlightIndex]) {
                handleAddById(filteredModels[highlightIndex].id);
              }
            }}
            className="h-10 px-4 shrink-0"
          >
            <Plus className="h-4 w-4 mr-1" />
            添加
          </Button>

          {/* 复制配件图标按钮 */}
          <Button aria-label="从其他模板复制配件"
            variant="outline"
            size="icon"
            type="button"
            onClick={() => setCopyOpen(true)}
            disabled={!templates.length}
            className="h-10 w-10 shrink-0"
            title="从其他模板复制配件"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        {/* 分类筛选标签条：选中态用淡底 + 描边而非实色，避免与「添加/提交」主按钮抢视觉 */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              aria-pressed={activeCategoryId === null}
              onClick={() => setActiveCategoryId(null)}
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                activeCategoryId === null
                  ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              )}
            >
              全部
            </button>
            {categories.map((cat) => {
              const count = modelOptions.filter((m) => m.categoryId === cat.id && !selectedModelIds.has(m.id)).length;
              const active = activeCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveCategoryId(active ? null : cat.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors",
                    active
                      ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                      : "bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", getCategoryDotClass(cat.name))} />
                  {cat.name}
                  {count > 0 && (
                    <span className={cn("text-[10px]", active ? "text-primary/70" : "text-muted-foreground/70")}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 智能建议标签（搜索为空时显示）
            —— 用「幽灵 chip」（透明底 + 发丝描边）而非实色 bg-secondary：
            分类筛选条也用 bg-secondary，两者同底会让「筛选器」和「可添加项」
            看起来是同一种东西，用户分不清哪排能点。靠底色轻重拉开层级。 */}
        {suggestions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">快速添加：</span>
            {suggestions.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => handleQuickAdd(model.id)}
                className="inline-flex items-center gap-1.5 h-6 px-2 rounded border border-border text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/50 hover:text-foreground"
              >
                <span className={cn("w-1 h-1 rounded-full", getCategoryDotClass(model.categoryName))} />
                <span className="truncate max-w-[120px]">{model.name}</span>
                {model.brand && (
                  <span className="text-muted-foreground/70 text-[10px]">{model.brand}</span>
                )}
              </button>
            ))}
            {filteredModels.length > 6 && (
              <button
                type="button"
                onClick={() => setBatchOpen(true)}
                className="inline-flex items-center gap-1 h-6 px-2 rounded text-xs text-primary transition-colors hover:bg-accent"
              >
                批量添加（{filteredModels.length}）
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===== 已选配件列表 ===== */}
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
                "group flex items-center gap-3 rounded-md border border-border bg-card p-2.5 transition-colors duration-150",
                "hover:border-primary/40",
                draggedIndex === index && "opacity-50 border-primary"
              )}
            >
              {/* 左侧分类色条 */}
              <div className={cn("w-0.5 h-8 rounded-full shrink-0", getCategoryDotClass(c.categoryName))} />

              {/* 拖拽手柄：可聚焦 + 上下方向键排序（拖拽动作的键盘替代，WCAG 2.5.7） */}
              <button
                type="button"
                aria-label={`调整「${c.name}」的顺序，按上下方向键移动`}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    moveItem(index, index - 1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    moveItem(index, index + 1);
                  }
                }}
                className="cursor-move rounded text-muted-foreground/50 transition-colors hover:text-muted-foreground group-hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GripVertical className="h-4 w-4" />
              </button>

              {/* 配件信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-normal text-sm truncate">{c.name}</span>
                  {c.categoryName && (
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                      {c.categoryName}
                    </span>
                  )}
                </div>
                {c.brand && <div className="text-xs text-muted-foreground truncate">{c.brand}</div>}
              </div>

              {/* 数量：可直接键入，也可步进；最少 1 件（减号到底自动禁用） */}
              <div className="flex items-center border border-input rounded-md overflow-hidden shrink-0 bg-background">
                <button
                  type="button"
                  aria-label={`减少「${c.name}」的数量`}
                  disabled={c.quantity <= 1}
                  onClick={() => handleQuantityChange(c.modelId, String(Math.max(1, c.quantity - 1)))}
                  className="px-2 h-7 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={c.quantity}
                  aria-label={`「${c.name}」的数量`}
                  onChange={(e) => handleQuantityChange(c.modelId, e.target.value)}
                  onBlur={() => handleQuantityBlur(c.modelId)}
                  className="w-11 h-7 text-center text-sm border-x border-input bg-background outline-none focus:bg-card [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label={`增加「${c.name}」的数量`}
                  onClick={() => handleQuantityChange(c.modelId, String(c.quantity + 1))}
                  className="px-2 h-7 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  +
                </button>
              </div>

              {/* 删除按钮 */}
              <Button aria-label="移除配件"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="移除"
                type="button"
                onClick={() => handleRemove(c.modelId)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/40 py-8 text-center">
            <p className="text-sm text-muted-foreground">暂无配件配置</p>
            <p className="mt-1 text-xs text-muted-foreground/70">通过上方搜索或快速添加来配置配件清单</p>
          </div>
        )}
      </div>

      {/* ===== 复制配件对话框 ===== */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>从其他模板复制配件</DialogTitle>
            <DialogDescription>选择要复制配件的源模板，配件将追加到当前清单中</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm font-medium">源模板</div>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {templates.length > 0 ? (
                templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCopyTemplateId(t.id.toString())}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-md border text-left text-sm transition-colors",
                      copyTemplateId === t.id.toString()
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-secondary"
                    )}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {t.components.length} 项
                    </span>
                    {copyTemplateId === t.id.toString() && (
                      <Check className="h-4 w-4 text-primary ml-2 shrink-0" />
                    )}
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">暂无其他模板</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCopyOpen(false)}>取消</Button>
            <Button type="button" onClick={handleCopy} disabled={!copyTemplateId}>确认复制</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 批量添加对话框（带搜索 + 分类筛选）===== */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>批量添加配件</DialogTitle>
            <DialogDescription>勾选要添加的配件，点击确认后将以数量 1 添加到清单中</DialogDescription>
          </DialogHeader>

          {/* 搜索 + 分类筛选 */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="搜索配件名称、品牌..."
                aria-label="搜索配件（批量添加）"
                className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            {categories.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  type="button"
                  aria-pressed={batchCategoryId === null}
                  onClick={() => setBatchCategoryId(null)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs transition-colors",
                    batchCategoryId === null
                      ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  全部
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={batchCategoryId === cat.id}
                    onClick={() => setBatchCategoryId(batchCategoryId === cat.id ? null : cat.id)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
                      batchCategoryId === cat.id
                        ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className={cn("w-1 h-1 rounded-full", getCategoryDotClass(cat.name))} />
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px] max-h-[400px]">
            {batchFiltered.length > 0 ? (
              batchFiltered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  role="checkbox"
                  aria-checked={batchSelected.includes(model.id)}
                  onClick={() => toggleBatchSelect(model.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors",
                    batchSelected.includes(model.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  <Checkbox
                    checked={batchSelected.includes(model.id)}
                    onCheckedChange={() => toggleBatchSelect(model.id)}
                    className="pointer-events-none"
                  />
                  <div className={cn("w-0.5 h-6 rounded-full shrink-0", getCategoryDotClass(model.categoryName))} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{model.name}</div>
                    {model.brand && <div className="text-xs text-muted-foreground truncate">{model.brand}</div>}
                  </div>
                  <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                    {model.categoryName}
                  </span>
                </button>
              ))
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {batchSearch.trim() ? "无匹配的配件" : "该分类下暂无配件"}
              </div>
            )}
          </div>

          <DialogFooter>
            <div className="text-sm text-muted-foreground mr-auto">
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
