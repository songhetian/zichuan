"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PackagePlus, Pencil, Trash2, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  purchaseStockIn,
} from "@/actions/component-stock.actions";
import {
  createComponentModel,
  deleteComponentModel,
  updateComponentModel,
} from "@/actions/component-model.actions";
import { exportComponentsToExcel, importComponentModelsFromExcel } from "@/actions/excel.actions";
import { useRef } from "react";

interface ComponentModel {
  id: number;
  name: string;
  brand: string | null;
  categoryId: number;
  stock: number;
}

interface ModelsClientProps {
  models: ComponentModel[];
  categories: { id: number; name: string; parentId: number | null }[];
}

function getCategoryName(categoryId: number, categories: { id: number; name: string }[]): string {
  const cat = categories.find((c) => c.id === categoryId);
  return cat?.name ?? "-";
}

const columns: ColumnDef<ComponentModel & { _categories: { id: number; name: string }[] }>[] = [
  {
    id: "category",
    header: "分类",
    cell: ({ row }) => getCategoryName(row.original.categoryId, row.original._categories),
  },
  { accessorKey: "name", header: "型号名称" },
  {
    accessorKey: "brand",
    header: "品牌",
    cell: ({ row }) => row.getValue("brand") ?? "-",
  },
  {
    accessorKey: "stock",
    header: "库存数量",
    cell: ({ row }) => (
      <span className={row.original.stock > 0 ? "text-green-600 font-medium" : "text-muted-foreground"}>
        {row.original.stock}
      </span>
    ),
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => {
      const model = row.original;
      return (
        <div className="flex items-center gap-1 justify-center">
          <ComponentActionButtons model={model} categories={model._categories} />
        </div>
      );
    },
  },
];

function ComponentActionButtons({
  model,
  categories,
}: {
  model: ComponentModel & { _categories: { id: number; name: string }[] };
  categories: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [stockInOpen, setStockInOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(model.name);
  const [editBrand, setEditBrand] = useState(model.brand ?? "");
  const [editCategoryId, setEditCategoryId] = useState(model.categoryId.toString());
  const [editLoading, setEditLoading] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleStockIn = async () => {
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "请输入有效的数量", variant: "destructive" });
      return;
    }
    setLoading(true);
    const result = await purchaseStockIn({
      modelId: model.id,
      quantity: qty,
      operator: "admin",
    });
    setLoading(false);
    if (result.success) {
      toast({ title: `入库成功，当前库存: ${result.data.quantity}` });
      setStockInOpen(false);
      setQuantity("");
      router.refresh();
    } else {
      toast({ title: "入库失败", description: result.error, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    const result = await deleteComponentModel(model.id);
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
    const result = await updateComponentModel(model.id, {
      name: editName.trim(),
      brand: editBrand.trim() || undefined,
      categoryId: Number(editCategoryId),
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
      setEditName(model.name);
      setEditBrand(model.brand ?? "");
      setEditCategoryId(model.categoryId.toString());
    }
    setEditOpen(open);
  };

  return (
    <>
      <Button variant="ghost" size="icon" title="入库" onClick={() => setStockInOpen(true)}>
        <PackagePlus className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" title="编辑" onClick={() => handleEditOpen(true)}>
        <Pencil className="h-4 w-4 text-primary" />
      </Button>
      <Button variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

      <Dialog open={stockInOpen} onOpenChange={(v) => { if (!v) setQuantity(""); setStockInOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>入库</DialogTitle>
            <DialogDescription>为「{model.name}」添加库存</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>入库数量</Label>
            <Input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="请输入入库数量"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setQuantity(""); setStockInOpen(false); }}>取消</Button>
            <Button onClick={handleStockIn} disabled={loading || !quantity}>
              {loading ? "入库中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑配件型号</DialogTitle>
            <DialogDescription>修改配件型号信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>型号名称</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="请输入型号名称" />
            </div>
            <div className="space-y-2">
              <Label>品牌</Label>
              <Input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} placeholder="可选" />
            </div>
            <div className="space-y-2">
              <Label>配件分类</Label>
              <Select value={editCategoryId} onValueChange={setEditCategoryId}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName.trim() || !editCategoryId}>
              {editLoading ? "更新中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要删除配件型号「${model.name}」吗？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}

export function ModelsClient({ models, categories }: ModelsClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const dataWithCategories = models.map((m) => ({
    ...m,
    _categories: categories,
  }));

  const handleCreate = async () => {
    if (!name.trim() || !categoryId) return;
    setLoading(true);
    const result = await createComponentModel({
      name: name.trim(),
      brand: brand.trim() || undefined,
      categoryId: Number(categoryId),
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      setName("");
      setBrand("");
      setCategoryId("");
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const result = await exportComponentsToExcel();
      if (result.success) {
        const blob = new Blob([result.data.buffer as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.fileName;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "导出成功" });
      } else {
        toast({ title: "导出失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导出失败", variant: "destructive" });
    }
    setExportLoading(false);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const result = await importComponentModelsFromExcel({ buffer });
      if (result.success) {
        const desc = result.data.errors.length > 0
          ? `成功 ${result.data.importedCount} 条，失败 ${result.data.errors.length} 条`
          : `成功导入 ${result.data.importedCount} 条`;
        toast({ title: "导入完成", description: desc });
        router.refresh();
      } else {
        toast({ title: "导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    }
    setImportLoading(false);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="配件型号"
        description="管理配件型号及库存信息"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled={exportLoading}>
              <Download className="mr-2 h-4 w-4" />
              {exportLoading ? "导出中..." : "导出 Excel"}
            </Button>
            <Button variant="outline" onClick={handleImportClick} disabled={importLoading}>
              <Upload className="mr-2 h-4 w-4" />
              {importLoading ? "导入中..." : "导入 Excel"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => setCreateOpen(true)}>
              <PackagePlus className="mr-2 h-4 w-4" />
              新建配件型号
            </Button>
          </div>
        }
      />
      <DataTable columns={columns} data={dataWithCategories} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建配件型号</DialogTitle>
            <DialogDescription>创建新的配件型号</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>型号名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入型号名称" />
            </div>
            <div className="space-y-2">
              <Label>品牌</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="可选" />
            </div>
            <div className="space-y-2">
              <Label>配件分类</Label>
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