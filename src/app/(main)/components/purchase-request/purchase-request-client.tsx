"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PageHeader } from "@/components/features/page-header";
import { useToast } from "@/hooks/use-toast";
import { submitApprovalRequest } from "@/actions/approval.actions";

type CategoryNode = {
  id: number;
  name: string;
  children?: CategoryNode[];
};

type ModelCatalog = { id: number; name: string; brand: string | null; categoryId: number };

interface PurchaseRequestClientProps {
  categories: CategoryNode[];
  models: ModelCatalog[];
}

/** 把分类树摊平成可选项 */
function flattenCategories(nodes: CategoryNode[], depth = 0): { value: string; label: string }[] {
  return nodes.flatMap((c) => [
    { value: String(c.id), label: c.name },
    ...flattenCategories(c.children ?? [], depth + 1),
  ]);
}

export function PurchaseRequestClient({ categories, models }: PurchaseRequestClientProps) {
  const router = useRouter();
  const { toast } = useToast();

  const catOptions = flattenCategories(categories);
  const [categoryId, setCategoryId] = useState<string>("");
  const [categoryBrand, setCategoryBrand] = useState<string>("__all__");
  const [source, setSource] = useState<"existing" | "new">("existing");

  // 当前分类下的全部型号（含品牌）与品牌选项
  const categoryModels = models.filter((m) => String(m.categoryId) === categoryId);
  const brandOptions = Array.from(
    new Set(categoryModels.map((m) => m.brand && m.brand.trim() ? m.brand.trim() : "无品牌"))
  ).sort();

  // 型号目录：再叠加品牌筛选（全部 / 选定品牌）
  const modelOptions = categoryModels
    .filter((m) => {
      if (categoryBrand === "__all__") return true;
      const b = m.brand && m.brand.trim() ? m.brand.trim() : "无品牌";
      return b === categoryBrand;
    })
    .map((m) => {
      const b = m.brand && m.brand.trim() ? m.brand.trim() : "";
      return { value: String(m.id), label: b ? `${m.name}（${b}）` : m.name };
    });
  const [modelId, setModelId] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [brand, setBrand] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!categoryId) {
      toast({ title: "请选择配件分类", variant: "destructive" });
      return;
    }
    if (source === "existing" && !modelId) {
      toast({ title: "请选择配件型号", variant: "destructive" });
      return;
    }
    if (source === "new" && !newName.trim()) {
      toast({ title: "请填写新配件型号名称", variant: "destructive" });
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast({ title: "加购数量必须为正整数", variant: "destructive" });
      return;
    }
    if (unitPrice.trim() !== "" && (Number.isNaN(Number(unitPrice)) || Number(unitPrice) < 0)) {
      toast({ title: "单价格式不正确", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "请填写申请原由", variant: "destructive" });
      return;
    }

    const price = unitPrice.trim() === "" ? undefined : Number(unitPrice);
    const payload = {
      componentCategoryId: Number(categoryId),
      ...(source === "existing"
        ? { modelId: Number(modelId) }
        : { newModelName: newName.trim(), brand: brand.trim() || "" }),
      quantity: qty,
      ...(price !== undefined ? { unitPrice: price } : {}),
      reason: reason.trim(),
    };

    setSubmitting(true);
    const result = await submitApprovalRequest({
      title: `加购配件：${source === "existing" ? "现有型号" : newName.trim()}`,
      businessType: "ASSET_PURCHASE",
      payload,
    });
    setSubmitting(false);

    if (result.success) {
      toast({ title: "提交成功", description: result.data.requestNo });
      router.push(`/approvals/${result.data.id}`);
    } else {
      toast({ title: "提交失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="加购配件"
        description="申请加购配件，提交后按对应审批流程逐级审批，通过后自动入库并生成采购留痕"
      />
      <div className="mx-auto w-full max-w-3xl">
        <Card className="overflow-hidden border-border shadow-none">
          <div className="h-1 bg-primary/80" />
          <CardContent className="p-0">
            <div className="px-6 py-6 sm:px-8">
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="req text-sm font-medium text-foreground">配件分类</Label>
                  <SearchableSelect
                    options={catOptions}
                    value={categoryId}
                    onValueChange={(v) => {
                      setCategoryId(v);
                      setCategoryBrand("__all__");
                      setModelId("");
                    }}
                    placeholder="请选择配件分类"
                    searchPlaceholder="搜索配件分类"
                    emptyText="暂无配件分类"
                    ariaLabel="选择配件分类"
                    triggerClassName="w-full"
                  />
                </div>

                {source === "existing" && categoryId && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-foreground">品牌筛选</Label>
                    <SearchableSelect
                      options={[
                        { value: "__all__", label: "全部品牌" },
                        ...brandOptions.map((b) => ({ value: b, label: b })),
                      ]}
                      value={categoryBrand}
                      onValueChange={(v) => {
                        setCategoryBrand(v || "__all__");
                        setModelId("");
                      }}
                      placeholder="全部品牌"
                      searchPlaceholder="搜索品牌"
                      emptyText="暂无品牌"
                      ariaLabel="选择品牌"
                      triggerClassName="w-full"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="req text-sm font-medium text-foreground">加购对象</Label>
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { key: "existing", label: "现有型号" },
                        { key: "new", label: "全新配件" },
                      ] as const
                    ).map((o) => (
                      <Button
                        key={o.key}
                        type="button"
                        variant={source === o.key ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setSource(o.key);
                          setModelId("");
                        }}
                        className="normal-case"
                      >
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {source === "existing" ? (
                  <div className="space-y-1.5">
                    <Label className="req text-sm font-medium text-foreground">配件型号</Label>
                    <SearchableSelect
                      options={modelOptions}
                      value={modelId}
                      onValueChange={setModelId}
                      placeholder={categoryId ? "请选择配件型号" : "请先选择配件分类"}
                      searchPlaceholder="搜索型号或品牌"
                      emptyText={categoryId ? "该分类暂无型号" : "请先选择配件分类"}
                      ariaLabel="选择配件型号"
                      triggerClassName="w-full"
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="req text-sm font-medium text-foreground">
                        新配件型号
                      </Label>
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="如：DDR5-32G（通过后登记为该型号并入库）"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-foreground">品牌</Label>
                      <Input
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        placeholder="如：金士顿（可空缺）"
                      />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="req text-sm font-medium text-foreground">加购数量</Label>
                    <Input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="如：10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-foreground">单价（元）</Label>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      placeholder="可空缺"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pr-reason" className="req text-sm font-medium text-foreground">
                    申请原由
                  </Label>
                  <Textarea
                    id="pr-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="说明加购原因（如库存不足、备件补充），便于审批人核验"
                    rows={3}
                  />
                </div>
              </div>

              <div className="mt-7 flex w-full flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {submitting ? "正在提交，请稍候…" : "提交后将进入加购审批流程"}
                </p>
                <Button onClick={handleSubmit} disabled={submitting} className="min-w-[7rem]">
                  {submitting ? "提交中..." : "提交申请"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}