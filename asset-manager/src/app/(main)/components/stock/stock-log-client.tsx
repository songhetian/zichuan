"use client";

import { PageHeader } from "@/components/features/page-header";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";

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

interface StockLogClientProps {
  logs: StockLogItem[];
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

export function StockLogClient({ logs }: StockLogClientProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="库存流水"
        description="配件库存的出入库记录"
      />
      <DataTable columns={columns} data={logs} />
    </div>
  );
}