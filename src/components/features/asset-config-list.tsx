"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAssetComponents } from "@/actions/employee.actions";

export type AssetComponentRow = {
  modelName: string;
  modelBrand: string | null;
  categoryName: string;
  quantity: number;
};

/**
 * 主机配件明细（只读，按 assetId 懒加载）。
 *
 * 原先内联在 `employee-list-client.tsx` 的展开行里，员工在用设备预览页也要用，
 * 故抽为共享组件，避免两处各写一份。
 */
export function AssetConfigList({ assetId }: { assetId: number }) {
  const [rows, setRows] = useState<AssetComponentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    getAssetComponents(assetId).then((res) => {
      if (cancelled) return;
      if (res.success) setRows(res.data);
      else setError(res.error ?? "加载失败");
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (rows === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="py-4 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">该主机暂无配置详情</div>;
  }
  return (
    <div className="divide-y rounded-lg border">
      {rows.map((c, idx) => (
        <div key={idx} className="flex items-center justify-between px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">{c.modelName}</div>
            <div className="text-xs text-muted-foreground">
              {[c.modelBrand, c.categoryName].filter(Boolean).join(" · ") || "-"}
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">×{c.quantity}</span>
        </div>
      ))}
    </div>
  );
}
