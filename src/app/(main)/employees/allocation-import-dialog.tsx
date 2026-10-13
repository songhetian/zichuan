"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Download, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadExcelFile } from "@/lib/excel-download";
import {
  exportAllocationTemplate,
  previewAllocationImport,
  exportAllocationErrors,
  confirmAllocationImport,
  type AllocationImportRow,
} from "@/actions/auto-allocate.actions";

type Step = "start" | "preview";

interface AllocationImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 「导入 Excel 自动分配」弹窗。
 *
 * 流程：导出空白模板（姓名 | 部门 | 设备编号01/02…）→ 主管直接填写每名员工及其持有的设备编号 →
 * 导回后预览逐行匹配结果 → 确认落库。预览与落库都走同一个 planAllocation，口径一致。
 */
export function AllocationImportDialog({ open, onOpenChange }: AllocationImportDialogProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("start");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewRows, setPreviewRows] = useState<AllocationImportRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAll = () => {
    setStep("start");
    setPreviewRows([]);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) resetAll();
    onOpenChange(v);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportAllocationTemplate();
      if (result.success) {
        downloadExcelFile(result.data.fileName, result.data.buffer);
        toast({
          title: "模板已导出",
          description: "一行填一个人：「姓名」「部门」+ 其持有的设备编号（设备编号01/02…），填好后导回",
        });
      } else {
        toast({ title: "导出失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导出失败", variant: "destructive" });
    }
    setExporting(false);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      // 与项目其它导入一致：以 number[] 跨 server action 边界传输，避免 Buffer 序列化问题
      const buffer = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await previewAllocationImport({ buffer });
      if (result.success) {
        setPreviewRows(result.data.rows);
        setStep("preview");
      } else {
        toast({ title: "解析失败", description: result.error, variant: "destructive" });
      }
    } catch (e) {
      toast({
        title: "解析失败",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const assignableRows = previewRows.filter((r) => r.ok && r.assetId != null);
  const errorRows = previewRows.filter((r) => !r.ok);

  /** 导出错误行（含错误原因）供主管下载修正；导出文件本身可再次导入 */
  const downloadErrorRows = async (rows: AllocationImportRow[]) => {
    const result = await exportAllocationErrors({
      rows: rows.map((r) => ({
        employeeName: r.employeeName,
        departmentName: r.departmentName,
        assetNo: r.assetNo,
        reason: r.reason ?? "不可分配",
      })),
    });
    if (result.success) {
      downloadExcelFile(result.data.fileName, result.data.buffer);
      toast({
        title: `已导出 ${result.data.count} 行错误明细`,
        description: "改正「设备编号」后可直接重新导入该文件",
      });
    } else {
      toast({ title: "导出错误明细失败", description: result.error, variant: "destructive" });
    }
  };

  const handleConfirm = async () => {
    if (assignableRows.length === 0) return;
    setSubmitting(true);
    const result = await confirmAllocationImport({
      items: assignableRows.map((r) => ({
        employeeName: r.employeeName,
        departmentName: r.departmentName || null,
        assetId: r.assetId!,
      })),
    });
    setSubmitting(false);
    if (result.success) {
      const { allocatedCount, skipped, createdDepartments, createdEmployees } = result.data;
      const parts = [`已分配 ${allocatedCount} 台`];
      if (createdDepartments > 0) parts.push(`新建部门 ${createdDepartments} 个`);
      if (createdEmployees > 0) parts.push(`新建员工 ${createdEmployees} 人`);
      toast({
        title: parts.join("，"),
        description:
          skipped.length > 0
            ? `跳过 ${skipped.length} 台：${skipped[0].reason}${skipped.length > 1 ? " 等" : ""}`
            : undefined,
      });

      // 有问题的行已被跳过：把错误行导出成 Excel，提示主管下载修正
      if (errorRows.length > 0) {
        await downloadErrorRows(errorRows);
      }

      resetAll();
      onOpenChange(false);
      router.refresh();
    } else {
      toast({ title: "分配失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>导入 Excel 自动分配</DialogTitle>
          <DialogDescription>
            先导出空白模板，按「姓名 | 部门 | 设备编号01/02…」逐行填写每名员工及其持有的设备编号后导回；姓名/部门不存在会自动创建，编号写错的行会标出并跳过
          </DialogDescription>
        </DialogHeader>

        {/* 步骤指示 */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={step === "start" ? "font-medium text-primary" : ""}>
            ① 导出空白模板并填写
          </span>
          <span>›</span>
          <span className={step === "preview" ? "font-medium text-primary" : ""}>
            ② 导回并预览匹配结果
          </span>
          <span>›</span>
          <span>③ 确认分配</span>
        </div>

        {step === "start" ? (
          <>
            <div className="rounded-md border p-4 text-sm text-muted-foreground">
              <p className="mb-2">
                模板列：
                <span className="font-mono text-xs">
                  姓名 | 部门 | 设备编号01 | 设备编号02 | …
                </span>
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>一行填一个人：填「姓名」「部门」，再横向填该员工持有的设备编号</li>
                <li>系统中没有的姓名 / 部门会在导入时自动创建</li>
                <li>编号写错、重复或该设备非闲置 / 库存的行会标出并跳过，不影响其它行</li>
              </ul>
            </div>

            <DialogFooter className="border-t-0">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                <Upload className="mr-2 h-4 w-4" />
                {importing ? "解析中..." : "导入填好的模板"}
              </Button>
              <Button onClick={handleExport} disabled={exporting}>
                <Download className="mr-2 h-4 w-4" />
                {exporting ? "导出中..." : "导出空白模板"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={handleFileChange}
              />
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                共 {previewRows.length} 行，可分配{" "}
                <span className="font-medium text-primary">{assignableRows.length}</span> 行
              </span>
              {previewRows.length - assignableRows.length > 0 ? (
                <span className="text-destructive">
                  {previewRows.length - assignableRows.length} 行有问题，将跳过
                </span>
              ) : null}
            </div>

            <div className="min-h-[220px] flex-1 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    <th className="p-2 text-left font-medium">行号</th>
                    <th className="p-2 text-left font-medium">姓名</th>
                    <th className="p-2 text-left font-medium">部门</th>
                    <th className="p-2 text-left font-medium">员工</th>
                    <th className="p-2 text-left font-medium">设备编号</th>
                    <th className="p-2 text-left font-medium">设备</th>
                    <th className="p-2 text-left font-medium">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.rowIndex} className="border-t">
                      <td className="p-2 text-muted-foreground">{r.rowIndex}</td>
                      <td className="p-2">{r.employeeName || "-"}</td>
                      <td className="p-2">
                        {r.departmentName || r.employeeDept || "-"}
                        {r.willCreateDepartment ? (
                          <span className="text-primary">（将创建）</span>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {r.employeeId != null ? (
                          <span className="text-muted-foreground">已存在</span>
                        ) : r.willCreateEmployee ? (
                          <span className="text-primary">将自动创建</span>
                        ) : (
                          <span className="text-destructive">未匹配</span>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs">{r.assetNo || "-"}</td>
                      <td className="p-2">
                        {r.assetId != null ? (
                          <span>
                            {r.assetCategory || "-"}
                            <span className="text-muted-foreground">
                              （{r.assetStatus ?? "-"}）
                            </span>
                          </span>
                        ) : (
                          <span className="text-destructive">未匹配</span>
                        )}
                      </td>
                      <td className="p-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <Check className="h-4 w-4" /> 可分配
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <X className="h-4 w-4" /> {r.reason ?? "不可分配"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter className="border-t-0">
              <Button variant="outline" onClick={() => setStep("start")}>
                上一步
              </Button>
              {errorRows.length > 0 ? (
                <Button
                  variant="outline"
                  onClick={() => downloadErrorRows(errorRows)}
                  disabled={submitting}
                >
                  <Download className="mr-2 h-4 w-4" />
                  导出错误行（{errorRows.length}）
                </Button>
              ) : null}
              <Button
                onClick={handleConfirm}
                disabled={submitting || assignableRows.length === 0}
              >
                {submitting ? "分配中..." : `确认分配 ${assignableRows.length} 台`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}