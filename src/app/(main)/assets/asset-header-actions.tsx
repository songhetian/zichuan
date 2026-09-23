"use client";

import { Button } from "@/components/ui/button";
import { usePermission } from "@/hooks/use-permission";
import { Download, Plus, Upload } from "lucide-react";

interface AssetHeaderActionsProps {
  hasSelection: boolean;
  exportLoading: boolean;
  importLoading: boolean;
  autoImportLoading: boolean;
  onCreate: () => void;
  onExportAll: () => void;
  onExportSelected: () => void;
  onImportClick: () => void;
  onAutoImportClick: () => void;
}

/**
 * 设备页顶部操作栏：为细粒度操作点做按钮级权限门控（f5）。
 * - 导出 → asset.device.export
 * - 新建设备 → asset.device.create
 * 导入无对应操作点，登录即可见。
 */
export function AssetHeaderActions({
  hasSelection,
  exportLoading,
  importLoading,
  autoImportLoading,
  onCreate,
  onExportAll,
  onExportSelected,
  onImportClick,
  onAutoImportClick,
}: AssetHeaderActionsProps) {
  const canCreate = usePermission("asset.device.create");
  const canExport = usePermission("asset.device.export");

  return (
    <div className="flex items-center gap-2">
      {canExport && (
        <Button variant="outline" onClick={onExportAll} disabled={exportLoading}>
          <Download className="mr-2 h-4 w-4" />
          {exportLoading ? "导出中..." : "导出 Excel"}
        </Button>
      )}
      {canExport && hasSelection && (
        <Button
          variant="outline"
          onClick={onExportSelected}
          disabled={exportLoading}
          className="border-primary text-primary hover:bg-primary/5"
          title="仅导出当前选中的设备"
        >
          <Download className="mr-2 h-4 w-4" />
          {exportLoading ? "导出中..." : `导出选中`}
        </Button>
      )}
      <Button variant="outline" onClick={onImportClick} disabled={importLoading} title="手动导入：需提前创建模板，适合手动维护设备数据">
        <Upload className="mr-2 h-4 w-4" />
        {importLoading ? "导入中..." : "导入 Excel"}
      </Button>
      <Button
        variant="outline"
        onClick={onAutoImportClick}
        disabled={autoImportLoading}
        className="border-primary text-primary hover:bg-primary/5"
        title="硬件扫描导入：从扫描脚本生成的Excel导入，自动创建分类、模板和配件"
      >
        <Upload className="mr-2 h-4 w-4" />
        {autoImportLoading ? "导入中..." : "硬件扫描导入"}
      </Button>
      {canCreate && (
        <Button onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          新建设备
        </Button>
      )}
    </div>
  );
}