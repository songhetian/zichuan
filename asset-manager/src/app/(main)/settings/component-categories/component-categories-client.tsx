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
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createComponentCategory,
  deleteComponentCategory,
} from "@/actions/component-category.actions";

interface Category {
  id: number;
  name: string;
  parentId: number | null;
}

const columns: ColumnDef<Category>[] = [
  { accessorKey: "name", header: "分类名称" },
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
    const result = await deleteComponentCategory(category.id);
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

export function ComponentCategoriesClient({
  initialCategories,
}: {
  initialCategories: Category[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!catName.trim()) return;
    setLoading(true);
    const result = await createComponentCategory({ name: catName.trim() });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      setCatName("");
      window.location.reload();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="配件分类"
        description="管理配件分类信息"
        action={
          <Button size="sm" onClick={() => { setCatName(""); setCreateOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" />新建
          </Button>
        }
      />
      <DataTable columns={columns} data={initialCategories} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建配件分类</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>分类名称</Label>
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="如：内存" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={loading || !catName.trim()}>
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
