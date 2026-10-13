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
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { importEmployeesToDepartment } from "@/actions/excel.actions";

interface EmployeeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: { id: number; name: string }[];
}

/**
 * 批量导入员工：先选部门，再上传只含「姓名（必填）/ 电话 / 邮箱 / 工号（可选）」的 Excel。
 * 工号留空自动生成 EMP0001 形式；工号重复报错跳过；同部门同名仅告警。
 */
export function EmployeeImportDialog({
  open,
  onOpenChange,
  departments,
}: EmployeeImportDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [departmentId, setDepartmentId] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setDepartmentId("");
    }
    onOpenChange(v);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!departmentId) {
      toast({ title: "请先选择部门", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await importEmployeesToDepartment({
        departmentId: Number(departmentId),
        buffer,
      });
      if (result.success) {
        const { importedCount, errors, warnings } = result.data;
        const parts = [`成功导入 ${importedCount} 人`];
        if (errors.length > 0) parts.push(`失败 ${errors.length} 条`);
        if (warnings.length > 0) parts.push(`警告 ${warnings.length} 条`);
        toast({
          title: "导入完成",
          description: parts.join("，"),
        });
        if (errors.length > 0) {
          // 失败明细给一条额外提示，避免用户以为全部成功
          toast({
            title: "部分行未导入",
            description: errors.slice(0, 3).join("；") + (errors.length > 3 ? " 等" : ""),
            variant: "destructive",
          });
        }
        if (importedCount > 0) router.refresh();
      } else {
        toast({ title: "导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    }
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量导入员工</DialogTitle>
          <DialogDescription>
            选择部门后上传 Excel，整批创建到该部门
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>部门</Label>
            <SearchableSelect
              value={departmentId}
              onValueChange={(v) => {
                if (v) setDepartmentId(v);
              }}
              ariaLabel="选择部门"
              placeholder="选择部门"
              triggerClassName="w-full"
              options={departments.map((d) => ({ value: d.id.toString(), label: d.name }))}
            />
          </div>
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>Excel 列要求：姓名（必填）、电话、邮箱、工号（可选，不带部门列）。</p>
            <p>工号留空自动生成（如 EMP0001）；工号重复的行会被跳过。</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || !departmentId}
          >
            <Upload className="mr-2 h-4 w-4" />
            {loading ? "导入中..." : "选择文件并导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}