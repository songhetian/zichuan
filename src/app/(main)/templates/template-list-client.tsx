"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Eye, Pencil, Trash2, Layers, SearchX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { deleteDeviceTemplate } from "@/actions/device-template.actions";
import { TemplateFormDialog, type TemplateData } from "./template-form-dialog";
import { ListSearchInput } from "@/components/ui/list-search-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { filterItemsByText } from "@/lib/list-search";
import { categoryDotClass } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import type { ComponentModelOption, TemplateOption, ComponentCategoryOption } from "./bom-table";

interface TemplateListClientProps {
  templates: TemplateData[];
  categories: { id: number; name: string; code: string; unique: boolean; parentId: number | null }[];
  componentModels: ComponentModelOption[];
  componentCategories: ComponentCategoryOption[];
}

// ============================================================
// 列定义
// ============================================================

interface RowActionProps {
  template: TemplateData;
  categories: { id: number; name: string; code: string; unique: boolean; parentId: number | null }[];
  componentModels: ComponentModelOption[];
  allTemplates: TemplateOption[];
  componentCategories: ComponentCategoryOption[];
}

function RowActions({ template, categories, componentModels, allTemplates, componentCategories }: RowActionProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleDelete = async () => {
    try {
      const result = await deleteDeviceTemplate(template.id);
      if (result.success) {
        toast({ variant: "success", title: "删除成功" });
        router.refresh();
      } else {
        toast({ title: "删除失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setDeleteOpen(false);
    }
  };

  // 编辑时排除当前模板
  const otherTemplates = allTemplates.filter((t) => t.id !== template.id);

  // 抽屉内触发的动作：先关抽屉、下一帧再开下一个弹层，
  // 避免两层 Radix 模态同时挂载造成焦点陷阱冲突（Esc 之后焦点丢失）。
  const openEditFromDetail = () => {
    setDetailOpen(false);
    setTimeout(() => setEditOpen(true), 0);
  };
  const openDeleteFromDetail = () => {
    setDetailOpen(false);
    setTimeout(() => setDeleteOpen(true), 0);
  };

  const catName = categories.find((c) => c.id === template.categoryId)?.name;
  const brandModel = [template.brand, template.model].filter(Boolean).join(" / ");
  const totalQuantity = template.components.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0);

  return (
    <>
      <div className="flex items-center gap-1 justify-center">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="详情" aria-label="详情" onClick={() => setDetailOpen(true)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="编辑" aria-label="编辑" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除" aria-label="删除" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要删除模板「${template.name}」吗？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />

      {/* 编辑弹窗 */}
      <TemplateFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        template={template}
        categories={categories}
        componentModels={componentModels}
        templates={otherTemplates}
        componentCategories={componentCategories}
      />

      {/* 详情抽屉：浏览型详情用右侧抽屉，不打断列表上下文 */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-[560px]">
          <SheetHeader>
            <SheetTitle className="pr-8">{template.name}</SheetTitle>
            <SheetDescription>设备模板详情 · 配件清单</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* 摘要 */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">设备分类</dt>
                <dd className="flex items-center gap-2 text-sm font-medium">
                  {catName ? (
                    <>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", categoryDotClass(catName))} aria-hidden />
                      <span>{catName}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">品牌 / 型号</dt>
                <dd className="break-words text-sm font-medium">
                  {brandModel || <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">配件清单</dt>
                <dd className="text-sm font-medium tabular-nums">
                  {template.components.length} 项 / 共 {totalQuantity} 件
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">创建时间</dt>
                <dd className="text-sm font-medium tabular-nums">
                  {template.createdAt
                    ? new Date(template.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                    : "—"}
                </dd>
              </div>
            </dl>

            {/* 配件清单 */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="text-[13px] font-medium text-foreground">配件清单</span>
                </div>
                {template.components.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {template.components.length} 项 · 共 {totalQuantity} 件
                  </span>
                )}
              </div>

              {template.components.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="h-10 text-left text-xs">类型</TableHead>
                        <TableHead className="h-10 text-left text-xs">配件名称</TableHead>
                        <TableHead className="h-10 text-left text-xs">品牌</TableHead>
                        <TableHead className="h-10 text-right text-xs">数量</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {template.components.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="py-2.5 text-left text-muted-foreground">
                            {componentCategories.find((cc) => cc.id === c.categoryId)?.name ?? "未分类"}
                          </TableCell>
                          <TableCell className="py-2.5 text-left font-medium">{c.modelName}</TableCell>
                          <TableCell className="py-2.5 text-left text-muted-foreground">
                            {c.modelBrand ?? "—"}
                          </TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums">{c.quantity}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border py-8 text-center">
                  <p className="text-sm text-muted-foreground">该模板尚未配置配件</p>
                  <p className="mt-1 text-xs text-muted-foreground/80">可点击「编辑」补充配件清单</p>
                </div>
              )}
            </section>
          </div>

          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={openDeleteFromDetail}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除模板
            </Button>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={() => setDetailOpen(false)}>
                关闭
              </Button>
              <Button type="button" onClick={openEditFromDetail}>
                <Pencil className="mr-2 h-4 w-4" />
                编辑
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function createTemplateColumns(
  categories: RowActionProps["categories"],
  componentModels: RowActionProps["componentModels"],
  allTemplates: RowActionProps["allTemplates"],
  componentCategories: RowActionProps["componentCategories"]
): ColumnDef<TemplateData>[] {
  return [
    { accessorKey: "name", header: "模板名称", size: 260 },
    {
      id: "brandModel",
      // 提供 accessorFn 才能排序（否则该列无值、排序按钮不出现）
      accessorFn: (row) => [row.brand, row.model].filter(Boolean).join(" / "),
      header: "品牌 / 型号",
      size: 180,
      cell: ({ row }) => {
        const { brand, model } = row.original;
        if (!brand && !model) return <span className="text-muted-foreground">-</span>;
        return (
          <span className="text-sm text-foreground">
            {[brand, model].filter(Boolean).join(" / ")}
          </span>
        );
      },
    },
    {
      id: "categoryId",
      // 按分类「名称」排序，比按 id 排序符合直觉
      accessorFn: (row) => categories.find((c) => c.id === row.categoryId)?.name ?? "",
      header: "分类",
      size: 140,
      cell: ({ row }) => {
        const cat = categories.find((c) => c.id === row.original.categoryId);
        if (!cat) return <span className="text-muted-foreground">-</span>;
        return (
          <span className="inline-flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", categoryDotClass(cat.name))} aria-hidden />
            <span>{cat.name}</span>
          </span>
        );
      },
    },
    {
      id: "componentCount",
      accessorFn: (row) => row.components.length,
      header: "配件数量",
      size: 100,
      meta: { align: "right" as const },
      cell: ({ row }) => row.original.components.length,
    },
    {
      accessorKey: "createdAt",
      header: "创建时间",
      size: 170,
      cell: ({ row }) =>
        row.original.createdAt ? new Date(row.original.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-",
    },
    {
      id: "actions",
      header: "操作",
      size: 120,
      minSize: 120,
      enableSorting: false,
      meta: { align: "center" as const, sticky: "right" as const },
      cell: ({ row }) => (
        <RowActions
          template={row.original}
          categories={categories}
          componentModels={componentModels}
          allTemplates={allTemplates}
          componentCategories={componentCategories}
        />
      ),
    },
  ];
}

// ============================================================
// 主组件
// ============================================================

export function TemplateListClient({ templates, categories, componentModels, componentCategories }: TemplateListClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const categoryName = (categoryId: number) => categories.find((c) => c.id === categoryId)?.name ?? "";

  // 转换为 BomTable 需要的格式
  const templateOptions: TemplateOption[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    components: t.components.map((c) => ({
      modelId: c.modelId,
      quantity: c.quantity,
      modelName: c.modelName,
      modelBrand: c.modelBrand,
    })),
  }));

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id.toString(), label: c.name })),
    [categories],
  );

  // 按模板名称 / 分类 / 品牌 / 型号过滤，再叠加分类下拉筛选
  const filteredTemplates = useMemo(() => {
    const base = filterItemsByText(templates, search, (t) => [
      t.name,
      categoryName(t.categoryId),
      t.brand ?? "",
      t.model ?? "",
    ]);
    if (!categoryFilter) return base;
    return base.filter((t) => t.categoryId.toString() === categoryFilter);
  }, [templates, search, categories, categoryFilter]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备模板"
        description="管理设备模板及配件清单"
        action={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建模板
          </Button>
        }
      />
      <div className="flex items-center gap-2 flex-wrap">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder="搜索模板名称或分类"
        />
        <SearchableSelect
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          placeholder="选择分类"
          options={categoryOptions}
          triggerClassName="w-[160px]"
        />
      </div>
      <DataTable
        columns={createTemplateColumns(categories, componentModels, templateOptions, componentCategories)}
        data={filteredTemplates}
        defaultSorting={[{ id: "createdAt", desc: true }]}
        emptyState={
          search.trim() || categoryFilter ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/30">
                <SearchX className="h-6 w-6 text-muted-foreground/60" />
              </span>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">未找到匹配的模板</p>
                <p className="mt-1 text-xs text-muted-foreground/80">试试换个关键词，或清除筛选条件</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("");
                }}
              >
                清除筛选
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-7 w-7 text-primary" />
              </span>
              <div className="max-w-xs text-center">
                <p className="text-sm font-medium text-foreground">还没有设备模板</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  用一个模板把同类设备的配件清单标准化，建档时一键带出，无需逐台重复填写。
                </p>
              </div>
              <Button type="button" size="sm" className="mt-1" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                新建第一个模板
              </Button>
            </div>
          )
        }
      />

      {/* 创建弹窗 */}
      <TemplateFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        categories={categories}
        componentModels={componentModels}
        templates={templateOptions}
        componentCategories={componentCategories}
      />
    </div>
  );
}
