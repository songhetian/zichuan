"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadExcelFile } from "@/lib/excel-download";
import { exportAssetAssignTemplate, importAssetAssignments } from "@/actions/excel.actions";
import type { AssignImportIssue } from "@/lib/asset-assign-import";

interface BatchAssignImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AssignResult {
  assignedCount: number;
  errorCount: number;
  errors: AssignImportIssue[];
  errorFile?: { buffer: number[]; fileName: string };
}

/**
 * 批量分配设备（Excel 自动分配）。
 * 模板：姓名 | 部门 | 设备编号01 | 设备编号02 | ...
 * 按「姓名」把对应设备编号绑定到该员工，部门/员工不存在自动创建，设备置「在用」。
 * 编号写错的行会被标记并跳过，可把错误行重新导出来修正后再次上传。
 */
export function BatchAssignImportDialog({ open, onOpenChange }: BatchAssignImportDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [templateLoading, setTemplateLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<AssignResult | null>(null);

  React.useEffect(() => {
    if (!open) setResult(null);
  }, [open]);

  const handleDownloadTemplate = async () => {
    setTemplateLoading(true);
    try {
      const res = await exportAssetAssignTemplate();
      if (res.success) {
        downloadExcelFile(res.data.fileName, res.data.buffer);
      } else {
        toast({ title: "下载模板失败", description: res.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "下载模板失败", variant: "destructive" });
    }
    setTemplateLoading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buffer = Array.from(new Uint8Array(await file.arrayBuffer()));
      const res = await importAssetAssignments({ buffer });
      if (res.success) {
        setResult(res.data);
        const desc =
          res.data.errorCount > 0
            ? `成功分配 ${res.data.assignedCount} 台，失败 ${res.data.errorCount} 条`
            : `成功分配 ${res.data.assignedCount} 台`;
        toast({ variant: "success", title: "导入完成", description: desc });
        router.refresh();
      } else {
        toast({ title: "导入失败", description: res.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDownloadErrors = () => {
    if (!result?.errorFile) return;
    downloadExcelFile(result.errorFile.fileName, result.errorFile.buffer);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量分配设备（Excel）</DialogTitle>
          <DialogDescription>
            下载模板后填写：每行一个人，先填「姓名」「部门」，再把要分配给该人的设备编号依次填入
            「设备编号01/02…」。姓名为空但有编号的行会被标记为错误。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/80 bg-muted/20 p-3 text-xs text-muted-foreground">
          规则：部门 / 员工不存在时自动创建（账号同步生成，初始密码 123456）；设备将置为「在用」。
          编号写错（不存在 / 非闲置）的行会被跳过并集中导出，修正后可再次上传。
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadTemplate}
            disabled={templateLoading}
          >
            {templateLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            下载模板
          </Button>
          <Button type="button" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {importing ? "导入中…" : "上传填写好的文件"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {result && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-foreground">
                成功分配 <span className="font-medium text-primary">{result.assignedCount}</span> 台
              </span>
              <span className="text-muted-foreground">
                失败 <span className="font-medium">{result.errorCount}</span> 条
              </span>
              {result.errorFile && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={handleDownloadErrors}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  下载错误行
                </Button>
              )}
            </div>

            {result.errors.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border border-border/80">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-normal">姓名</th>
                      <th className="px-3 py-2 text-left font-normal">部门</th>
                      <th className="px-3 py-2 text-left font-normal">设备编号</th>
                      <th className="px-3 py-2 text-left font-normal">错误原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={`${err.assetNo}-${i}`} className="border-t border-border/60">
                        <td className="px-3 py-2">{err.name || "-"}</td>
                        <td className="px-3 py-2">{err.department || "-"}</td>
                        <td className="px-3 py-2 font-mono">{err.assetNo}</td>
                        <td className="px-3 py-2 text-muted-foreground">{err.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}