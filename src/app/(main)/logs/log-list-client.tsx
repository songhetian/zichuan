"use client";

import { useState, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/features/page-header";
import { FilterBar } from "@/components/features/filter-bar";
import { DataTable } from "@/components/features/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
}

interface LifecycleLog {
  id: number;
  action: string;
  assetNo: string | null;
  operator: string;
  employeeName: string | null;
  remark: string | null;
  createdAt: Date;
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
  return "assetNo" in log;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前`;
  const years = Math.floor(months / 12);
  return `${years}年前`;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

export const lifecycleColumns: ColumnDef<LifecycleLog>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    size: 120,
    cell: ({ row }) => {
      const date = new Date(row.original.createdAt);
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default text-sm whitespace-nowrap">
              {formatRelativeTime(date)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
          </TooltipContent>
        </Tooltip>
      );
    },
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
    id: "employeeName",
    header: "人员",
    size: 100,
    cell: ({ row }) => (
      <span className="text-sm">{row.original.employeeName ?? "-"}</span>
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

/** 系统日志列：详情列支持点击查看全文（内容不截断丢失） */
function makeSystemColumns(
  onViewDetail: (detail: string) => void
): ColumnDef<SystemLog>[] {
  return [
    {
      accessorKey: "createdAt",
      header: "时间",
      size: 120,
      cell: ({ row }) => {
        const date = new Date(row.original.createdAt);
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-sm whitespace-nowrap">
                {formatRelativeTime(date)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </TooltipContent>
          </Tooltip>
        );
      },
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
      accessorKey: "detail",
      header: "详情",
      size: 260,
      cell: ({ row }) => {
        const detail = row.original.detail;
        if (!detail) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          // 点击弹出完整详情（单元格内截断显示，框内显全，绝不占邻列）
          <button
            type="button"
            onClick={() => onViewDetail(detail)}
            title="点击查看完整详情"
            className="inline-block w-full max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left text-sm text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
          >
            {detail}
          </button>
        );
      },
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
}

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
  // 系统日志详情全文弹出框
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);

  // ---- derived module options (system logs only) ----
  const moduleOptions = useMemo(() => {
    const modules = new Set<string>();
    initialLogs.forEach((log) => modules.add(log.module));
    return Array.from(modules).sort();
  }, [initialLogs]);

  // ---- system columns (详情列需访问组件内 state) ----
  const systemColumns = useMemo(
    () => makeSystemColumns(setSelectedDetail),
    []
  );

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
          const matchEmployee = log.employeeName?.toLowerCase().includes(kw);
          if (!matchAssetNo && !matchOp && !matchRemark && !matchEmployee)
            return false;
        } else {
          const matchModule = log.module.toLowerCase().includes(kw);
          const matchAction = log.action.toLowerCase().includes(kw);
          const matchDetail = log.detail.toLowerCase().includes(kw);
          const matchOp = log.operator.toLowerCase().includes(kw);
          if (!matchModule && !matchAction && !matchDetail && !matchOp)
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
              : "搜索编号、操作人或备注..."
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

        {/* ---- 系统日志详情全文弹出框 ---- */}
        <Dialog open={!!selectedDetail} onOpenChange={(o) => !o && setSelectedDetail(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>操作详情</DialogTitle>
              <DialogDescription>该条系统操作的完整详情内容</DialogDescription>
            </DialogHeader>
            {selectedDetail && (
              <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/80 bg-muted/20 p-4 text-sm leading-relaxed text-foreground">
                {selectedDetail}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
  );
}