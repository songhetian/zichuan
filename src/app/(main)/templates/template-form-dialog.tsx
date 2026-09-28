"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { BomTable, type BomComponent, type ComponentModelOption, type TemplateOption, type ComponentCategoryOption } from "./bom-table";
import { createDeviceTemplate, updateDeviceTemplate } from "@/actions/device-template.actions";

const templateSchema = z.object({
  name: z.string().min(1, "模板名称不能为空"),
  categoryId: z.string().min(1, "请选择设备分类"),
  brand: z.string().optional(),
  model: z.string().optional(),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

export interface TemplateData {
  id: number;
  name: string;
  categoryId: number;
  brand: string | null;
  model: string | null;
  createdAt: string;
  components: {
    id: number;
    modelId: number;
    quantity: number;
    modelName: string;
    modelBrand: string | null;
    categoryId: number;
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
  componentCategories: ComponentCategoryOption[];
}

/** 分区标题：细竖条强调 + 标签，右侧可挂载统计/操作 */
function SectionTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-primary" />
        <span className="text-[13px] font-medium text-foreground">{children}</span>
      </div>
      {meta}
    </div>
  );
}

export function TemplateFormDialog({
  open,
  onOpenChange,
  mode,
  template,
  categories,
  componentModels,
  templates,
  componentCategories,
}: TemplateFormDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bomComponents, setBomComponents] = useState<BomComponent[]>([]);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: "", categoryId: "", brand: "", model: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && template) {
      form.reset({
        name: template.name,
        categoryId: template.categoryId.toString(),
        brand: template.brand ?? "",
        model: template.model ?? "",
      });
      // 构建 modelId → (categoryId, categoryName) 映射，用于补充配件分类信息
      const modelInfoMap = new Map(
        componentModels.map((m) => [m.id, { categoryId: m.categoryId, categoryName: m.categoryName }])
      );
      setBomComponents(
        template.components.map((c) => {
          const info = modelInfoMap.get(c.modelId);
          return {
            modelId: c.modelId,
            quantity: c.quantity,
            name: c.modelName,
            brand: c.modelBrand,
            categoryId: info?.categoryId,
            categoryName: info?.categoryName,
          };
        })
      );
    } else {
      form.reset({ name: "", categoryId: "", brand: "", model: "" });
      setBomComponents([]);
    }
  }, [open, mode, template]);

  const handleSubmit = async (values: TemplateFormValues) => {
    setLoading(true);
    const payload = {
      name: values.name.trim(),
      categoryId: Number(values.categoryId),
      // 品牌/型号挂在模板上，建档时带出到每台设备；留空则清空
      brand: values.brand?.trim() || null,
      model: values.model?.trim() || null,
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

  const isCreate = mode === "create";
  const totalQuantity = bomComponents.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col gap-0 overflow-hidden p-0">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="mb-0 border-b border-border px-7 pb-5 pt-6">
            <DialogTitle className="text-lg">{isCreate ? "新建设备模板" : "编辑设备模板"}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {isCreate ? "填写模板基本信息，并按需配置配件清单" : "修改模板信息及配件配置"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-6">
            {/* 基本信息 */}
            <section className="space-y-3">
              <SectionTitle>基本信息</SectionTitle>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="template-name" className="req text-sm font-medium text-foreground">
                      模板名称
                    </Label>
                    <Input
                      id="template-name"
                      {...form.register("name")}
                      placeholder="如：MacBook Pro 14 英寸"
                      className="h-10"
                    />
                    {form.formState.errors.name && (
                      <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="template-category" className="req text-sm font-medium text-foreground">
                      设备分类
                    </Label>
                    <Select
                      value={form.watch("categoryId")}
                      onValueChange={(v) => form.setValue("categoryId", v)}
                    >
                      <SelectTrigger id="template-category" className="h-10">
                        <SelectValue placeholder="请选择设备分类" />
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

                  <div className="space-y-1.5">
                    <Label htmlFor="template-brand" className="text-sm font-medium text-foreground">
                      品牌
                    </Label>
                    <Input
                      id="template-brand"
                      {...form.register("brand")}
                      placeholder="选填，如 戴尔"
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="template-model" className="text-sm font-medium text-foreground">
                      型号
                    </Label>
                    <Input
                      id="template-model"
                      {...form.register("model")}
                      placeholder="选填，如 U2723QE"
                      className="h-10"
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  品牌 / 型号为选填，建档时自动带出到每台设备，无需逐台重复填写。
                </p>
              </div>
            </section>

            {/* 配件清单 */}
            <section className="space-y-3">
              <SectionTitle
                meta={
                  bomComponents.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      已选 {bomComponents.length} 项 · 共 {totalQuantity} 件
                    </span>
                  ) : null
                }
              >
                配件清单
              </SectionTitle>

              <div className="rounded-lg border border-border bg-card p-4">
                <BomTable
                  modelOptions={componentModels}
                  templates={templates}
                  categories={componentCategories}
                  value={bomComponents}
                  onChange={setBomComponents}
                />
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                配件清单为选填项，创建后可通过「编辑」继续补充，也可直接从其他模板复制配件配置。
              </p>
            </section>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between gap-4 border-t border-border px-7 py-4">
            <p className="text-xs text-muted-foreground">
              {bomComponents.length > 0
                ? `已配置 ${bomComponents.length} 项配件，共 ${totalQuantity} 件`
                : "尚未配置配件（选填）"}
            </p>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" className="h-10 px-5" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading} className="h-10 px-6">
                {loading ? (isCreate ? "创建中..." : "保存中...") : (isCreate ? "创建模板" : "保存更改")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
