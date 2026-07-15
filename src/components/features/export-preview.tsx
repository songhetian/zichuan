"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";

interface ExportPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Record<string, any>[];
  columns: { key: string; label: string }[];
  onExport: (selectedFields: string[]) => void;
  loading?: boolean;
}

export function ExportPreview({
  open,
  onOpenChange,
  data,
  columns,
  onExport,
  loading = false,
}: ExportPreviewProps) {
  const [selectedFields, setSelectedFields] = useState<string[]>([]);

  // 当对话框打开时，默认选中所有字段
  useEffect(() => {
    if (open) {
      setSelectedFields(columns.map((c) => c.key));
    }
  }, [open, columns]);

  const handleToggleField = (fieldKey: string) => {
    setSelectedFields((prev) => {
      if (prev.includes(fieldKey)) {
        return prev.filter((k) => k !== fieldKey);
      } else {
        return [...prev, fieldKey];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedFields.length === columns.length) {
      setSelectedFields([]);
    } else {
      setSelectedFields(columns.map((c) => c.key));
    }
  };

  const handleExport = () => {
    onExport(selectedFields);
  };

  // 预览前 5 行数据
  const previewData = data.slice(0, 5);
  const selectedColumns = columns.filter((c) => selectedFields.includes(c.key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>导出预览</DialogTitle>
          <DialogDescription>
            确认要导出的数据范围和字段
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* 统计信息 */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              总记录数：{data.length}
            </Badge>
            <Badge variant="outline">
              已选字段：{selectedFields.length} / {columns.length}
            </Badge>
          </div>

          {/* 字段选择 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">选择导出字段</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="h-7"
              >
                {selectedFields.length === columns.length ? "取消全选" : "全选"}
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 border rounded-md bg-muted/30">
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded transition-colors"
                >
                  <Checkbox
                    checked={selectedFields.includes(col.key)}
                    onCheckedChange={() => handleToggleField(col.key)}
                  />
                  <span className="text-sm">{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 数据预览表格 */}
          <div className="space-y-2">
            <div className="font-medium text-sm">数据预览（前 5 行）</div>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectedColumns.map((col) => (
                      <TableHead key={col.key} className="h-9">
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.length > 0 ? (
                    previewData.map((row, idx) => (
                      <TableRow key={idx}>
                        {selectedColumns.map((col) => (
                          <TableCell key={col.key} className="py-2">
                            {String(row[col.key] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={selectedColumns.length}
                        className="text-center py-6 text-muted-foreground"
                      >
                        暂无数据
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleExport}
            disabled={loading || selectedFields.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            {loading ? "导出中..." : `导出 ${data.length} 条记录`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
