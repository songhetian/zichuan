"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { TreeTable, type TreeNode } from "@/components/features/tree-table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createAssetCategory,
  deleteAssetCategory,
  updateAssetCategory,
  moveAssetCategory,
} from "@/actions/asset-category.actions";
import { ActionButtons } from "@/components/features/action-buttons";
import { SimpleCrudDialog, type FieldConfig } from "@/components/features/simple-crud-dialog";

interface Category extends TreeNode {
  code: string;
}

export function AssetCategoriesClient({
  initialCategories,
}: {
  initialCategories: Category[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const { toast } = useToast();

  const handleRefresh = () => router.refresh();

  const handleDragEnd = async (draggedId: number, targetId: number, position: 'before' | 'after' | 'inside') => {
    if (position === 'inside') {
      const result = await moveAssetCategory(draggedId, { parentId: targetId });
      if (result.success) {
        toast({ title: "移动成功" });
        router.refresh();
      } else {
        toast({
          title: "移动失败",
          description: result.error,
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "提示",
        description: "仅支持移动到其他分类下作为子分类",
      });
    }
  };

  const topLevelCategories = initialCategories.filter((c) => c.parentId == null);
  const parentOptions = [
    { value: "", label: "无父分类" },
    ...topLevelCategories.map((cat) => ({ value: cat.id.toString(), label: cat.name })),
  ];

  const createFields: FieldConfig[] = [
    { key: "parentId", label: "父分类", type: "select", options: parentOptions, optional: true, placeholder: "无父分类（顶级分类）" },
    { key: "name", label: "分类名称", type: "text", placeholder: "如：笔记本电脑" },
  ];

  const editFields: FieldConfig[] = [
    { key: "name", label: "分类名称", type: "text", placeholder: "分类名称" },
    { key: "code", label: "分类编码", type: "text", placeholder: "自动生成的编码", optional: true, hint: "留空则保持原编码" },
  ];

  const handleCreate = async (values: Record<string, string>) => {
    const result = await createAssetCategory({
      name: values.name,
      parentId: values.parentId ? Number(values.parentId) : undefined,
    });
    if (result.success) {
      router.refresh();
    }
    return result;
  };

  const handleEdit = async (category: Category, values: Record<string, string>) => {
    const result = await updateAssetCategory(category.id, {
      name: values.name,
      code: values.code || undefined,
    });
    if (result.success) {
      router.refresh();
    }
    return result;
  };

  const handleDelete = async (category: Category) => {
    const result = await deleteAssetCategory(category.id);
    if (result.success) {
      router.refresh();
    }
    return result;
  };

  const columns = [
    { key: "name", header: "分类名称" },
    {
      key: "code",
      header: "编码",
      render: (node: Category) => <span className="font-mono text-sm">{node.code}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备分类"
        description="管理设备分类信息"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />新建
          </Button>
        }
      />
      <TreeTable
        data={initialCategories}
        columns={columns}
        actions={(node) => (
          <ActionButtons
            id={node.id}
            name={node.name}
            onEdit={(values) => handleEdit(node as Category, values)}
            onDelete={() => handleDelete(node as Category)}
            editTitle="编辑分类"
            editFields={editFields}
            initialValues={{ name: (node as Category).name, code: (node as Category).code }}
          />
        )}
        emptyText="暂无分类数据"
        draggable
        onDragEnd={handleDragEnd}
      />

      <SimpleCrudDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        title="新建设备分类"
        fields={createFields}
        onSubmit={handleCreate}
      />
    </div>
  );
}