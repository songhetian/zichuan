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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { deleteDeviceTemplate } from "@/actions/device-template.actions";
import { TemplateFormDialog, type TemplateData } from "./template-form-dialog";
import type { ComponentModelOption, TemplateOption } from "./bom-table";

interface TemplateListClientProps {
  templates: TemplateData[];
  categories: { id: number; name: string; code: string; parentId: number | null }[];
  componentModels: ComponentModelOption[];
}

// ============================================================
// 列定义
// ============================================================

interface RowActionProps {
  template: TemplateData;
  categories: { id: number; name: string; code: string; parentId: number | null }[];
  componentModels: ComponentModelOption[];
  allTemplates: TemplateOption[];
}

function RowActions({ template, categories, componentModels, allTemplates }: RowActionProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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

  // 编辑时排除当前模板
  const otherTemplates = allTemplates.filter((t) => t.id !== template.id);

  return (
    <>
      <div className="flex items-center gap-1 justify-center">
        <Button type="button" variant="ghost" size="icon" title="详情" onClick={() => setDetailOpen(true)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" title="编辑" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 text-primary" />
        </Button>
        <Button type="button" variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4 text-destructive" />
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
      />

      {/* 详情弹窗 */}
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
// 主组件
// ============================================================

export function TemplateListClient({ templates, categories, componentModels }: TemplateListClientProps) {
  const [createOpen, setCreateOpen] = useState(false);

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
      <DataTable
        columns={[
          { accessorKey: "name", header: "模板名称" },
          {
            id: "categoryId",
            header: "分类",
            cell: ({ row }) => {
              const cat = categories.find((c) => c.id === row.original.categoryId);
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
            cell: ({ row }) => (
              <RowActions
                template={row.original}
                categories={categories}
                componentModels={componentModels}
                allTemplates={templateOptions}
              />
            ),
          },
        ]}
        data={templates}
      />

      {/* 创建弹窗 */}
      <TemplateFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        categories={categories}
        componentModels={componentModels}
        templates={templateOptions}
      />
    </div>
  );
}
