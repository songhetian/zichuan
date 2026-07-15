"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { TreeTable, type TreeNode } from "@/components/features/tree-table";
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
import { Plus, Trash2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createComponentCategory,
  deleteComponentCategory,
  updateComponentCategory,
} from "@/actions/component-category.actions";

interface Category extends TreeNode {}

function ComponentActionButtons({
  category,
  onRefresh,
}: {
  category: Category;
  onRefresh: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    const result = await deleteComponentCategory(category.id);
    if (result.success) {
      toast({ title: "删除成功" });
      onRefresh();
    } else {
      toast({
        title: "删除失败",
        description: result.error,
        variant: "destructive",
      });
    }
    setDeleteOpen(false);
  };

  const handleEditOpen = (v: boolean) => {
    if (v) {
      setEditName(category.name);
    }
    setEditOpen(v);
  };

  const handleEdit = async () => {
    if (!editName.trim()) return;
    setEditLoading(true);
    const result = await updateComponentCategory(category.id, {
      name: editName.trim(),
    });
    setEditLoading(false);
    if (result.success) {
      toast({ title: "更新成功" });
      setEditOpen(false);
      onRefresh();
    } else {
      toast({
        title: "更新失败",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 justify-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="编辑"
          onClick={() => handleEditOpen(true)}
        >
          <Pencil className="h-4 w-4 text-primary" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="删除"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要删除分类「${category.name}」吗？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑分类</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>分类名称</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="分类名称"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleEdit}
              disabled={editLoading || !editName.trim()}
            >
              {editLoading ? "保存中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ComponentCategoriesClient({
  initialCategories,
}: {
  initialCategories: Category[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [parentId, setParentId] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleRefresh = () => router.refresh();

  const handleCreate = async () => {
    if (!catName.trim()) return;
    setLoading(true);
    const result = await createComponentCategory({
      name: catName.trim(),
      parentId: parentId ? Number(parentId) : undefined,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      setCatName("");
      setParentId("");
      router.refresh();
    } else {
      toast({
        title: "创建失败",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const topLevelCategories = initialCategories.filter(
    (c) => c.parentId == null
  );

  const columns = [{ key: "name", header: "分类名称" }];

  return (
    <div className="space-y-4">
      <PageHeader
        title="配件分类"
        description="管理配件分类信息"
        action={
          <Button
            size="sm"
            onClick={() => {
              setCatName("");
              setParentId("");
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            新建
          </Button>
        }
      />
      <TreeTable
        data={initialCategories}
        columns={columns}
        actions={(node) => (
          <ComponentActionButtons category={node} onRefresh={handleRefresh} />
        )}
        emptyText="暂无分类数据"
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建配件分类</DialogTitle>
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
                  {topLevelCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id.toString()}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>分类名称</Label>
              <Input
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="如：内存"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={loading || !catName.trim()}
            >
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}