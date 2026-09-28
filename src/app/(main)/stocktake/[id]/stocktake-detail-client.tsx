"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, AlertCircle, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  updateStocktakeRecord,
  completeStocktakeSession,
  getStocktakeSessionById,
  importStocktakeFile,
  exportStocktakeAbnormal,
} from "@/actions/stocktake.actions";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { ExportPreview } from "@/components/features/export-preview";
import { usePermission } from "@/hooks/use-permission";

interface StocktakeRecord {
  id: number;
  assetId: number;
  assetNo: string;
  assetName: string;
  expectedStatus: string;
  actualStatus: string;
  remark: string | null;
}

interface StocktakeDetailClientProps {
  session: {
    id: number;
    name: string;
    description: string | null;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
  };
  records: StocktakeRecord[];
}

const statusMap: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "已报废",
  RESERVED: "预占",
};

/** 异常报告导出的列定义（与后端 importStocktakeAbnormalRow 字段 key 一一对应），用于 ExportPreview 复用 */
export const abnormalColumns = [
  { key: "assetNo", label: "设备编号" },
  { key: "assetName", label: "设备名称" },
  { key: "expectedStatus", label: "预期状态" },
  { key: "actualStatus", label: "实际状态" },
  { key: "remark", label: "备注" },
] as const;

export type StocktakeAbnormalColumnKey = (typeof abnormalColumns)[number]["key"];

const resultConfig: Record<
  string,
  { label: string; icon: any; color: string; bgColor: string }
> = {
  NORMAL: {
    label: "正常",
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-50 border-green-200 hover:bg-green-100",
  },
  MISSING: {
    label: "盘亏",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200 hover:bg-red-100",
  },
  EXTRA: {
    label: "盘盈",
    icon: AlertCircle,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200 hover:bg-blue-100",
  },
};

export function StocktakeDetailClient({
  session,
  records: initialRecords,
}: StocktakeDetailClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const canImport = usePermission("asset.manage");
  const [records, setRecords] = useState(initialRecords);
  const [selectedRecord, setSelectedRecord] = useState<StocktakeRecord | null>(
    null
  );
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [importResult, setImportResult] = useState<{
    updated: number;
    unknown: string[];
  } | null>(null);

  // 上传 Excel 对账：把文件字节传给后端解析并对账，随后刷新明细
  const handleImportExcel = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const buffer = await file.arrayBuffer();
        const res = await importStocktakeFile(session.id, buffer);
        if (res.success) {
          setImportResult({ updated: res.data.updated, unknown: res.data.unknown });
          toast({
            title: "对账完成",
            description: `共更新 ${res.data.updated} 条`,
          });
          // 刷新明细（actualStatus 因对账变化）
          const fresh = await getStocktakeSessionById(session.id);
          if (fresh.success) setRecords(fresh.data.records);
        } else {
          setImportResult(null);
          toast({ title: "对账失败", description: res.error, variant: "destructive" });
        }
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  // 导出异常报告：后端生成 xlsx 的 base64 → Blob → 触发浏览器下载
  const handleExportAbnormal = async (selectedFields?: string[]) => {
    setExporting(true);
    try {
      const res = await exportStocktakeAbnormal(
        session.id,
        selectedFields as StocktakeAbnormalColumnKey[] | undefined
      );
      if (res.success) {
        const bytes = Uint8Array.from(atob(res.data.base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes]));
        const link = document.createElement("a");
        link.href = url;
        link.download = `盘点异常_${session.name}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        toast({
          title: "导出失败",
          description: res.error,
          variant: "destructive",
        });
      }
    } finally {
      setExporting(false);
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedRecord || !editOpen) return;

      const key = e.key.toLowerCase();
      if (key === "n") {
        handleUpdateRecord("NORMAL");
      } else if (key === "m") {
        handleUpdateRecord("MISSING");
      } else if (key === "e") {
        handleUpdateRecord("EXTRA");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRecord, editOpen]);

  const handleUpdateRecord = async (actualStatus: string) => {
    if (!selectedRecord) return;

    setLoading(true);
    const result = await updateStocktakeRecord(selectedRecord.id, {
      actualStatus: actualStatus as "NORMAL" | "MISSING" | "EXTRA",
      remark: selectedRecord.remark ?? undefined,
    });
    setLoading(false);

    if (result.success) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === selectedRecord.id ? { ...r, actualStatus } : r
        )
      );
      toast({ title: "更新成功" });
      setEditOpen(false);
      setSelectedRecord(null);
    } else {
      toast({
        title: "更新失败",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    const result = await completeStocktakeSession(session.id);
    setLoading(false);

    if (result.success) {
      toast({
        title: "盘点完成",
        description: `正常: ${result.data.normal}, 盘亏: ${result.data.missing}, 盘盈: ${result.data.extra}`,
      });
      router.refresh();
    } else {
      toast({
        title: "操作失败",
        description: result.error,
        variant: "destructive",
      });
    }
    setCompleteOpen(false);
  };

  const handleEditRecord = (record: StocktakeRecord) => {
    setSelectedRecord(record);
    setEditOpen(true);
  };

  // 计算统计数据
  const total = records.length;
  const normalCount = records.filter((r) => r.actualStatus === "NORMAL").length;
  const missingCount = records.filter((r) => r.actualStatus === "MISSING").length;
  const extraCount = records.filter((r) => r.actualStatus === "EXTRA").length;
  const progress = total > 0 ? ((normalCount + missingCount + extraCount) / total) * 100 : 0;

  // 异常记录 = 盘亏/盘盈，或带备注（与对账/导出判定一致），供预览弹窗展示
  const abnormalRecords = records.filter(
    (r) => r.actualStatus === "MISSING" || r.actualStatus === "EXTRA" || r.remark
  );

  // 导出预览数据（与后端导出列 key 一一对应）
  const abnormalExportData = abnormalRecords.map((r) => ({
    assetNo: r.assetNo,
    assetName: r.assetName ?? "",
    expectedStatus: r.expectedStatus,
    actualStatus: r.actualStatus,
    remark: r.remark ?? "",
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/stocktake")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span>{session.name}</span>
          </div>
        }
        description={session.description || "盘点任务详情"}
        action={
          session.status === "OPEN" ? (
            <Button onClick={() => setCompleteOpen(true)}>完成盘点</Button>
          ) : (
            <Badge variant="default">已完成</Badge>
          )
        }
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-sm text-muted-foreground mb-1">总设备数</div>
          <div className="text-2xl font-bold">{total}</div>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="text-sm text-emerald-500 mb-1">正常</div>
          <div className="text-2xl font-bold text-emerald-500">{normalCount}</div>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <div className="text-sm text-red-500 mb-1">盘亏</div>
          <div className="text-2xl font-bold text-red-500">{missingCount}</div>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/10 p-4">
          <div className="text-sm text-primary mb-1">盘盈</div>
          <div className="text-2xl font-bold text-primary">{extraCount}</div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-card rounded-lg border p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">盘点进度</span>
          <span className="font-medium">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* 上传 Excel 对账 */}
      {session.status === "OPEN" && (
        <div className="bg-card rounded-lg border p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">上传 Excel 对账</div>
              <div className="text-xs text-muted-foreground">
                表头支持「设备编号/实际状态」等；结果支持 正常/盘亏/盘盈
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {abnormalRecords.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                >
                  导出异常报告 ({abnormalRecords.length})
                </Button>
              )}
              {canImport && (
                <Button variant="secondary" size="sm" onClick={handleImportExcel} disabled={importing}>
                  {importing ? "对账中…" : "选择 Excel 并上传"}
                </Button>
              )}
            </div>
          </div>

          {importResult && (
            <div className="text-sm rounded-md border p-3 bg-muted space-y-1">
              <div>已更新 <span className="font-semibold text-primary">{importResult.updated}</span> 条记录</div>
              {importResult.unknown.length > 0 && (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    表中存在但系统内没有的编号（盘盈待核查）：
                    <span className="font-mono text-amber-500">
                      {importResult.unknown.join("、")}
                    </span>
                  </div>
                </div>
              )}
              {importResult.updated === 0 && importResult.unknown.length === 0 && (
                <div>未发现变更</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 设备卡片列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {records.map((record) => {
          const config = resultConfig[record.actualStatus];
          const Icon = config.icon;
          const expectedLabel = statusMap[record.expectedStatus] ?? record.expectedStatus;

          return (
            <div
              key={record.id}
              className={`bg-card rounded-lg border-2 p-4 cursor-pointer transition-all hover:border-primary/40 ${
                session.status === "OPEN" ? "hover:border-primary" : ""
              }`}
              onClick={() => session.status === "OPEN" && handleEditRecord(record)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-sm text-muted-foreground">
                    {record.assetNo}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    预期状态: {expectedLabel}
                  </div>
                </div>
                <Icon className={`h-6 w-6 ${config.color}`} />
              </div>

              <div className="flex items-center justify-between">
                <Badge variant="outline" className={config.bgColor}>
                  {config.label}
                </Badge>
                {record.remark && (
                  <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                    {record.remark}
                  </div>
                )}
              </div>

              {session.status === "OPEN" && (
                <div className="mt-3 pt-3 border-t text-xs text-center text-muted-foreground">
                  点击修改盘点结果
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>盘点设备</DialogTitle>
            <DialogDescription>
              设备编号: {selectedRecord?.assetNo}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              预期状态: {statusMap[selectedRecord?.expectedStatus ?? ""] ?? selectedRecord?.expectedStatus}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="h-20 flex-col gap-2 bg-green-50 border-green-200 hover:bg-green-100"
                onClick={() => handleUpdateRecord("NORMAL")}
                disabled={loading}
              >
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <span className="text-sm">正常 (N)</span>
              </Button>
              <Button
                variant="outline"
                className="h-20 flex-col gap-2 bg-red-50 border-red-200 hover:bg-red-100"
                onClick={() => handleUpdateRecord("MISSING")}
                disabled={loading}
              >
                <XCircle className="h-6 w-6 text-red-600" />
                <span className="text-sm">盘亏 (M)</span>
              </Button>
              <Button
                variant="outline"
                className="h-20 flex-col gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100"
                onClick={() => handleUpdateRecord("EXTRA")}
                disabled={loading}
              >
                <AlertCircle className="h-6 w-6 text-blue-600" />
                <span className="text-sm">盘盈 (E)</span>
              </Button>
            </div>

            <div className="space-y-2">
              <Label>备注（可选）</Label>
              <Textarea
                value={selectedRecord?.remark ?? ""}
                onChange={(e) => {
                  if (selectedRecord) {
                    setSelectedRecord({ ...selectedRecord, remark: e.target.value });
                  }
                }}
                placeholder="输入备注信息"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出异常报告（可预览 + 选择字段后导出） */}
      <ExportPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={abnormalExportData}
        columns={abnormalColumns as unknown as { key: string; label: string }[]}
        onExport={async (fields) => {
          await handleExportAbnormal(Array.isArray(fields) ? fields : undefined);
        }}
        loading={exporting}
      />

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="确认完成盘点"
        description={`确定要完成盘点任务「${session.name}」吗？完成后将无法修改。`}
        onConfirm={handleComplete}
      />
    </div>
  );
}
