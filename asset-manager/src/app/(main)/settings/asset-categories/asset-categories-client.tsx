"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import {
  Dialog,
  DialogContent,
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
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createAssetCategory,
  deleteAssetCategory,
} from "@/actions/asset-category.actions";

interface Category {
  id: number;
  name: string;
  code: string;
  parentId: number | null;
}

const columns: ColumnDef<Category>[] = [
  { accessorKey: "name", header: "分类名称" },
  { accessorKey: "code", header: "编码", cell: ({ row }) => (
    <span className="font-mono">{row.original.code}</span>
  )},
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => <ActionButtons category={row.original} />,
  },
];

function ActionButtons({ category }: { category: Category }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    const result = await deleteAssetCategory(category.id);
    if (result.success) {
      toast({ title: "删除成功" });
      window.location.reload();
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-1 justify-center">
        <Button variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description="确定要删除该分类吗？"
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}

export function AssetCategoriesClient({
  initialCategories,
}: {
  initialCategories: Category[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catCode, setCatCode] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!catName.trim() || !catCode.trim()) return;
    setLoading(true);
    const result = await createAssetCategory({
      name: catName.trim(),
      code: catCode.trim(),
      parentId: parentId ? Number(parentId) : undefined,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      setCatName("");
      setCatCode("");
      setParentId("");
      window.location.reload();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备分类"
        description="管理设备分类信息"
        action={
          <Button size="sm" onClick={() => { setCatName(""); setCatCode(""); setCreateOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" />新建
          </Button>
        }
      />
      <DataTable columns={columns} data={initialCategories} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建设备分类</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>父分类（可选）</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger>
                  <SelectValue placeholder="无父分类（顶级分类）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无父分类</SelectItem>
                  {initialCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id.toString()}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>分类名称</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="如：笔记本电脑" />
            </div>
            <div className="space-y-2">
              <Label>分类编码</Label>
              <Input value={catCode} onChange={(e) => setCatCode(e.target.value)} placeholder="如：LAPTOP" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={loading || !catName.trim() || !catCode.trim()}>
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
