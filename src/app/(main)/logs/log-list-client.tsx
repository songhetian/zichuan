"use client";

import { useState, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/features/page-header";
import { FilterBar } from "@/components/features/filter-bar";
import { DataTable } from "@/components/features/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check } from "lucide-react";
import { moduleLabel } from "@/lib/system-log-labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemLog {
  id: number;
  module: string;
  action: string;
  detail: string;
  operator: string;
  createdAt: Date;
  /** 由详情文本还原的设备编号 */
  assetNo?: string | null;
}

interface LifecycleLog {
  id: number;
  action: string;
  assetNo: string | null;
  operator: string;
  remark: string | null;
  createdAt: Date;
  employeeName?: string | null;
  fromEmployeeName?: string | null;
}

interface LogListClientProps {
  initialLogs: SystemLog[];
  initialLifecycleLogs: LifecycleLog[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_LABEL_MAP: Record<string, string> = {
  CREATED: "创建",
  ALLOCATED: "分配",
  RETURNED: "归还",
  TRANSFERRED: "调拨",
  UPGRADED: "升级",
  SCRAPPED: "报废",
  MAINTENANCE_START: "送修",
  MAINTENANCE_DONE: "维修完成",
};

const ACTION_OPTIONS = [
  { value: "all", label: "全部动作" },
  { value: "CREATED", label: "创建" },
  { value: "ALLOCATED", label: "分配" },
  { value: "RETURNED", label: "归还" },
  { value: "TRANSFERRED", label: "调拨" },
  { value: "UPGRADED", label: "升级" },
  { value: "SCRAPPED", label: "报废" },
  { value: "MAINTENANCE_START", label: "送修" },
  { value: "MAINTENANCE_DONE", label: "维修完成" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLifecycleLog(log: SystemLog | LifecycleLog): log is LifecycleLog {
  // 注意：SystemLog 也有 assetNo 字段（由详情文本还原），不能用 assetNo 区分；
  // remark 只有 LifecycleLog 才有，作为判别键。
  return "remark" in log;
}

/** 绝对时间：2026-08-05 16:35:24 */
function formatDateTime(date: Date): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 生命周期日志「对象」列：分配/归还是姓名，调拨是「转出 → 转入」 */
function buildObjectLabel(log: LifecycleLog): string {
  if (log.action === "TRANSFERRED") {
    if (log.fromEmployeeName && log.employeeName) {
      return `${log.fromEmployeeName} → ${log.employeeName}`;
    }
    return log.employeeName ?? log.fromEmployeeName ?? "-";
  }
  return log.employeeName ?? "-";
}

/** 详情单元格：截断显示 + 悬浮看全文 + 点击弹窗可复制 */
function LogDetailCell({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="block max-w-[280px] cursor-pointer truncate text-sm"
            onClick={() => setOpen(true)}
          >
            {detail}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm whitespace-pre-wrap break-all">
          {detail}
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>日志详情</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 text-sm">
            {detail}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopy}>
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "已复制" : "复制"}
            </Button>
            <Button onClick={() => setOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

export const lifecycleColumns: ColumnDef<LifecycleLog>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    size: 170,
    cell: ({ row }) => (
      <span className="text-sm whitespace-nowrap">
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "action",
    header: "动作",
    size: 100,
    cell: ({ row }) => {
      const action = row.original.action;
      return (
        <Badge variant="outline">
          {ACTION_LABEL_MAP[action] ?? action}
        </Badge>
      );
    },
  },
  {
    accessorKey: "assetNo",
    header: "设备编号",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm font-mono">{row.original.assetNo ?? "-"}</span>
    ),
  },
  {
    id: "object",
    header: "对象",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm">{buildObjectLabel(row.original)}</span>
    ),
  },
  {
    accessorKey: "remark",
    header: "备注",
    size: 240,
    cell: ({ row }) => (
      <span className="text-sm max-w-[300px] truncate block">
        {row.original.remark ?? "-"}
      </span>
    ),
  },
  {
    accessorKey: "operator",
    header: "操作人",
    size: 100,
    cell: ({ row }) => (
      <span className="text-sm">{row.original.operator}</span>
    ),
  },
];

export const systemColumns: ColumnDef<SystemLog>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    size: 170,
    cell: ({ row }) => (
      <span className="text-sm whitespace-nowrap">
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "module",
    header: "模块",
    size: 100,
    cell: ({ row }) => (
      <Badge variant="secondary">{moduleLabel(row.original.module)}</Badge>
    ),
  },
  {
    accessorKey: "action",
    header: "动作",
    size: 100,
    cell: ({ row }) => (
      <Badge variant="outline">
        {ACTION_LABEL_MAP[row.original.action] ?? row.original.action}
      </Badge>
    ),
  },
  {
    accessorKey: "assetNo",
    header: "设备编号",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm font-mono">{row.original.assetNo ?? "-"}</span>
    ),
  },
  {
    accessorKey: "detail",
    header: "详情",
    size: 260,
    cell: ({ row }) => <LogDetailCell detail={row.original.detail} />,
  },
  {
    accessorKey: "operator",
    header: "操作员",
    size: 100,
    cell: ({ row }) => (
      <span className="text-sm">{row.original.operator}</span>
    ),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogListClient({
  initialLogs,
  initialLifecycleLogs,
}: LogListClientProps) {
  const [type, setType] = useState<"system" | "lifecycle">("system");
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");

  // ---- derived module options (system logs only) ----
  const moduleOptions = useMemo(() => {
    const modules = new Set<string>();
    initialLogs.forEach((log) => modules.add(log.module));
    return Array.from(modules).sort();
  }, [initialLogs]);

  // ---- filtered data ----
  const filteredLogs = useMemo(() => {
    const source = type === "system" ? initialLogs : initialLifecycleLogs;

    return source.filter((log) => {
      // module filter (system only)
      if (type === "system" && moduleFilter) {
        if ("module" in log && log.module !== moduleFilter) return false;
      }

      // action filter (lifecycle only)
      if (type === "lifecycle" && actionFilter && actionFilter !== "all") {
        if (log.action !== actionFilter) return false;
      }

      // operator filter
      if (operatorFilter) {
        if (
          !log.operator
            .toLowerCase()
            .includes(operatorFilter.toLowerCase())
        )
          return false;
      }

      // keyword filter
      if (keywordFilter) {
        const kw = keywordFilter.toLowerCase();
        if (isLifecycleLog(log)) {
          const matchAssetNo = log.assetNo?.toLowerCase().includes(kw);
          const matchOp = log.operator.toLowerCase().includes(kw);
          const matchRemark = log.remark?.toLowerCase().includes(kw);
          const matchEmployee =
            log.employeeName?.toLowerCase().includes(kw) ||
            log.fromEmployeeName?.toLowerCase().includes(kw);
          if (!matchAssetNo && !matchOp && !matchRemark && !matchEmployee)
            return false;
        } else {
          const matchModule = log.module.toLowerCase().includes(kw);
          const matchAction = log.action.toLowerCase().includes(kw);
          const matchDetail = log.detail.toLowerCase().includes(kw);
          const matchOp = log.operator.toLowerCase().includes(kw);
          const matchAssetNo = log.assetNo?.toLowerCase().includes(kw);
          if (
            !matchModule &&
            !matchAction &&
            !matchDetail &&
            !matchOp &&
            !matchAssetNo
          )
            return false;
        }
      }

      return true;
    });
  }, [
    type,
    initialLogs,
    initialLifecycleLogs,
    moduleFilter,
    actionFilter,
    operatorFilter,
    keywordFilter,
  ]);

  return (
    <div className="space-y-4">
        {/* ---- Page header ---- */}
        <PageHeader
          title={type === "lifecycle" ? "设备日志" : "系统日志"}
          description={
            type === "lifecycle"
              ? "查看设备生命周期操作记录"
              : "查看系统操作记录"
          }
        />

        {/* ---- Type switch ---- */}
        <div className="flex items-center gap-2">
          <Button
            variant={type === "system" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setType("system");
              setModuleFilter("");
              setActionFilter("all");
            }}
          >
            系统日志
          </Button>
          <Button
            variant={type === "lifecycle" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setType("lifecycle");
              setModuleFilter("");
              setActionFilter("all");
            }}
          >
            设备日志
          </Button>
        </div>

        {/* ---- Filter bar ---- */}
        <FilterBar
          items={[
            /* System: module filter */
            ...(type === "system"
              ? [
                  {
                    key: "module",
                    content: (
                      <Select
                        value={moduleFilter || "all"}
                        onValueChange={(v) => setModuleFilter(v === "all" ? "" : v)}
                      >
                        <SelectTrigger className="h-9 w-[160px]">
                          <SelectValue placeholder="全部模块" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部模块</SelectItem>
                          {moduleOptions.map((mod) => (
                            <SelectItem key={mod} value={mod}>
                              {moduleLabel(mod)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ),
                  },
                ]
              : []),
            /* Lifecycle: action filter */
            ...(type === "lifecycle"
              ? [
                  {
                    key: "action",
                    content: (
                      <Select value={actionFilter} onValueChange={setActionFilter}>
                        <SelectTrigger className="h-9 w-[140px]">
                          <SelectValue placeholder="全部动作" />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ),
                  },
                ]
              : []),
            /* Operator filter */
            {
              key: "operator",
              content: (
                <Input
                  placeholder="操作人..."
                  value={operatorFilter}
                  onChange={(e) => setOperatorFilter(e.target.value)}
                  className="w-32"
                />
              ),
            },
          ]}
          searchValue={keywordFilter}
          searchPlaceholder={
            type === "system"
              ? "搜索模块、动作、详情或操作员..."
              : "搜索编号、对象、操作人或备注..."
          }
          onSearchChange={setKeywordFilter}
          showReset
          onReset={() => {
            setModuleFilter("");
            setActionFilter("all");
            setOperatorFilter("");
            setKeywordFilter("");
          }}
        />

        {/* ---- Data table ---- */}
        {type === "system" ? (
          <DataTable columns={systemColumns} data={filteredLogs as SystemLog[]} />
        ) : (
          <DataTable
            columns={lifecycleColumns}
            data={filteredLogs as LifecycleLog[]}
          />
        )}
      </div>
  );
}