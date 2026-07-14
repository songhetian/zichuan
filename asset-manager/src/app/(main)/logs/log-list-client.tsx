"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LogItem {
  id: number;
  module: string;
  action: string;
  detail: string;
  operator: string;
  createdAt: Date;
}

interface LogListClientProps {
  logs: LogItem[];
  currentModule: string;
}

const columns: ColumnDef<LogItem>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString("zh-CN"),
  },
  { accessorKey: "module", header: "模块" },
  { accessorKey: "action", header: "动作" },
  {
    accessorKey: "detail",
    header: "详情",
    cell: ({ row }) => (
      <span className="max-w-[300px] truncate block">{row.original.detail}</span>
    ),
  },
  { accessorKey: "operator", header: "操作员" },
];

export function LogListClient({ logs, currentModule }: LogListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleModuleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set("module", value);
    } else {
      params.delete("module");
    }
    router.push(`/logs?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="系统日志"
        description="查看系统操作记录"
        action={
          <Select value={currentModule || "all"} onValueChange={handleModuleChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="模块筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              <SelectItem value="分配">分配</SelectItem>
              <SelectItem value="归还">归还</SelectItem>
              <SelectItem value="调拨">调拨</SelectItem>
              <SelectItem value="报废">报废</SelectItem>
              <SelectItem value="送修">送修</SelectItem>
              <SelectItem value="维修完成">维修完成</SelectItem>
              <SelectItem value="入库">入库</SelectItem>
              <SelectItem value="升级">升级</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <DataTable columns={columns} data={logs} />
    </div>
  );
}
