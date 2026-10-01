"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
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
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
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

/** 分区标题：纯文字字重分层。
 *  刻意不用靛蓝竖条——primary 在本设计系统里是「可操作/已选中」的语义色，
 *  拿它做纯装饰会稀释强调色的含义，且竖条在 2px 下既看不清又添噪。
 *  分区边界交给外层 `divide-y divide-border` 的发丝线承载。 */
function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{children}</h3>
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
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
  /** 打开时的 BOM 快照（JSON）：RHF 的 isDirty 只覆盖表单字段，配件清单要单独比 */
  const initialBomRef = useRef<string>("[]");
  const [discardOpen, setDiscardOpen] = useState(false);

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
      const list = template.components.map((c) => {
        const info = modelInfoMap.get(c.modelId);
        return {
          modelId: c.modelId,
          quantity: c.quantity,
          name: c.modelName,
          brand: c.modelBrand,
          categoryId: info?.categoryId,
          categoryName: info?.categoryName,
        };
      });
      setBomComponents(list);
      initialBomRef.current = JSON.stringify(list);
    } else {
      form.reset({ name: "", categoryId: "", brand: "", model: "" });
      setBomComponents([]);
      initialBomRef.current = "[]";
    }
    // 打开即聚焦首字段，省掉一次鼠标点击（form 引用在渲染间稳定，无需入依赖）
    const timer = setTimeout(() => form.setFocus("name"), 60);
    return () => clearTimeout(timer);
  }, [open, mode, template, componentModels]);

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

  // 未保存判断：表单字段走 RHF isDirty，配件清单用 JSON 快照比对
  const bomDirty = JSON.stringify(bomComponents) !== initialBomRef.current;
  const dirty = form.formState.isDirty || bomDirty;

  /** 用户主动关闭（X / ESC / 点遮罩 / 取消）的统一出口：有未保存内容先确认，避免静默丢失 */
  const requestClose = (next: boolean) => {
    if (!next && dirty && !loading) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(next);
  };

  const handleDiscard = () => {
    setDiscardOpen(false);
    form.reset();
    setBomComponents([]);
    initialBomRef.current = "[]";
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-4xl max-h-[88vh] flex flex-col gap-0 overflow-hidden p-0">
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter 提交 —— 专业后台的通用约定
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              form.handleSubmit(handleSubmit)();
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="mb-0 border-b border-border px-7 pb-5 pt-6">
            <DialogTitle className="text-lg">{isCreate ? "新建设备模板" : "编辑设备模板"}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {isCreate ? "填写模板基本信息，并按需配置配件清单" : "修改模板信息及配件配置"}
            </DialogDescription>
          </DialogHeader>

          {/* 分区不套卡片：弹框内再套「卡片」是最典型的业余信号（dialog > card > input 三层底色
              互相抵消，实测 bg-card / bg-muted-40 对弹框底均为 1.053:1，肉眼等价）。
              改为纯文字标题 + divide-y 发丝线承载边界，底色层数从 3 降到 1。 */}
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-7">
            {/* 基本信息 */}
            <section className="space-y-4 py-6">
              <SectionTitle hint="模板的标识信息">基本信息</SectionTitle>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* 模板名称是唯一必填且最长（含款式后缀）的字段 —— 独占整行，
                    「最重要的字段最宽」是表单布局的硬原则，挤在半宽里必被截断 */}
                <div className="space-y-1.5 sm:col-span-3">
                    <Label htmlFor="template-name" className="req text-sm font-medium text-foreground">
                      模板名称
                    </Label>
                    <Input
                      id="template-name"
                      {...form.register("name")}
                      placeholder="如：MacBook Pro 14 英寸"
                      className="h-10 bg-card"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.name}
                      aria-describedby={
                        form.formState.errors.name ? "template-name-error" : undefined
                      }
                    />
                    {form.formState.errors.name && (
                      <p id="template-name-error" role="alert" className="text-xs text-destructive">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="template-category" className="req text-sm font-medium text-foreground">
                      设备分类
                    </Label>
                    <Select
                      value={form.watch("categoryId")}
                      onValueChange={(v) =>
                        form.setValue("categoryId", v, { shouldValidate: true, shouldDirty: true })
                      }
                    >
                      <SelectTrigger
                        id="template-category"
                        className="h-10 bg-card"
                        aria-required="true"
                        aria-invalid={!!form.formState.errors.categoryId}
                        aria-describedby={
                          form.formState.errors.categoryId ? "template-category-error" : undefined
                        }
                      >
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
                      <p
                        id="template-category-error"
                        role="alert"
                        className="text-xs text-destructive"
                      >
                        {form.formState.errors.categoryId.message}
                      </p>
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
                      className="h-10 bg-card"
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
                      className="h-10 bg-card"
                    />
                  </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                品牌 / 型号为选填，建档时自动带出到每台设备，无需逐台重复填写。
              </p>
            </section>

            {/* 配件清单 */}
            <section className="space-y-4 py-6">
              <SectionTitle hint="选填，创建后仍可修改">配件清单</SectionTitle>

              <BomTable
                modelOptions={componentModels}
                templates={templates}
                categories={componentCategories}
                value={bomComponents}
                onChange={setBomComponents}
              />

              <p className="text-xs leading-relaxed text-muted-foreground">
                也可从其他模板一键复制整份配件配置。
              </p>
            </section>
          </div>

          {/* 底部操作栏：统计只在此处出现一次（不再与分区标题重复），紧邻提交决策点 */}
          <div className="flex flex-col gap-3 border-t border-border px-7 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {bomComponents.length > 0 ? (
                  <>
                    已配置{" "}
                    <span className="font-medium tabular-nums text-foreground">{bomComponents.length}</span> 项配件 · 共{" "}
                    <span className="font-medium tabular-nums text-foreground">{totalQuantity}</span> 件
                  </>
                ) : (
                  "未配置配件（选填）"
                )}
              </p>
              {/* 把「脏状态」显性化：上一轮加的 isDirty 检测此前只在关闭时生效，
                  用户完全看不见，等于白做。这里让它可见，改动才「看得见」。 */}
              {dirty && !loading && (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-warning">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                  有未保存的更改
                </span>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="outline" className="h-10 px-5" onClick={() => requestClose(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading} className="h-10 px-6">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {loading ? (isCreate ? "创建中..." : "保存中...") : (isCreate ? "创建模板" : "保存更改")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>

      {/* 未保存更改确认（Radix 嵌套弹层，靠 dialog.tsx 的嵌套豁免避免两框互相误关） */}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="放弃未保存的更改？"
        description="当前表单有未保存的内容，关闭后这些修改将丢失。"
        confirmText="放弃更改"
        cancelText="继续编辑"
        variant="destructive"
        onConfirm={handleDiscard}
      />
    </Dialog>
  );
}
