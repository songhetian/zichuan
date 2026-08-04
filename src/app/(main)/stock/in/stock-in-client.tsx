"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { batchCreateAssets } from "@/actions/asset.actions";

interface TemplateComponent {
  modelId: number;
  modelName: string;
  modelBrand: string | null;
  quantity: number;
}

interface StockInClientProps {
  templates: { id: number; name: string; components: TemplateComponent[] }[];
}

export function StockInClient({ templates }: StockInClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState<string>("");
  const [count, setCount] = useState<string>("1");
  const [loading, setLoading] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === parseInt(templateId, 10));

  const handleSubmit = async () => {
    const tid = parseInt(templateId, 10);
    const cnt = parseInt(count, 10);

    if (!tid || isNaN(tid)) {
      toast({ title: "请选择设备模板", variant: "destructive" });
      return;
    }
    if (!cnt || cnt < 1) {
      toast({ title: "数量至少为 1", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const result = await batchCreateAssets({
        templateId: tid,
        count: cnt,
        operator: "admin",
      });

      if (result.success) {
        const assets = result.data;
        toast({
          title: "入库成功",
          description: `已生成 ${assets.length} 台设备，编号：${assets[0]?.assetNo} ~ ${assets[assets.length - 1]?.assetNo}`,
        });
        // 跳转到设备列表，筛选库存状态
        router.push("/assets?status=IN_STOCK");
      } else {
        toast({ title: result.error || "入库失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">批量入库</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template">设备模板</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="template">
                <SelectValue placeholder="请选择设备模板" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Label htmlFor="count">入库数量</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="请输入入库数量"
            />
            <p className="text-xs text-muted-foreground">
              一次性批量生成设备，状态为"库存"，不扣减配件库存
            </p>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={loading || !templateId}
            className="w-full"
          >
            {loading ? "正在入库..." : "确认入库"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}