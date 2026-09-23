"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PagePagination } from "@/components/ui/page-pagination";
import { formatTime } from "@/lib/utils";
import { ASSET_STATUS_LABEL_MAP } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getAssetLifecycleView,
  type LifecycleViewRow,
  type AssetLifecycleViewData,
} from "@/actions/asset-lifecycle.actions";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search } from "lucide-react";

interface AssetLifecycleClientProps {
  initial: AssetLifecycleViewData;
}

type FilterOption = { value: string; label: string };

/** 关联申请单信息（弹出框展示） */
type ReqInfo = { requestNo: string; businessType: string; title: string; status: string };

/** 申请单业务类型 → 中文标签（弹出框内展示） */
function businessTypeLabel(businessType: string): string {
  const map: Record<string, string> = {
    ASSET_UPGRADE: "升级配件",
    ASSET_SCRAP: "资产报废",
    ASSET_RETURN: "设备退回",
    ASSET_REPLACE: "更换设备",
    ASSET_REPAIR: "设备维修",
    ASSET_DEPART: "员工离职",
  };
  return map[businessType] ?? businessType;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATED: "创建",
    ALLOCATED: "分配",
    RETURNED: "归还",
    TRANSFERRED: "调拨",
    UPGRADED: "升级",
    DOWNGRADED: "降级",
    MAINTENANCE_START: "送修",
    MAINTENANCE_DONE: "维修完成",
    SCRAPPED: "报废",
    REPLACED: "更换回收",
  };
  return map[action] ?? action;
}

function statusLabel(status: string | null): string {
  if (!status) return "-";
  return ASSET_STATUS_LABEL_MAP[status] ?? status;
}

/** 申请单状态 → 展示文案 */
function requestStatusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: "待审批",
    APPROVED: "已通过",
    REJECTED: "已驳回",
    EXECUTED: "已执行",
  };
  return map[status] ?? status;
}

export const lifecycleViewColumns: ColumnDef<LifecycleViewRow>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    size: 140,
    cell: ({ row }) => (
      <span className="text-sm whitespace-nowrap tabular-nums">
        {formatTime(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "assetNo",
    header: "设备编号",
    size: 140,
    cell: ({ row }) => (
      <span className="text-sm font-mono whitespace-nowrap">{row.original.assetNo ?? "-"}</span>
    ),
  },
  {
    accessorKey: "assetName",
    header: "设备名称",
    size: 160,
    cell: ({ row }) => (
      <span className="text-sm block truncate max-w-[220px]">{row.original.assetName ?? "-"}</span>
    ),
  },
  {
    accessorKey: "action",
    header: "操作",
    size: 110,
    cell: ({ row }) => <Badge variant="outline">{actionLabel(row.original.action)}</Badge>,
  },
  {
    accessorKey: "fromStatus",
    header: "状态流转",
    size: 170,
    cell: ({ row }) => {
      const { fromStatus, toStatus } = row.original;
      if (!fromStatus && !toStatus) return <span className="text-sm text-muted-foreground">-</span>;
      return (
        <span className="text-sm whitespace-nowrap">
          <span className="text-muted-foreground">{statusLabel(fromStatus)}</span>
          <span className="mx-1 text-muted-foreground/50">→</span>
          <span>{statusLabel(toStatus)}</span>
        </span>
      );
    },
  },
  {
    accessorKey: "employeeName",
    header: "人员",
    size: 110,
    cell: ({ row }) => (
      <span className="text-sm whitespace-nowrap">{row.original.employeeName ?? "-"}</span>
    ),
  },
  {
    accessorKey: "departmentName",
    header: "部门",
    size: 120,
    cell: ({ row }) => (
      <span className="text-sm block truncate max-w-[160px]">{row.original.departmentName ?? "-"}</span>
    ),
  },
  {
    accessorKey: "operator",
    header: "操作方式",
    size: 120,
    cell: ({ row }) => (
      <span className="text-sm block truncate max-w-[160px]">{row.original.operator}</span>
    ),
  },
  {
    accessorKey: "remark",
    header: "备注",
    size: 200,
    cell: ({ row }) => (
      <span className="text-sm block truncate max-w-[260px]">{row.original.remark ?? "-"}</span>
    ),
  },
];

export function AssetLifecycleClient({ initial }: AssetLifecycleClientProps) {
  const { toast } = useToast();
  const DEFAULT_PAGE_SIZE = 10;
  const [rows, setRows] = useState<LifecycleViewRow[]>(initial.data);
  const [departments, setDepartments] = useState<FilterOption[]>(
    initial.departments.map((d) => ({ value: String(d.id), label: d.name }))
  );
  const [employees, setEmployees] = useState<FilterOption[]>(
    initial.employees.map((e) => ({ value: String(e.id), label: e.name }))
  );
  const [actionOptions, setActionOptions] = useState<FilterOption[]>(initial.actionOptions);

  // 筛选条件
  const [departmentId, setDepartmentId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  // 服务端分页
  const [page, setPage] = useState(initial.page ?? 1);
  const [total, setTotal] = useState<number>(initial.total ?? 0);
  const totalPage = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  // 关联申请弹出框：点击「查看」按钮打开
  const [selectedReq, setSelectedReq] = useState<ReqInfo | null>(null);

  // 在模块级列基础上追加「关联申请」操作列（按钮需访问组件内 setSelectedReq）
  const columns: ColumnDef<LifecycleViewRow>[] = [
    ...lifecycleViewColumns,
    {
      id: "view",
      header: "关联申请",
      size: 110,
      cell: ({ row }) => {
        const req = row.original.request;
        if (!req) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          <Button size="sm" variant="outline" onClick={() => setSelectedReq(req)}>
            查看
          </Button>
        );
      },
    },
  ];

  async function handleQuery(targetPage = 1) {
    setLoading(true);
    setPage(targetPage);
    try {
      const res = await getAssetLifecycleView({
        departmentId: departmentId || undefined,
        employeeId: employeeId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        actions: action ? [action as never] : [],
        keyword: keyword || undefined,
        page: targetPage,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      if (res.success) {
        setRows(res.data.data);
        setTotal(res.data.total);
        if (res.data.page) setPage(res.data.page);
        if (res.data.departments.length || departments.length === 0) {
          setDepartments(res.data.departments.map((d) => ({ value: String(d.id), label: d.name })));
        }
        setEmployees(res.data.employees.map((e) => ({ value: String(e.id), label: e.name })));
        setActionOptions(res.data.actionOptions);
      } else {
        toast({ title: "查询失败", description: res.error, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setDepartmentId("");
    setEmployeeId("");
    setDateFrom("");
    setDateTo("");
    setAction("");
    setKeyword("");
    setRows(initial.data);
    setTotal(initial.total ?? 0);
    setPage(initial.page ?? 1);
  }

  return (
    <div className="space-y-4 pb-6">
      <PageHeader
        title="设备生命周期"
        description="记录每台设备详细的生命周期与操作方式，可按部门、人员、时间段、操作类型查看。"
      />

      {/* ---- 筛选区 ---- */}
      <div className="rounded-lg border border-border/80 bg-card p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">部门</Label>
            <SearchableSelect
              options={departments}
              value={departmentId}
              onValueChange={setDepartmentId}
              placeholder="全部部门"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">人员</Label>
            <SearchableSelect
              options={employees}
              value={employeeId}
              onValueChange={setEmployeeId}
              placeholder="全部人员"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">开始时间</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">结束时间</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">操作类型</Label>
            <SearchableSelect
              options={actionOptions}
              value={action}
              onValueChange={setAction}
              placeholder="全部操作"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">资产关键字</Label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="编号 / 名称"
              className="h-9"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={() => handleQuery(1)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            查询
          </Button>
          <Button type="button" variant="ghost" onClick={handleReset}>
            重置
          </Button>
        </div>
      </div>

      {/* ---- 表格 ---- */}
      <DataTable columns={columns} data={rows} hidePagination />

      {/* ---- 服务端分页 ---- */}
      {total > DEFAULT_PAGE_SIZE && (
        <PagePagination
          current={page}
          total={totalPage}
          onPageChange={(p) => handleQuery(p)}
        />
      )}

      {/* ---- 关联申请弹出框 ---- */}
      <Dialog open={!!selectedReq} onOpenChange={(o) => !o && setSelectedReq(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>关联申请</DialogTitle>
            <DialogDescription>该条设备操作对应的审批申请单</DialogDescription>
          </DialogHeader>
          {selectedReq && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">申请编号</span>
                <span className="font-mono">{selectedReq.requestNo}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground shrink-0">申请标题</span>
                <span className="text-right truncate max-w-[260px]">{selectedReq.title}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">业务类型</span>
                <span>{businessTypeLabel(selectedReq.businessType)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">申请状态</span>
                <span className="font-medium">{requestStatusLabel(selectedReq.status)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <div className="flex w-full items-center justify-between">
              <span className="text-xs text-muted-foreground">点击「查看」展示该次操作对应的申请单</span>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}