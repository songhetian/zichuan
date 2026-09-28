"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PagePagination } from "@/components/ui/page-pagination";
import { usePermission } from "@/hooks/use-permission";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import { downloadExcelFile } from "@/lib/excel-download";
import {
  getMyHandledRecords,
  type HandledAction,
  type HandledRecord,
  type HandledRecordFilterOptions,
  type HandledRecordQuery,
} from "@/actions/approval.actions";
import { exportHandledRecordsToExcel } from "@/actions/excel.actions";

const PAGE_SIZE = 10;
const ALL = "__all__";
/** 筛选条件变化后自动查询的防抖时长（与全站一致：无需点击查询按钮） */
const DEBOUNCE_MS = 400;

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  ASSET_UPGRADE: "升级",
  ASSET_SCRAP: "报废",
  ASSET_RETURN: "退回",
  ASSET_REPLACE: "更换",
  ASSET_REPAIR: "维修",
  ASSET_DEPART: "离职",
  ASSET_PURCHASE: "加购",
};

const BUSINESS_TYPE_OPTIONS = [
  { value: ALL, label: "全部类型" },
  ...Object.entries(BUSINESS_TYPE_LABEL).map(([value, label]) => ({ value, label })),
];

const ACTION_BADGE: Record<HandledAction, { label: string; variant: "default" | "secondary" | "outline" }> = {
  APPROVE: { label: "审批通过", variant: "default" },
  REJECT: { label: "驳回", variant: "secondary" },
  EXECUTE: { label: "执行", variant: "outline" },
};

type RecordRow = Omit<HandledRecord, "lastActedAt"> & { lastActedAt: string };

export function DoneRecordsClient({
  initial,
  options,
}: {
  initial: HandledRecord[];
  options: HandledRecordFilterOptions;
}) {
  const { toast } = useToast();
  const canExport = usePermission("approval.done.export");

  const [rows, setRows] = useState<RecordRow[]>(() => serialize(initial));
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"MINE" | "ALL">("MINE");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [initiatorId, setInitiatorId] = useState("");
  const [componentCategoryId, setComponentCategoryId] = useState("");
  const [businessType, setBusinessType] = useState(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const query = useMemo<HandledRecordQuery>(
    () => ({
      mode,
      keyword: keyword.trim() || undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      initiatorId: initiatorId ? Number(initiatorId) : undefined,
      componentCategoryId: componentCategoryId ? Number(componentCategoryId) : undefined,
      businessType:
        businessType === ALL ? undefined : (businessType as HandledRecordQuery["businessType"]),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [mode, keyword, departmentId, initiatorId, componentCategoryId, businessType, dateFrom, dateTo]
  );

  const runQuery = useCallback(
    async (q: typeof query) => {
      try {
        const res = await getMyHandledRecords(q);
        if (res.success) setRows(serialize(res.data));
        else toast({ title: "查询失败", description: res.error, variant: "destructive" });
      } catch {
        toast({ title: "查询失败", description: "加载异常，请稍后重试", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  // 防抖：任一筛选条件（含模式切换）变化后 400ms 自动查询并回到第 1 页
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    setPage(1);
    setLoading(true);
    const timer = setTimeout(() => runQuery(queryRef.current), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runQuery]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportHandledRecordsToExcel(queryRef.current);
      if (res.success) {
        downloadExcelFile(res.data.fileName, res.data.buffer);
        toast({ title: "导出成功" });
      } else {
        toast({ title: "导出失败", description: res.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导出失败", description: "导出异常，请稍后重试", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnDef<RecordRow>[] = useMemo(
    () => [
      {
        accessorKey: "requestNo",
        header: "单号",
        size: 160,
        cell: ({ row }) => (
          <span className="font-mono text-sm whitespace-nowrap">{row.original.requestNo}</span>
        ),
      },
      {
        accessorKey: "businessType",
        header: "类型",
        size: 80,
        cell: ({ row }) => (
          <Badge variant="outline">
            {BUSINESS_TYPE_LABEL[row.original.businessType] ?? row.original.businessType}
          </Badge>
        ),
      },
      {
        accessorKey: "title",
        header: "标题",
        cell: ({ row }) => <span className="text-sm">{row.original.title}</span>,
      },
      {
        accessorKey: "initiatorName",
        header: "发起人",
        size: 110,
        cell: ({ row }) => <span className="text-sm">{row.original.initiatorName}</span>,
      },
      {
        accessorKey: "departmentName",
        header: "部门",
        size: 110,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.departmentName ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "componentCategoryName",
        header: "配件类型",
        size: 110,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.componentCategoryName ?? "—"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "我的动作",
        size: 170,
        meta: { align: "center" as const },
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center justify-center gap-1">
            {row.original.actions.map((a) => (
              <Badge key={a} variant={ACTION_BADGE[a]?.variant ?? "secondary"}>
                {ACTION_BADGE[a]?.label ?? a}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "lastActedAt",
        header: "办理时间",
        size: 150,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
            {formatTime(row.original.lastActedAt)}
          </span>
        ),
      },
      {
        id: "detail",
        header: "操作",
        size: 90,
        cell: ({ row }) => (
          <Button asChild variant="ghost" className="h-7 px-2.5 text-primary hover:bg-primary/5 hover:text-primary">
            <Link href={`/approvals/${row.original.requestId}`}>查看</Link>
          </Button>
        ),
      },
    ],
    []
  );

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="我办理的记录"
        description="经我手的全部流转：我审批的、我执行的，以及终审后由我触发的自动执行"
        action={
          canExport ? (
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="mr-1.5 h-4 w-4" />
              {exporting ? "导出中..." : "导出 Excel"}
            </Button>
          ) : undefined
        }
      />

      {options.canViewAll && (
        <div className="flex items-center gap-2 border-b">
          {[
            { value: "MINE" as const, label: "我办理的" },
            { value: "ALL" as const, label: "全部办理记录" },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setMode(tab.value)}
              className={`px-3 py-2 text-sm border-b-2 transition-colors ${
                mode === tab.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* 筛选区：条件变化自动防抖查询（关键字置首） */}
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">关键字</Label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="单号 / 申请标题"
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">部门</Label>
            <SearchableSelect
              options={[
                { value: ALL, label: "全部部门" },
                ...options.departments.map((d) => ({ value: String(d.id), label: d.name })),
              ]}
              value={departmentId || ALL}
              onValueChange={(v) => setDepartmentId(v === ALL ? "" : v)}
              placeholder="全部部门"
              triggerClassName="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">人员</Label>
            <SearchableSelect
              options={[
                { value: ALL, label: "全部人员" },
                ...options.initiators.map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              value={initiatorId || ALL}
              onValueChange={(v) => setInitiatorId(v === ALL ? "" : v)}
              placeholder="全部人员"
              searchPlaceholder="按姓名搜索"
              triggerClassName="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">配件类型</Label>
            <SearchableSelect
              options={[
                { value: ALL, label: "全部配件类型" },
                ...options.componentCategories.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
              value={componentCategoryId || ALL}
              onValueChange={(v) => setComponentCategoryId(v === ALL ? "" : v)}
              placeholder="全部配件类型"
              triggerClassName="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">业务类型</Label>
            <SearchableSelect
              options={BUSINESS_TYPE_OPTIONS}
              value={businessType}
              onValueChange={setBusinessType}
              placeholder="全部类型"
              triggerClassName="w-full"
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
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card">
        <DataTable columns={columns} data={pageRows} hidePagination />
        <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            共 <span className="font-medium text-foreground">{total}</span> 条办理记录
          </span>
          <PagePagination current={safePage} total={totalPages} onPageChange={setPage} />
        </div>
        {loading && <div className="px-4 pb-3 text-xs text-muted-foreground">查询中...</div>}
      </div>
    </div>
  );
}

/** 服务端返回的日期在客户端统一转成 ISO 字符串，避免渲染分支不一致 */
function serialize(rows: HandledRecord[]): RecordRow[] {
  return rows.map((r) => ({
    ...r,
    lastActedAt: r.lastActedAt instanceof Date ? r.lastActedAt.toISOString() : r.lastActedAt,
  }));
}