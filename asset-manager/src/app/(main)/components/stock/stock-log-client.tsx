"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { purchaseStockIn } from "@/actions/component-stock.actions";

interface StockLogItem {
  id: number;
  modelId: number;
  modelName: string;
  type: string;
  quantity: number;
  operator: string;
  remark: string | null;
  createdAt: Date;
}

interface ComponentModel {
  id: number;
  name: string;
  brand: string | null;
}

interface StockLogClientProps {
  logs: StockLogItem[];
  componentModels?: ComponentModel[];
}

const typeMap: Record<string, string> = {
  PURCHASE_IN: "采购入库",
  UPGRADE_RETURN: "升级退回",
  ASSET_BUILD: "组装出库",
  UPGRADE_USE: "升级使用",
};

const columns: ColumnDef<StockLogItem>[] = [
  {
    accessorKey: "modelName",
    header: "配件型号",
  },
  {
    accessorKey: "type",
    header: "类型",
    cell: ({ row }) => typeMap[row.getValue("type") as string] ?? row.getValue("type"),
  },
  {
    accessorKey: "quantity",
    header: "数量",
    cell: ({ row }) => {
      const qty = row.getValue("quantity") as number;
      return (
        <span className={qty > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
          {qty > 0 ? `+${qty}` : qty}
        </span>
      );
    },
  },
  {
    accessorKey: "operator",
    header: "操作员",
  },
  {
    accessorKey: "remark",
    header: "备注",
    cell: ({ row }) => row.getValue("remark") ?? "-",
  },
  {
    accessorKey: "createdAt",
    header: "时间",
    cell: ({ row }) => {
      const date = new Date(row.getValue("createdAt"));
      return date.toLocaleString("zh-CN");
    },
  },
];

export function StockLogClient({ logs, componentModels = [] }: StockLogClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [purchaseInOpen, setPurchaseInOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePurchaseIn = async () => {
    if (!selectedModelId || !quantity) {
      toast({ title: "请填写完整信息", variant: "destructive" });
      return;
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: "数量必须为正整数", variant: "destructive" });
      return;
    }

    setLoading(true);
    const result = await purchaseStockIn({
      modelId: Number(selectedModelId),
      quantity: qty,
      operator: "admin",
      remark: remark.trim() || undefined,
    });
    setLoading(false);

    if (result.success) {
      toast({ title: "入库成功" });
      setPurchaseInOpen(false);
      setSelectedModelId("");
      setQuantity("");
      setRemark("");
      router.refresh();
    } else {
      toast({ title: "入库失败", description: result.error, variant: "destructive" });
    }
  };

  const modelOptions = componentModels.map((m) => ({
    value: m.id.toString(),
    label: m.brand ? `${m.name}（${m.brand}）` : m.name,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="库存流水"
        description="配件库存的出入库记录"
        action={
          <Button onClick={() => setPurchaseInOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            采购入库
          </Button>
        }
      />
      <DataTable columns={columns} data={logs} />

      <Dialog open={purchaseInOpen} onOpenChange={setPurchaseInOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>采购入库</DialogTitle>
            <DialogDescription>为配件型号增加库存</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>配件型号</Label>
              <SearchableSelect
                value={selectedModelId}
                onValueChange={setSelectedModelId}
                placeholder="选择配件型号"
                options={modelOptions}
                triggerClassName="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label>数量</Label>
              <Input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="入库数量"
              />
            </div>
            <div className="space-y-2">
              <Label>备注（可选）</Label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="入库备注"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseInOpen(false)}>
              取消
            </Button>
            <Button onClick={handlePurchaseIn} disabled={loading}>
              {loading ? "入库中..." : "确认入库"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}