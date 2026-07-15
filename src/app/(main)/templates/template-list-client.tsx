"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Eye, Pencil, Trash2, GripVertical, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createDeviceTemplate,
  deleteDeviceTemplate,
  updateDeviceTemplate,
} from "@/actions/device-template.actions";

const templateSchema = z.object({
  name: z.string().min(1, "模板名称不能为空"),
  categoryId: z.string().min(1, "请选择设备分类"),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

interface Template {
  id: number;
  name: string;
  categoryId: number;
  unique: boolean;
  components: {
    id: number;
    modelId: number;
    quantity: number;
    modelName: string;
    modelBrand: string | null;
  }[];
}

interface ComponentModel {
  id: number;
  name: string;
  brand: string | null;
  categoryId: number;
}

// ============================================================
// BOM（配件清单）共享 state 类型
// ============================================================

type BomComponent = {
  modelId: number;
  quantity: number;
  name: string;
  brand: string | null;
};

interface BomProps {
  components: BomComponent[];
  setComponents: React.Dispatch<React.SetStateAction<BomComponent[]>>;
  newModelId: string;
  setNewModelId: (v: string) => void;
  newQuantity: string;
  setNewQuantity: (v: string) => void;
  draggedIndex: number | null;
  setDraggedIndex: (v: number | null) => void;
  setCopyDialogOpen: (v: boolean) => void;
  setEditingTemplateId: (v: number | null) => void;
  modelOptions: { value: string; label: string }[];
  handleAddComponent: () => void;
  handleQuantityChange: (modelId: number, value: string) => void;
  handleRemoveComponent: (modelId: number) => void;
  handleDragStart: (index: number) => void;
  handleDragOver: (e: React.DragEvent, index: number) => void;
  handleDragEnd: () => void;
}

interface TemplateListClientProps {
  templates: Template[];
  categories: { id: number; name: string; code: string; parentId: number | null }[];
  componentModels: ComponentModel[];
}

// ============================================================
// 列定义
// ============================================================

const columns: ColumnDef<Template>[] = [
  { accessorKey: "name", header: "模板名称" },
  {
    id: "categoryId",
    header: "分类",
    cell: ({ row }) => {
      const categoryId = row.original.categoryId;
      const categories = (row.original as any)._categories as { id: number; name: string }[];
      const cat = categories?.find((c) => c.id === categoryId);
      return cat?.name ?? "-";
    },
  },
  {
    id: "componentCount",
    header: "配件数量",
    cell: ({ row }) => row.original.components.length,
  },
  {
    id: "unique",
    header: "唯一",
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        {row.original.unique ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
            唯一
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>
    ),
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => {
      const template = row.original;
      return (
        <div className="flex items-center gap-1 justify-center">
          <ActionButtons
            template={template}
            categories={(template as any)._categories}
            componentModels={(template as any)._componentModels}
            allTemplates={(template as any)._allTemplates}
            bomProps={(template as any)._bomProps}
          />
        </div>
      );
    },
  },
];

// ============================================================
// ActionButtons 组件（使用父组件传入的 BOM state）
// ============================================================

function ActionButtons({
  template,
  categories,
  componentModels,
  allTemplates,
  bomProps: bom,
}: {
  template: Template & { _categories?: { id: number; name: string }[] };
  categories?: { id: number; name: string }[];
  componentModels?: ComponentModel[];
  allTemplates?: Template[];
  bomProps?: BomProps;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUnique, setEditUnique] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const { toast } = useToast();

  const editForm = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: "",
      categoryId: "",
    },
  });

  const handleDelete = async () => {
    const result = await deleteDeviceTemplate(template.id);
    if (result.success) {
      toast({ title: "删除成功" });
      router.refresh();
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
  };

  const handleEdit = async (values: TemplateFormValues) => {
    setEditLoading(true);
    const result = await updateDeviceTemplate(template.id, {
      name: values.name.trim(),
      categoryId: Number(values.categoryId),
      unique: editUnique,
      components: (bom?.components ?? []).map((c) => ({
        modelId: c.modelId,
        quantity: Number(c.quantity),
      })),
    });
    setEditLoading(false);
    if (result.success) {
      toast({ title: "更新成功" });
      setEditOpen(false);
      router.refresh();
    } else {
      toast({ title: "更新失败", description: result.error, variant: "destructive" });
    }
  };

  const handleEditOpen = (open: boolean) => {
    if (open) {
      editForm.reset({
        name: template.name,
        categoryId: template.categoryId.toString(),
      });
      setEditUnique(template.unique ?? false);
      // 用 template.components 初始化父组件的 BOM state
      bom?.setComponents(
        template.components.map((c) => ({
          modelId: c.modelId,
          quantity: c.quantity,
          name: c.modelName,
          brand: c.modelBrand,
        }))
      );
      bom?.setNewModelId("");
      bom?.setNewQuantity("1");
      bom?.setEditingTemplateId(template.id);
    }
    setEditOpen(open);
  };

  // 其他模板选项（排除当前模板，用于编辑弹窗的复制按钮）
  const otherTemplateOptions = (allTemplates ?? [])
    .filter((t) => t.id !== template.id)
    .map((t) => ({
      value: t.id.toString(),
      label: t.name,
    }));

  return (
    <>
      <Button type="button" variant="ghost" size="icon" title="详情" onClick={() => setDetailOpen(true)}>
        <Eye className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" title="编辑" onClick={() => handleEditOpen(true)}>
        <Pencil className="h-4 w-4 text-primary" />
      </Button>
      <Button type="button" variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要删除模板「${template.name}」吗？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑模板</DialogTitle>
            <DialogDescription>修改模板基本信息及配件清单</DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(handleEdit)} className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input {...editForm.register("name")} placeholder="请输入模板名称" />
              {editForm.formState.errors.name && (
                <p className="text-sm text-destructive">{editForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>设备分类</Label>
              <Select
                value={editForm.watch("categoryId")}
                onValueChange={(v) => editForm.setValue("categoryId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  {(categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editForm.formState.errors.categoryId && (
                <p className="text-sm text-destructive">{editForm.formState.errors.categoryId.message}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-unique"
                checked={editUnique}
                onCheckedChange={(v) => setEditUnique(!!v)}
              />
              <Label htmlFor="edit-unique" className="text-sm">
                唯一设备（每个员工只能拥有一台）
              </Label>
            </div>

            {/* 配件清单管理 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>配件清单</Label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => bom?.setCopyDialogOpen(true)}
                  disabled={!otherTemplateOptions.length}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  从其他模板复制
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>型号名称</TableHead>
                      <TableHead>品牌</TableHead>
                      <TableHead className="w-28">数量</TableHead>
                      <TableHead className="w-12 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(bom?.components ?? []).length > 0 ? (
                      bom!.components.map((c, index) => (
                        <TableRow
                          key={c.modelId}
                          draggable
                          onDragStart={() => bom?.handleDragStart(index)}
                          onDragOver={(e) => bom?.handleDragOver(e, index)}
                          onDragEnd={() => bom?.handleDragEnd()}
                          className={(bom?.draggedIndex ?? null) === index ? "opacity-50" : ""}
                        >
                          <TableCell className="cursor-move">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>{c.brand ?? "-"}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              className="h-8 w-20"
                              value={c.quantity}
                              onChange={(e) =>
                                bom?.handleQuantityChange(c.modelId, e.target.value)
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="移除"
                              type="button"
                              onClick={() => bom?.handleRemoveComponent(c.modelId)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-sm text-muted-foreground py-4"
                        >
                          暂无配件，请在下方添加或从其他模板复制
                        </TableCell>
                      </TableRow>
                    )}
                    {/* 添加配件行 */}
                    <TableRow>
                      <TableCell></TableCell>
                      <TableCell colSpan={2}>
                        <SearchableSelect
                          options={bom?.modelOptions ?? []}
                          value={bom?.newModelId ?? ""}
                          onValueChange={(v) => bom?.setNewModelId(v)}
                          placeholder="选择配件型号"
                          emptyText="无匹配的配件型号"
                          triggerClassName="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          className="h-8 w-20"
                          value={bom?.newQuantity ?? "1"}
                          onChange={(e) => bom?.setNewQuantity(e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="添加"
                          type="button"
                          disabled={!bom?.newModelId}
                          onClick={() => bom?.handleAddComponent()}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "更新中..." : "确认"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>模板详情 - {template.name}</DialogTitle>
            <DialogDescription>查看模板的配件清单</DialogDescription>
          </DialogHeader>
          {template.components.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>配件名称</TableHead>
                  <TableHead>品牌</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {template.components.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.modelName}</TableCell>
                    <TableCell>{c.modelBrand ?? "-"}</TableCell>
                    <TableCell className="text-right">{c.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无配件配置</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// TemplateListClient 主组件（持有 BOM state）
// ============================================================

export function TemplateListClient({ templates, categories, componentModels }: TemplateListClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [isUnique, setIsUnique] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  // ---------- 共享 BOM state ----------
  const [bomComponents, setBomComponents] = useState<BomComponent[]>([]);
  const [bomNewModelId, setBomNewModelId] = useState<string>("");
  const [bomNewQuantity, setBomNewQuantity] = useState<string>("1");
  const [bomCopyDialogOpen, setBomCopyDialogOpen] = useState(false);
  const [bomSelectedCopyTemplateId, setBomSelectedCopyTemplateId] = useState<string>("");
  const [bomDraggedIndex, setBomDraggedIndex] = useState<number | null>(null);
  // 记录当前正在编辑的模板 ID，用于复制弹窗排除当前模板
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);

  // ---------- 配件型号选项 ----------
  const modelOptions = componentModels.map((m) => ({
    value: m.id.toString(),
    label: m.brand ? `${m.name}（${m.brand}）` : m.name,
  }));

  // ---------- 复制弹窗的可选模板（排除正在编辑的模板） ----------
  const otherTemplateOptions = templates
    .filter((t) => t.id !== editingTemplateId)
    .map((t) => ({
      value: t.id.toString(),
      label: t.name,
    }));

  // ---------- BOM 操作 handlers ----------
  const handleAddComponent = () => {
    if (!bomNewModelId) return;
    const model = componentModels.find((m) => m.id === Number(bomNewModelId));
    if (!model) return;
    const qty = Number(bomNewQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setBomComponents((prev) => {
      const existing = prev.find((c) => c.modelId === model.id);
      if (existing) {
        return prev.map((c) =>
          c.modelId === model.id ? { ...c, quantity: c.quantity + qty } : c
        );
      }
      return [
        ...prev,
        {
          modelId: model.id,
          quantity: qty,
          name: model.name,
          brand: model.brand,
        },
      ];
    });
    setBomNewModelId("");
    setBomNewQuantity("1");
  };

  const handleQuantityChange = (modelId: number, value: string) => {
    setBomComponents((prev) =>
      prev.map((c) =>
        c.modelId === modelId ? { ...c, quantity: Number(value) || 0 } : c
      )
    );
  };

  const handleRemoveComponent = (modelId: number) => {
    setBomComponents((prev) => prev.filter((c) => c.modelId !== modelId));
  };

  const handleDragStart = (index: number) => {
    setBomDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (bomDraggedIndex === null || bomDraggedIndex === index) return;

    const newComponents = [...bomComponents];
    const draggedItem = newComponents[bomDraggedIndex];
    newComponents.splice(bomDraggedIndex, 1);
    newComponents.splice(index, 0, draggedItem);
    setBomComponents(newComponents);
    setBomDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setBomDraggedIndex(null);
  };

  const handleCopyFromTemplate = () => {
    if (!bomSelectedCopyTemplateId) return;
    const sourceTemplate = templates.find((t) => t.id === Number(bomSelectedCopyTemplateId));
    if (!sourceTemplate) return;

    setBomComponents((prev) => {
      const merged = [...prev];
      sourceTemplate.components.forEach((c) => {
        const existing = merged.find((item) => item.modelId === c.modelId);
        if (existing) {
          existing.quantity += c.quantity;
        } else {
          merged.push({
            modelId: c.modelId,
            quantity: c.quantity,
            name: c.modelName,
            brand: c.modelBrand,
          });
        }
      });
      return merged;
    });

    setBomCopyDialogOpen(false);
    setBomSelectedCopyTemplateId("");
    toast({ title: "复制成功" });
  };

  // ---------- 组装 BOM props ----------
  const bomProps: BomProps = {
    components: bomComponents,
    setComponents: setBomComponents,
    newModelId: bomNewModelId,
    setNewModelId: setBomNewModelId,
    newQuantity: bomNewQuantity,
    setNewQuantity: setBomNewQuantity,
    draggedIndex: bomDraggedIndex,
    setDraggedIndex: setBomDraggedIndex,
    setCopyDialogOpen: setBomCopyDialogOpen,
    setEditingTemplateId: setEditingTemplateId,
    modelOptions,
    handleAddComponent,
    handleQuantityChange,
    handleRemoveComponent,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };

  const createForm = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: "",
      categoryId: "",
    },
  });

  const dataWithCategories = templates.map((t) => ({
    ...t,
    _categories: categories,
    _componentModels: componentModels,
    _allTemplates: templates,
    _bomProps: bomProps,
  }));

  const handleCreate = async (values: TemplateFormValues) => {
    setLoading(true);
    const result = await createDeviceTemplate({
      name: values.name.trim(),
      categoryId: Number(values.categoryId),
      components: bomComponents.map((c) => ({
        modelId: c.modelId,
        quantity: Number(c.quantity),
      })),
      unique: isUnique,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      createForm.reset();
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleCreateOpen = (open: boolean) => {
    if (open) {
      createForm.reset({ name: "", categoryId: "" });
      setIsUnique(false);
      setBomComponents([]);
      setBomNewModelId("");
      setBomNewQuantity("1");
      setEditingTemplateId(null);
    }
    if (!open) {
      createForm.reset();
    }
    setCreateOpen(open);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备模板"
        description="管理设备模板及配件清单"
        action={
          <Button type="button" onClick={() => handleCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建模板
          </Button>
        }
      />
      <DataTable columns={columns} data={dataWithCategories} />

      {/* ========== 创建模板弹窗 ========== */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建模板</DialogTitle>
            <DialogDescription>创建新的设备模板，可同时添加配件清单</DialogDescription>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input {...createForm.register("name")} placeholder="请输入模板名称" />
              {createForm.formState.errors.name && (
                <p className="text-sm text-destructive">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>设备分类</Label>
              <Select
                value={createForm.watch("categoryId")}
                onValueChange={(v) => createForm.setValue("categoryId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {createForm.formState.errors.categoryId && (
                <p className="text-sm text-destructive">{createForm.formState.errors.categoryId.message}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="create-unique"
                checked={isUnique}
                onCheckedChange={(v) => setIsUnique(!!v)}
              />
              <Label htmlFor="create-unique" className="text-sm">
                唯一设备（每个员工只能拥有一台）
              </Label>
            </div>

            {/* 配件清单管理（与编辑弹窗共用同一套 state） */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>配件清单</Label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setBomCopyDialogOpen(true)}
                  disabled={!templates.length}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  从其他模板复制
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>型号名称</TableHead>
                      <TableHead>品牌</TableHead>
                      <TableHead className="w-28">数量</TableHead>
                      <TableHead className="w-12 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bomComponents.length > 0 ? (
                      bomComponents.map((c, index) => (
                        <TableRow
                          key={c.modelId}
                          draggable
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDragEnd={handleDragEnd}
                          className={bomDraggedIndex === index ? "opacity-50" : ""}
                        >
                          <TableCell className="cursor-move">
                            <GripVertical className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell>{c.brand ?? "-"}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              className="h-8 w-20"
                              value={c.quantity}
                              onChange={(e) =>
                                handleQuantityChange(c.modelId, e.target.value)
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="移除"
                              type="button"
                              onClick={() => handleRemoveComponent(c.modelId)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-sm text-muted-foreground py-4"
                        >
                          暂无配件，请在下方添加或从其他模板复制
                        </TableCell>
                      </TableRow>
                    )}
                    {/* 添加配件行 */}
                    <TableRow>
                      <TableCell></TableCell>
                      <TableCell colSpan={2}>
                        <SearchableSelect
                          options={modelOptions}
                          value={bomNewModelId}
                          onValueChange={setBomNewModelId}
                          placeholder="选择配件型号"
                          emptyText="无匹配的配件型号"
                          triggerClassName="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          className="h-8 w-20"
                          value={bomNewQuantity}
                          onChange={(e) => setBomNewQuantity(e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="添加"
                          type="button"
                          disabled={!bomNewModelId}
                          onClick={handleAddComponent}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========== 从其他模板复制配件弹窗（创建/编辑共用） ========== */}
      <Dialog open={bomCopyDialogOpen} onOpenChange={setBomCopyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>从其他模板复制配件</DialogTitle>
            <DialogDescription>选择要复制配件的源模板</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>源模板</Label>
              <Select value={bomSelectedCopyTemplateId} onValueChange={setBomSelectedCopyTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择模板" />
                </SelectTrigger>
                <SelectContent>
                  {otherTemplateOptions.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBomCopyDialogOpen(false)}>取消</Button>
            <Button type="button" onClick={handleCopyFromTemplate} disabled={!bomSelectedCopyTemplateId}>确认复制</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}