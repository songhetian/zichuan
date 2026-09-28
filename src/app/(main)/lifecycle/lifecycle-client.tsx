"use client";

import { useEffect, useRef, useState } from "react";
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
import { useRouter } from "next/navigation";

interface AssetLifecycleClientProps {
  initial: AssetLifecycleViewData;
}

type FilterOption = { value: string; label: string };

/** 关联申请单信息（弹出框展示，含审批节点） */
type ReqInfo = {
  id: number;
  businessType: string;
  title: string;
  initiatorName: string;
  status: string;
  submittedAt: string | Date;
  finishedAt: string | Date | null;
  currentNodeName: string | null;
  requestNo: string;
  tasks: {
    nodeName: string;
    assigneeName: string;
    status: string;
    comment: string | null;
    actedAt: string | Date | null;
  }[];
};

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

/** 生命周期操作 → 彩色标签（不同操作类型用不同颜色区分，弱化单调感） */
const ACTION_BADGE_MAP: Record<string, { label: string; className: string }> = {
  CREATED: { label: "创建", className: "bg-slate-100/80 text-slate-600 border-slate-300/60" },
  ALLOCATED: { label: "分配", className: "bg-blue-100/80 text-blue-700 border-blue-300/60" },
  RETURNED: { label: "归还", className: "bg-emerald-100/80 text-emerald-700 border-emerald-300/60" },
  TRANSFERRED: { label: "调拨", className: "bg-indigo-100/80 text-indigo-700 border-indigo-300/60" },
  UPGRADED: { label: "升级", className: "bg-violet-100/80 text-violet-700 border-violet-300/60" },
  DOWNGRADED: { label: "降级", className: "bg-zinc-100/80 text-zinc-600 border-zinc-300/60" },
  SCRAPPED: { label: "报废", className: "bg-red-100/80 text-red-700 border-red-300/60" },
  REPLACED: { label: "更换回收", className: "bg-orange-100/80 text-orange-700 border-orange-300/60" },
  MAINTENANCE_START: { label: "送修", className: "bg-amber-100/80 text-amber-700 border-amber-300/60" },
  MAINTENANCE_DONE: { label: "维修完成", className: "bg-green-100/80 text-green-700 border-green-300/60" },
};

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

/** 审批节点任务状态 → 展示文案 */
function taskStatusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: "待审批",
    APPROVED: "已通过",
    REJECTED: "已驳回",
    SKIPPED: "已跳过",
  };
  return map[status] ?? status;
}

/** 审批流程时间轴的节点状态 */
type FlowTone = "start" | "ok" | "fail" | "wait" | "end";

/** 时间轴上每个圆点的配色 */
function flowDot(tone: FlowTone): string {
  switch (tone) {
    case "start":
      return "border-primary bg-primary-foreground ring-primary/20";
    case "ok":
      return "border-emerald-500 bg-emerald-50 ring-emerald-500/20";
    case "fail":
      return "border-red-500 bg-red-50 ring-red-500/20";
    case "end":
      return "border-primary bg-primary ring-primary/20";
    default:
      return "border-amber-400 bg-amber-50 ring-amber-400/20";
  }
}

/** 审批流程步骤数据 */
type FlowStepData = {
  tone: FlowTone;
  title: string;
  by?: string;
  time?: string | Date | null;
  comment?: string | null;
  isLast?: boolean;
};

/** 审批流程中的一个时间步骤（提交 / 各节点 / 终态） */
function FlowStep({ tone, title, by, time, comment, isLast }: FlowStepData) {
  return (
    <li className="relative flex gap-3">
      <div className="relative flex flex-col items-center">
        <span className={`z-10 mt-2 h-3 w-3 rounded-full border-[3px] ${flowDot(tone)}`} />
        {!isLast && (
          <span className="absolute top-6 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border" />
        )}
      </div>
      <div
        className={`mb-1 min-w-0 flex-1 rounded-md border px-3 py-2.5 ${
          isLast ? "border-primary/30 bg-primary/[0.03]" : "border-border/70 bg-card"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <span className="truncate">{title}</span>
            {by && (
              <span className="shrink-0 text-xs font-normal text-muted-foreground">· {by}</span>
            )}
          </p>
          {time && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatTime(time)}
            </span>
          )}
        </div>
        {comment && (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {comment}
          </p>
        )}
      </div>
    </li>
  );
}

/** 关联申请弹框 → 审批流程时间轴的节点集 */
function buildFlowSteps(req: ReqInfo) {
  const steps: FlowStepData[] = [
    {
      tone: "start",
      title: "提交申请",
      by: req.initiatorName,
      time: req.submittedAt,
    },
    ...req.tasks.map((t) => ({
      tone: (t.status === "APPROVED"
        ? "ok"
        : t.status === "REJECTED"
          ? "fail"
          : "wait") as FlowTone,
      title: t.nodeName,
      by: t.assigneeName,
      time: t.actedAt,
      comment: t.comment,
    })),
  ];
  // 终态节点：按申请单状态给出结论
  const finalTone: FlowTone =
    req.status === "REJECTED" || req.status === "CANCELLED" ? "fail" : "end";
  steps.push({
    tone: finalTone,
    title: requestStatusLabel(req.status),
    time: req.status === "PENDING" ? null : req.finishedAt,
    comment:
      req.status === "PENDING" && req.currentNodeName
        ? `等待「${req.currentNodeName}」处理`
        : undefined,
    isLast: true,
  });
  return steps;
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
    cell: ({ row }) => {
      const cfg = ACTION_BADGE_MAP[row.original.action] ?? {
        label: actionLabel(row.original.action),
        className: "bg-slate-100/80 text-slate-600 border-slate-300/60",
      };
      return <Badge className={`whitespace-nowrap border ${cfg.className}`}>{cfg.label}</Badge>;
    },
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
];

export function AssetLifecycleClient({ initial }: AssetLifecycleClientProps) {
  const { toast } = useToast();
  const router = useRouter();
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

  // 完整备注弹出框：点击备注单元格打开
  const [selectedRemark, setSelectedRemark] = useState<string | null>(null);

  // 在模块级列基础上追加「关联申请」操作列（按钮需访问组件内 setSelectedReq）
  const columns: ColumnDef<LifecycleViewRow>[] = [
    ...lifecycleViewColumns,
    {
      id: "remark",
      header: "备注",
      size: 180,
      cell: ({ row }) => {
        const remark = row.original.remark;
        if (!remark) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          // 点击弹出完整备注（内容多时按单元格宽度截断，框内显全，绝不占邻列）
          <button
            type="button"
            onClick={() => setSelectedRemark(remark)}
            title="点击查看完整备注"
            className="inline-block w-full max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left text-sm text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
          >
            {remark}
          </button>
        );
      },
    },
    {
      id: "view",
      header: "关联申请",
      size: 110,
      cell: ({ row }) => {
        const req = row.original.request;
        if (!req) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          <Button
            type="button"
            variant="ghost"
            className="h-7 px-2.5 text-primary hover:bg-primary/5 hover:text-primary"
            onClick={() => setSelectedReq(req)}
          >
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
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
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

  // 防抖：筛选条件变化后 400ms 自动查询（回到第一页），替代原来需手动点击的「查询」按钮
  // 每次渲染同步最新的 handleQuery，保证定时器回调取到最新的筛选值
  const handleQueryRef = useRef<typeof handleQuery>(handleQuery);
  useEffect(() => {
    handleQueryRef.current = handleQuery;
  });

  // 首次挂载不查询（直接展示 initial 数据），仅当筛选条件发生变化才触发
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      handleQueryRef.current(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [departmentId, employeeId, dateFrom, dateTo, action, keyword]);

  return (
    <div className="space-y-4 pb-6">
      <PageHeader
        title="设备生命周期"
        description="记录每台设备详细的生命周期与操作方式，可按部门、人员、时间段、操作类型查看。"
      />

      {/* ---- 筛选区（条件变化自动防抖查询） ---- */}
      <div className="rounded-lg border border-border/80 bg-card p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">资产关键字</Label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="编号 / 名称"
              className="h-9"
            />
          </div>
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>关联申请</DialogTitle>
            <DialogDescription>该条设备操作对应的审批申请单</DialogDescription>
          </DialogHeader>
          {selectedReq && (
            <div className="space-y-4 text-sm">
              {/* 头部：单号 + 状态徽标 */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug">{selectedReq.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {selectedReq.requestNo}
                  </p>
                </div>
                <Badge
                  variant={
                    selectedReq.status === "REJECTED"
                      ? "destructive"
                      : selectedReq.status === "PENDING"
                        ? "default"
                        : "outline"
                  }
                  className="shrink-0"
                >
                  {requestStatusLabel(selectedReq.status)}
                </Badge>
              </div>

              {/* 元信息条 */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">业务类型</dt>
                  <dd className="mt-0.5 font-medium">
                    {businessTypeLabel(selectedReq.businessType)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">申请状态</dt>
                  <dd className="mt-0.5 font-medium">{requestStatusLabel(selectedReq.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">发起时间</dt>
                  <dd className="mt-0.5 font-medium">{formatTime(selectedReq.submittedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">完成时间</dt>
                  <dd className="mt-0.5 font-medium">
                    {selectedReq.finishedAt ? formatTime(selectedReq.finishedAt) : "-"}
                  </dd>
                </div>
              </dl>

              {/* 审批流程时间轴 */}
              <div>
                <p className="mb-2.5 text-sm font-semibold">审批流程</p>
                {selectedReq.tasks.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">该申请单暂未进入审批流转</p>
                ) : (
                  <ol className="space-y-0">
                    {buildFlowSteps(selectedReq).map((step, index) => (
                      <FlowStep
                        key={index}
                        tone={step.tone}
                        title={step.title}
                        by={step.by}
                        time={step.time}
                        comment={step.comment}
                        isLast={step.isLast}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                由审批通过后自动执行的设备操作
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => selectedReq && router.push(`/approvals/${selectedReq.id}`)}
                disabled={!selectedReq}
              >
                查看完整申请
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 完整备注弹出框 ---- */}
      <Dialog open={!!selectedRemark} onOpenChange={(o) => !o && setSelectedRemark(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>备注</DialogTitle>
            <DialogDescription>该条设备操作的完整备注内容</DialogDescription>
          </DialogHeader>
          {selectedRemark && (
            <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/80 bg-muted/20 p-4 text-sm leading-relaxed text-foreground">
              {selectedRemark}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}