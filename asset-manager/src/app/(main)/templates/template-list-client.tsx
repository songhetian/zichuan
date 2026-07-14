"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Plus, Eye, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createDeviceTemplate,
  deleteDeviceTemplate,
  updateDeviceTemplate,
} from "@/actions/device-template.actions";

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

interface TemplateListClientProps {
  templates: Template[];
  categories: { id: number; name: string; code: string; parentId: number | null }[];
  componentModels: ComponentModel[];
}

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
          />
        </div>
      );
    },
  },
];

function ActionButtons({
  template,
  categories,
  componentModels,
}: {
  template: Template & { _categories?: { id: number; name: string }[] };
  categories?: { id: number; name: string }[];
  componentModels?: ComponentModel[];
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(template.name);
  const [editCategoryId, setEditCategoryId] = useState(template.categoryId.toString());
  const [editUnique, setEditUnique] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  // 配件清单编辑 state：{ modelId, quantity, name, brand }
  const [editComponents, setEditComponents] = useState<
    { modelId: number; quantity: number; name: string; brand: string | null }[]
  >([]);
  const [newModelId, setNewModelId] = useState<string>("");
  const [newQuantity, setNewQuantity] = useState<string>("1");
  const { toast } = useToast();

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

  const handleEdit = async () => {
    if (!editName.trim() || !editCategoryId) return;
    setEditLoading(true);
    const result = await updateDeviceTemplate(template.id, {
      name: editName.trim(),
      categoryId: Number(editCategoryId),
      unique: editUnique,
      components: editComponents.map((c) => ({
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
      setEditName(template.name);
      setEditCategoryId(template.categoryId.toString());
      setEditUnique(template.unique ?? false);
      // 用 template.components 初始化配件清单
      setEditComponents(
        template.components.map((c) => ({
          modelId: c.modelId,
          quantity: c.quantity,
          name: c.modelName,
          brand: c.modelBrand,
        }))
      );
      setNewModelId("");
      setNewQuantity("1");
    }
    setEditOpen(open);
  };

  // 添加配件到清单
  const handleAddComponent = () => {
    if (!newModelId) return;
    const model = (componentModels ?? []).find((m) => m.id === Number(newModelId));
    if (!model) return;
    const qty = Number(newQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setEditComponents((prev) => {
      const existing = prev.find((c) => c.modelId === model.id);
      if (existing) {
        // 已存在则累加数量
        return prev.map((c) =>
          c.modelId === model.id
            ? { ...c, quantity: c.quantity + qty }
            : c
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
    setNewModelId("");
    setNewQuantity("1");
  };

  // 修改某行数量
  const handleQuantityChange = (modelId: number, value: string) => {
    setEditComponents((prev) =>
      prev.map((c) =>
        c.modelId === modelId ? { ...c, quantity: Number(value) || 0 } : c
      )
    );
  };

  // 删除某行配件
  const handleRemoveComponent = (modelId: number) => {
    setEditComponents((prev) => prev.filter((c) => c.modelId !== modelId));
  };

  // 配件型号 Select 选项：名称（品牌）
  const modelOptions = (componentModels ?? []).map((m) => ({
    value: m.id.toString(),
    label: m.brand ? `${m.name}（${m.brand}）` : m.name,
  }));

  return (
    <>
      <Button variant="ghost" size="icon" title="详情" onClick={() => setDetailOpen(true)}>
        <Eye className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" title="编辑" onClick={() => handleEditOpen(true)}>
        <Pencil className="h-4 w-4 text-primary" />
      </Button>
      <Button variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑模板</DialogTitle>
            <DialogDescription>修改模板基本信息及配件清单</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="请输入模板名称" />
            </div>
            <div className="space-y-2">
              <Label>设备分类</Label>
              <Select value={editCategoryId} onValueChange={setEditCategoryId}>
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
              <Label>配件清单</Label>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>型号名称</TableHead>
                      <TableHead>品牌</TableHead>
                      <TableHead className="w-28">数量</TableHead>
                      <TableHead className="w-12 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editComponents.length > 0 ? (
                      editComponents.map((c) => (
                        <TableRow key={c.modelId}>
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
                          colSpan={4}
                          className="text-center text-sm text-muted-foreground py-4"
                        >
                          暂无配件，请在下方添加
                        </TableCell>
                      </TableRow>
                    )}
                    {/* 添加配件行 */}
                    <TableRow>
                      <TableCell colSpan={2}>
                        <SearchableSelect
                          options={modelOptions}
                          value={newModelId}
                          onValueChange={setNewModelId}
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
                          value={newQuantity}
                          onChange={(e) => setNewQuantity(e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="添加"
                          disabled={!newModelId}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName.trim() || !editCategoryId}>
              {editLoading ? "更新中..." : "确认"}
            </Button>
          </DialogFooter>
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

export function TemplateListClient({ templates, categories, componentModels }: TemplateListClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isUnique, setIsUnique] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const dataWithCategories = templates.map((t) => ({
    ...t,
    _categories: categories,
    _componentModels: componentModels,
  }));

  const handleCreate = async () => {
    if (!name.trim() || !categoryId) return;
    setLoading(true);
    const result = await createDeviceTemplate({
      name: name.trim(),
      categoryId: Number(categoryId),
      components: [],
      unique: isUnique,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      setName("");
      setCategoryId("");
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备模板"
        description="管理设备模板及配件清单"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建模板
          </Button>
        }
      />
      <DataTable columns={columns} data={dataWithCategories} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建模板</DialogTitle>
            <DialogDescription>创建新的设备模板</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入模板名称" />
            </div>
            <div className="space-y-2">
              <Label>设备分类</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={loading || !name.trim() || !categoryId}>
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
