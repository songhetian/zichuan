"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Search, RotateCcw, Download } from "lucide-react";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PagePagination } from "@/components/ui/page-pagination";
import { formatTime } from "@/lib/utils";

type PurchaseRecordItem = {
  id: number;
  orderNo: string;
  requestNo: string;
  modelName: string;
  categoryName: string;
  quantity: number;
  unitPrice: string | null;
  amount: string | null;
  initiatorName: string;
  createdAt: Date | string;
};

type CategoryOption = { id: number; name: string };

const ALL = "__all__";

const PAGE_SIZE = 10;

export function PurchaseRecordsClient({
  initialItems,
  categories = [],
}: {
  initialItems: PurchaseRecordItem[];
  categories: CategoryOption[];
}) {
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  const runSearch = () => {
    setAppliedKeyword(keyword.trim());
    setPage(1);
  };

  const reset = () => {
    setKeyword("");
    setAppliedKeyword("");
    setCategory(ALL);
    setPage(1);
  };

  const columns: ColumnDef<PurchaseRecordItem>[] = useMemo(
    () => [
      {
        accessorKey: "orderNo",
        header: "采购单号",
        cell: ({ row }) => (
          <span className="font-mono text-sm whitespace-nowrap">{row.original.orderNo}</span>
        ),
      },
      {
        accessorKey: "requestNo",
        header: "申请单号",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
            {row.original.requestNo}
          </span>
        ),
      },
      {
        accessorKey: "modelName",
        header: "配件名称",
        cell: ({ row }) => <span className="text-sm font-medium">{row.original.modelName}</span>,
      },
      {
        accessorKey: "categoryName",
        header: "分类",
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.categoryName}</Badge>
        ),
      },
      {
        accessorKey: "quantity",
        header: "数量",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.quantity}</span>
        ),
      },
      {
        accessorKey: "unitPrice",
        header: "单价",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.unitPrice ? `¥${row.original.unitPrice}` : "-"}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: "金额",
        cell: ({ row }) => (
          <span className="text-sm font-medium tabular-nums">
            {row.original.amount ? `¥${row.original.amount}` : "-"}
          </span>
        ),
      },
      {
        accessorKey: "initiatorName",
        header: "发起人",
        cell: ({ row }) => <span className="text-sm">{row.original.initiatorName}</span>,
      },
      {
        accessorKey: "createdAt",
        header: "入库时间",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
            {formatTime(row.original.createdAt)}
          </span>
        ),
      },
    ],
    []
  );

  const filtered = useMemo(() => {
    const kw = appliedKeyword.toLowerCase();
    return initialItems.filter((item) => {
      if (category !== ALL && item.categoryName !== category) return false;
      if (!kw) return true;
      return (
        item.modelName.toLowerCase().includes(kw) ||
        item.orderNo.toLowerCase().includes(kw) ||
        item.requestNo.toLowerCase().includes(kw)
      );
    });
  }, [initialItems, appliedKeyword, category]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleExport = () => {
    const esc = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "采购单号",
      "申请单号",
      "配件名称",
      "分类",
      "数量",
      "单价",
      "金额",
      "发起人",
      "入库时间",
    ];
    const rows = filtered.map((r) => [
      r.orderNo,
      r.requestNo,
      r.modelName,
      r.categoryName,
      r.quantity,
      r.unitPrice ?? "",
      r.amount ?? "",
      r.initiatorName,
      formatTime(r.createdAt),
    ]);
    const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `采购留痕_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="采购留痕"
        description="加购申请终审通过并自动入库后生成的采购对账记录"
        action={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            导出 CSV
          </Button>
        }
      />

      {/* 筛选区：关键字 + 分类 + 操作，紧凑单行 */}
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <div className="min-w-[200px] max-w-sm flex-1">
          <Label className="mb-1.5 block text-xs text-muted-foreground">关键字</Label>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="配件名称 / 采购单号 / 申请单号"
            className="h-9"
          />
        </div>
        <div className="w-[180px]">
          <Label className="mb-1.5 block text-xs text-muted-foreground">分类</Label>
          <SearchableSelect
            value={category}
            onValueChange={(v) => {
              setCategory(v || ALL);
              setPage(1);
            }}
            placeholder="全部分类"
            triggerClassName="w-[180px] h-9"
            options={[
              { value: ALL, label: "全部分类" },
              ...categories.map((c) => ({ value: c.name, label: c.name })),
            ]}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" className="h-9">
            <Search className="mr-1.5 h-4 w-4" />
            查询
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={reset}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            重置
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-border/60 bg-card">
        <DataTable columns={columns} data={pageItems} />
        <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            共 <span className="font-medium text-foreground">{total}</span> 条采购记录
          </span>
          <PagePagination
            current={safePage}
            total={totalPages}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      </div>
    </div>
  );
}