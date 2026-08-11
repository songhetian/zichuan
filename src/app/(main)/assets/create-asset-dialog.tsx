"use client";

import { useState } from "react";
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

const createAssetSchema = z.object({
  templateId: z.number({ required_error: "请选择设备模板" }),
  name: z.string().min(1, "设备名称不能为空"),
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
  templates: { id: number; name: string; components: TemplateComponent[] }[];
}

export function CreateAssetDialog({ open, onOpenChange, templates }: CreateAssetDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<CreateAssetFormValues>({
    resolver: zodResolver(createAssetSchema),
    mode: "onBlur",
    defaultValues: {
      templateId: undefined,
      name: "",
      notes: "",
    },
  });

  const resetForm = () => {
    form.reset();
  };

  const selectedTemplateId = form.watch("templateId");
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const handleSubmit = async (values: CreateAssetFormValues) => {
    setLoading(true);
    const result = await createAsset({
      templateId: values.templateId,
      name: values.name,
      notes: values.notes || undefined,
      operator: "admin",
    });
    setLoading(false);

    if (result.success) {
      toast({ title: "设备创建成功" });
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
          <DialogDescription>选择设备模板并填写基本信息以创建设备。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>设备模板</Label>
            <SearchableSelect
              value={form.watch("templateId")?.toString() ?? ""}
              onValueChange={(v) => {
                // SearchableSelect 点选已选项会回传空串（toggle-off），模板为必填项，忽略空串保持原选中
                if (v) form.setValue("templateId", Number(v));
              }}
              placeholder="选择设备模板"
              triggerClassName="w-full"
              options={templates.map((t) => ({ value: t.id.toString(), label: t.name }))}
            />
            {form.formState.errors.templateId && (
              <p className="text-sm text-destructive">{form.formState.errors.templateId.message}</p>
            )}
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
            <Label>设备名称</Label>
            <Input {...form.register("name")} placeholder="请输入设备名称" />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
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