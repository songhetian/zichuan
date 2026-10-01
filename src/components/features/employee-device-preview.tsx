"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Monitor } from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { AssetConfigList } from "@/components/features/asset-config-list";
import { getStatusLabel } from "@/lib/status-labels";
import {
  assetStatusTone,
  categoryDotClass,
  toneInline,
  TONE_TEXT,
  type Tone,
} from "@/lib/status-styles";
import type { EmployeeAsset, EmployeeWithDept } from "@/actions/employee.actions";

export interface EmployeeDevicePreviewProps {
  employee: EmployeeWithDept;
  assets: EmployeeAsset[];
  /**
   * 内嵌形态（审批弹窗用）：不渲染页面级标题。
   * 页面里 h1 + 返回按钮是导航；在弹窗里它们是噪音，标题交给 DialogTitle。
   */
  embedded?: boolean;
}

/** 资产状态小标签 */
function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium ${toneInline(
        assetStatusTone(status)
      )}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

/** 保修结论：把「采购日期 + 保修月数」两个原始字段算成一句结论 */
function warrantyOf(asset: EmployeeAsset): { text: string; tone: Tone; daysLeft?: number } | null {
  if (!asset.purchaseDate || !asset.warrantyMonths) return null;
  const start = new Date(asset.purchaseDate);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start);
  end.setMonth(end.getMonth() + asset.warrantyMonths);

  const daysLeft = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return { text: "已过保", tone: "danger" };
  return { text: "在保", tone: "success", daysLeft };
}

/** 基本信息项：标签 + 值（工号用等宽字） */
function InfoItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}

/** 概览小卡：一个结论 + 一个数字 */
function Kpi({ label, value, tone = "neutral" }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
        {value}
        <span className="ml-0.5 text-xs font-normal text-muted-foreground">台</span>
      </dd>
    </div>
  );
}

/** 单台设备行：基本信息 + 按需展开的配件明细 + 进入资产详情的只读下钻 */
function DeviceRow({ asset }: { asset: EmployeeAsset }) {
  const [configOpen, setConfigOpen] = useState(false);
  const warranty = warrantyOf(asset);

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${categoryDotClass(asset.categoryName)}`}
              aria-hidden
            />
            <span className="truncate text-sm font-medium">{asset.name}</span>
            <StatusChip status={asset.status} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{asset.assetNo}</span>
            <span>{asset.categoryName}</span>
            {asset.location && <span>{asset.location}</span>}
            {warranty && (
              <span className="inline-flex items-center gap-1.5">
                <span className={toneInline(warranty.tone)}>{warranty.text}</span>
                {warranty.daysLeft !== undefined && <span>剩 {warranty.daysLeft} 天</span>}
              </span>
            )}
          </div>
        </div>

        <Link
          href={`/assets/${asset.id}`}
          className="shrink-0 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          资产详情
        </Link>
      </div>

      {/* 配件明细：默认不请求，展开才拉取，避免 N 台设备一次打 N 个查询 */}
      <button
        type="button"
        onClick={() => setConfigOpen((open) => !open)}
        aria-expanded={configOpen}
        className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${configOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
        配件明细
      </button>

      {configOpen && (
        <div className="mt-2">
          <AssetConfigList assetId={asset.id} />
        </div>
      )}
    </li>
  );
}

/**
 * 「某位员工名下全部设备」的只读展示，两处共用：
 *   1. 独立预览页 `/employees/[id]`（embedded=false，带页面标题与返回）
 *   2. 离职审批的核对弹窗（embedded=true，标题由 DialogTitle 提供）
 *
 * 只读：不提供分配/归还/调拨/报废等任何写操作入口。两处共用同一个组件，
 * 是为了避免「页面上能看、弹窗里看不到」这类两套渲染带来的口径漂移。
 */
export function EmployeeDevicePreview({
  employee,
  assets,
  embedded = false,
}: EmployeeDevicePreviewProps) {
  const inUse = assets.filter((a) => a.status === "IN_USE").length;
  const inMaintenance = assets.filter((a) => a.status === "IN_MAINTENANCE").length;
  const expired = assets.filter((a) => warrantyOf(a)?.text === "已过保").length;

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {!embedded && (
        <PageHeader showBack title={employee.name} description={employee.departmentName} />
      )}
      {embedded && (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">{employee.name}</span>
          <span className="text-sm text-muted-foreground">{employee.departmentName}</span>
        </p>
      )}

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
        <InfoItem label="工号" value={employee.employeeNo} mono />
        <InfoItem label="电话" value={employee.phone || "—"} />
        <InfoItem label="邮箱" value={employee.email || "—"} />
      </dl>

      <section aria-label="设备概览">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="名下设备" value={assets.length} />
          <Kpi label="在用" value={inUse} tone="success" />
          <Kpi label="维修中" value={inMaintenance} tone="warning" />
          <Kpi label="已过保" value={expired} tone="danger" />
        </dl>
      </section>

      <ul className="divide-y divide-border rounded-lg border">
        {assets.length === 0 && (
          <li className="flex flex-col items-center justify-center gap-1.5 py-12 text-muted-foreground">
            <Monitor className="h-6 w-6 opacity-50" aria-hidden />
            <span className="text-sm">该员工名下暂无在用设备</span>
          </li>
        )}
        {assets.map((asset) => (
          <DeviceRow key={asset.id} asset={asset} />
        ))}
      </ul>
    </div>
  );
}
