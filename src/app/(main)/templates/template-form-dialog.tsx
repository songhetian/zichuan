"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BomTable, type BomComponent, type ComponentModelOption, type TemplateOption } from "./bom-table";
import { createDeviceTemplate, updateDeviceTemplate } from "@/actions/device-template.actions";

const templateSchema = z.object({
  name: z.string().min(1, "模板名称不能为空"),
  categoryId: z.string().min(1, "请选择设备分类"),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

export interface TemplateData {
  id: number;
  name: string;
  categoryId: number;
  components: {
    id: number;
    modelId: number;
    quantity: number;
    modelName: string;
    modelBrand: string | null;
  }[];
}

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  template?: TemplateData | null;
  categories: { id: number; name: string; code: string; unique: boolean; parentId: number | null }[];
  componentModels: ComponentModelOption[];
  templates: TemplateOption[];
}

export function TemplateFormDialog({
  open,
  onOpenChange,
  mode,
  template,
  categories,
  componentModels,
  templates,
}: TemplateFormDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bomComponents, setBomComponents] = useState<BomComponent[]>([]);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: "", categoryId: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && template) {
      form.reset({
        name: template.name,
        categoryId: template.categoryId.toString(),
      });
      setBomComponents(
        template.components.map((c) => ({
          modelId: c.modelId,
          quantity: c.quantity,
          name: c.modelName,
          brand: c.modelBrand,
        }))
      );
    } else {
      form.reset({ name: "", categoryId: "" });
      setBomComponents([]);
    }
  }, [open, mode, template]);

  const handleSubmit = async (values: TemplateFormValues) => {
    setLoading(true);
    const payload = {
      name: values.name.trim(),
      categoryId: Number(values.categoryId),
      components: bomComponents.map((c) => ({
        modelId: c.modelId,
        quantity: Number(c.quantity),
      })),
    };

    const result =
      mode === "create"
        ? await createDeviceTemplate(payload)
        : await updateDeviceTemplate(template!.id, payload);

    setLoading(false);

    if (result.success) {
      toast({ title: mode === "create" ? "创建成功" : "更新成功" });
      onOpenChange(false);
      router.refresh();
    } else {
      toast({
        title: mode === "create" ? "创建失败" : "更新失败",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 overflow-hidden">
          <DialogHeader className="px-6 pb-4 pt-6 border-b border-border">
            <DialogTitle className="text-xl">{mode === "create" ? "新建设备模板" : "编辑设备模板"}</DialogTitle>
            <DialogDescription className="mt-1">
              {mode === "create" ? "填写模板基本信息并配置配件清单" : "修改模板信息及配件配置"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 左侧：基本信息 */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-sm font-medium text-foreground">基本信息</span>
                </div>

                {/* 模板名称 + 设备分类 两列并排 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="template-name">模板名称</Label>
                    <Input
                      id="template-name"
                      {...form.register("name")}
                      placeholder="如：MacBook Pro 14寸"
                      className="h-10"
                    />
                    {form.formState.errors.name && (
                      <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="template-category">设备分类</Label>
                    <Select
                      value={form.watch("categoryId")}
                      onValueChange={(v) => form.setValue("categoryId", v)}
                    >
                      <SelectTrigger id="template-category" className="h-10">
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
                    {form.formState.errors.categoryId && (
                      <p className="text-xs text-destructive">{form.formState.errors.categoryId.message}</p>
                    )}
                  </div>
                </div>

                {/* 唯一性设置已移至设备分类管理中 */}

                {/* 提示信息 */}
                <div className="p-3 rounded-lg bg-accent/50 border border-accent/30">
                  <p className="text-xs text-accent-foreground leading-relaxed">
                    配件清单为选填项，可在创建后通过"编辑"添加。
                    也可从其他模板复制配件配置以提高效率。
                  </p>
                </div>
              </div>

              {/* 右侧：配件清单 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-sm font-medium text-foreground">配件清单</span>
                    {bomComponents.length > 0 && (
                      <span className="text-xs text-muted-foreground">（{bomComponents.length} 项）</span>
                    )}
                  </div>
                </div>

                <BomTable
                  modelOptions={componentModels}
                  templates={templates}
                  value={bomComponents}
                  onChange={setBomComponents}
                />
              </div>
            </div>
          </div>

          {/* 底部固定操作栏 */}
          <DialogFooter className="px-6 py-4 border-t border-border flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {bomComponents.length > 0 && `已配置 ${bomComponents.length} 项配件`}
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading} className="h-10 px-6">
                {loading ? (mode === "create" ? "创建中..." : "更新中...") : (mode === "create" ? "创建模板" : "保存更改")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
