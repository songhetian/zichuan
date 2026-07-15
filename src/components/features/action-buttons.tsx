"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "./confirm-dialog";
import { SimpleCrudDialog, type FieldConfig } from "./simple-crud-dialog";
import { useToast } from "@/hooks/use-toast";

interface ActionButtonsProps {
  id: number;
  name: string;
  onEdit: (values: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
  onDelete: () => Promise<{ success: boolean; error?: string }>;
  onSuccess?: () => void;
  editTitle?: string;
  editFields?: FieldConfig[];
  initialValues?: Record<string, string>;
}

export function ActionButtons({
  id,
  name,
  onEdit,
  onDelete,
  onSuccess,
  editTitle = "编辑",
  editFields = [{ key: "name", label: "名称", type: "text" }],
  initialValues = {},
}: ActionButtonsProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    const result = await onDelete();
    if (result.success) {
      toast({ title: "删除成功" });
      onSuccess?.();
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
  };

  const handleEdit = async (values: Record<string, string>) => {
    const result = await onEdit(values);
    if (result.success) {
      onSuccess?.();
    }
    return result;
  };

  return (
    <>
      <div className="flex items-center gap-1 justify-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="编辑"
          onClick={() => setEditOpen(true)}
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

      <SimpleCrudDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        title={editTitle}
        fields={editFields}
        initialValues={initialValues}
        onSubmit={handleEdit}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要删除「${name}」吗？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}