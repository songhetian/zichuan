"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createAsset } from "@/actions/asset.actions";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

// 设备模板必填：模板决定编号前缀（挂在分类上）、配件清单（BOM）与品牌/型号，
// 建档时按「模板用量 × 数量」扣减配件库存，品牌/型号从模板带出到每台设备。
// 显示器等无配件外设用空 BOM 模板。
// 设备名称不对外暴露：不填使用人即入闲置池（名称取模板名），填了则由系统直接改为「{使用人}的{设备分类}」。
const createAssetSchema = z.object({
  // 仅作模板筛选器，不提交给后端（选中模板后自动带出模板所属分类）
  categoryId: z.number().optional(),
  templateId: z.number({ required_error: "请选择设备模板" }),
  quantity: z
    .number({ required_error: "请输入数量", invalid_type_error: "请输入数量" })
    .int("数量必须为整数")
    .min(1, "数量至少为 1"),
  // 选填：填了即建档即分配（状态「在用」），不填则直接进闲置池（状态「闲置」）
  employeeId: z.number().optional(),
  serialNo: z.string().optional(),
  notes: z.string().optional(),
});

type CreateAssetFormValues = z.infer<typeof createAssetSchema>;

interface TemplateComponent {
  modelId: number;
  modelName: string;
  modelBrand: string | null;
  quantity: number;
}

interface CreateAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: {
    id: number;
    name: string;
    categoryId: number;
    brand?: string | null;
    model?: string | null;
    components: TemplateComponent[];
  }[];
  categories: { id: number; name: string; parentId: number | null }[];
  employees: { id: number; name: string; departmentName: string }[];
}

export function CreateAssetDialog({
  open,
  onOpenChange,
  templates,
  categories,
  employees,
}: CreateAssetDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<CreateAssetFormValues>({
    resolver: zodResolver(createAssetSchema),
    mode: "onBlur",
    defaultValues: {
      categoryId: undefined,
      templateId: undefined,
      quantity: 1,
      employeeId: undefined,
      serialNo: "",
      notes: "",
    },
  });

  const resetForm = () => {
    form.reset();
  };

  const selectedCategoryId = form.watch("categoryId");
  const selectedTemplateId = form.watch("templateId");
  const quantity = form.watch("quantity");
  // 分类下拉只列叶子分类：父级节点（「计算机设备」「办公设备」…）是分组用的，
  // 往上面挂设备会产出编号前缀正确、语义却是"垃圾分类"的设备。
  const leafCategories = categories.filter(
    (c) => !categories.some((other) => other.parentId === c.id)
  );
  // 分类是模板的筛选器：未选分类时列出全部模板，选定分类后只列该分类下的模板
  const categoryTemplates =
    selectedCategoryId == null ? templates : templates.filter((t) => t.categoryId === selectedCategoryId);
  const selectedTemplate = categoryTemplates.find((t) => t.id === selectedTemplateId);

  // 一机一号：批量生成时序列号无从对应，禁用并清空
  useEffect(() => {
    if (quantity > 1) form.setValue("serialNo", "");
  }, [quantity, form]);

  const handleSubmit = async (values: CreateAssetFormValues) => {
    setLoading(true);
    const result = await createAsset({
      templateId: values.templateId,
      quantity: values.quantity,
      employeeId: values.employeeId,
      serialNo: values.serialNo?.trim() || undefined,
      notes: values.notes || undefined,
      operator: "admin",
    });
    setLoading(false);

    if (result.success) {
      const assignee = employees.find((e) => e.id === values.employeeId);
      toast({
        title: assignee
          ? `已生成 ${values.quantity} 台设备并分配给 ${assignee.name}`
          : `已生成 ${values.quantity} 台设备并进入闲置（状态「闲置」）`,
      });
      onOpenChange(false);
      resetForm();
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建设备</DialogTitle>
          <DialogDescription>选择设备模板与数量，系统按模板批量生成设备并自动命名。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>设备分类</Label>
            <SearchableSelect
              value={form.watch("categoryId")?.toString() ?? ""}
              onValueChange={(v) => {
                // SearchableSelect 点选已选项会回传空串（toggle-off），分类仅作筛选器，忽略空串保持原选中
                if (!v) return;
                const categoryId = Number(v);
                form.setValue("categoryId", categoryId);
                // 换分类后原模板可能不属于新分类，清空避免张冠李戴
                const current = templates.find((t) => t.id === form.getValues("templateId"));
                if (current && current.categoryId !== categoryId) {
                  form.resetField("templateId");
                }
              }}
              placeholder="选择设备分类"
              ariaLabel="设备分类"
              triggerClassName="w-full"
              options={leafCategories.map((c) => ({ value: c.id.toString(), label: c.name }))}
            />
            <p className="text-xs text-muted-foreground">用于筛选模板，选定模板后自动带出模板所属分类。</p>
          </div>

          <div className="space-y-2">
            <Label>设备模板</Label>
            <SearchableSelect
              value={form.watch("templateId")?.toString() ?? ""}
              onValueChange={(v) => {
                // 模板为必选项，点选已选项的空串（toggle-off）忽略，避免误清空
                if (!v) return;
                const templateId = Number(v);
                form.setValue("templateId", templateId);
                // 选模板即确定分类：反填，保证下拉回显与筛选状态一致
                const picked = templates.find((t) => t.id === templateId);
                if (picked) form.setValue("categoryId", picked.categoryId);
              }}
              placeholder="选择设备模板"
              ariaLabel="设备模板"
              triggerClassName="w-full"
              options={categoryTemplates.map((t) => ({ value: t.id.toString(), label: t.name }))}
            />
            {form.formState.errors.templateId && (
              <p className="text-sm text-destructive">{form.formState.errors.templateId.message}</p>
            )}
            {selectedTemplate && (selectedTemplate.brand || selectedTemplate.model) && (
              <p className="text-xs text-muted-foreground">
                {selectedTemplate.brand && <span>品牌：{selectedTemplate.brand}</span>}
                {selectedTemplate.brand && selectedTemplate.model && <span className="mx-1.5">·</span>}
                {selectedTemplate.model && <span>型号：{selectedTemplate.model}</span>}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              按模板配件清单出库组装：生成数量 × 每台用量，库存不足时整单拒绝。
            </p>
          </div>

          {selectedTemplate && (
            <div className="space-y-2">
              <Label>配置预览</Label>
              {selectedTemplate.components.length > 0 ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                  {selectedTemplate.components.map((c) => (
                    <div key={c.modelId} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">
                        {c.modelName}
                        {c.modelBrand ? <span className="text-muted-foreground ml-1">· {c.modelBrand}</span> : null}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">× {c.quantity}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">该模板暂无配件配置</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>数量</Label>
            <Input
              type="number"
              min={1}
              aria-label="数量"
              {...form.register("quantity", { valueAsNumber: true })}
            />
            {form.formState.errors.quantity && (
              <p className="text-sm text-destructive">{form.formState.errors.quantity.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>使用人</Label>
            <SearchableSelect
              value={form.watch("employeeId")?.toString() ?? ""}
              onValueChange={(v) => {
                // 选填项：点选已选项会回传空串（toggle-off），即取消分配
                if (!v) {
                  form.resetField("employeeId");
                  return;
                }
                form.setValue("employeeId", Number(v));
              }}
              placeholder="不选则直接闲置"
              ariaLabel="使用人"
              triggerClassName="w-full"
              options={employees.map((e) => ({
                value: e.id.toString(),
                label: `${e.name}（${e.departmentName}）`,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              选填：填了建档即分配给该员工（状态「在用」），不填则直接闲置（状态「闲置」）等待后续分配。
            </p>
          </div>

          <div className="space-y-2">
            <Label>序列号</Label>
            <Input
              aria-label="序列号"
              disabled={quantity > 1}
              {...form.register("serialNo")}
              placeholder={quantity > 1 ? "批量生成时不填序列号" : "选填，设备序列号（不作唯一校验）"}
            />
          </div>

          <div className="space-y-2">
            <Label>备注</Label>
            <Textarea {...form.register("notes")} placeholder="可选备注信息" rows={3} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
