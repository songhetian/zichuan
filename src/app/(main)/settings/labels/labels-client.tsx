"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Printer,
  Loader2,
  FileDown,
  Monitor,
  Users,
  Building2,
} from "lucide-react";
import { generateLabelData } from "@/actions/label.actions";
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";

// ============================================================
// Types
// ============================================================

interface AssetItem {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  employeeName: string;
  departmentName: string;
}

interface EmployeeItem {
  id: number;
  name: string;
  departmentName: string;
}

interface DepartmentItem {
  id: number;
  name: string;
}

interface LabelData {
  assetNo: string;
  name: string;
  employeeName: string;
  departmentName: string;
  location: string | null;
  components: {
    modelName: string;
    brand: string | null;
    quantity: number;
  }[];
}

interface LabelsClientProps {
  assets: AssetItem[];
  employees: EmployeeItem[];
  departments: DepartmentItem[];
}

// ============================================================
// Constants
// ============================================================

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  IDLE: { label: "闲置", variant: "secondary" },
  IN_USE: { label: "使用中", variant: "default" },
  IN_MAINTENANCE: { label: "维修中", variant: "outline" },
  SCRAPPED: { label: "已报废", variant: "destructive" },
};

type Mode = "asset" | "employee" | "department";

const MODE_CONFIG: { key: Mode; label: string; icon: typeof Monitor }[] = [
  { key: "asset", label: "按设备选择", icon: Monitor },
  { key: "employee", label: "按员工选择", icon: Users },
  { key: "department", label: "按部门选择", icon: Building2 },
];

// ============================================================
// Main Component
// ============================================================

export function LabelsClient({ assets, employees, departments }: LabelsClientProps) {
  const [mode, setMode] = useState<Mode>("asset");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("");
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 根据模式计算可选设备列表
  const selectableAssets = useMemo(() => {
    if (mode === "asset") return assets;
    if (mode === "employee") {
      if (!selectedEmployeeId) return [];
      return assets.filter((a) => String(a.employeeName) === "");
      // 通过后端查询
    }
    if (mode === "department") {
      // 前端筛选：通过 employeeName + departmentName 匹配
      // 但我们只有 departmentName 在 asset 上，需要通过 employees 匹配
      if (!selectedDepartmentId) return [];
      const dept = departments.find((d) => String(d.id) === selectedDepartmentId);
      if (!dept) return [];
      // 获取该部门的所有员工
      const deptEmployees = new Set(
        employees.filter((e) => e.departmentName === dept.name).map((e) => e.name)
      );
      return assets.filter((a) => a.employeeName && deptEmployees.has(a.employeeName));
    }
    return [];
  }, [mode, assets, employees, departments, selectedEmployeeId, selectedDepartmentId]);

  // 切换设备选择
  const handleToggleAsset = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedIds.size === selectableAssets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableAssets.map((a) => a.id)));
    }
  };

  // 切换模式时重置
  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setSelectedIds(new Set());
    setSelectedEmployeeId("");
    setSelectedDepartmentId("");
    setLabels([]);
    setPreviewed(false);
  };

  // 预览标签
  const handlePreview = async () => {
    setLoading(true);
    try {
      let result;
      if (mode === "asset") {
        if (selectedIds.size === 0) return;
        result = await generateLabelData({ assetIds: Array.from(selectedIds) });
      } else if (mode === "employee") {
        if (!selectedEmployeeId) return;
        result = await generateLabelData({ employeeId: Number(selectedEmployeeId) });
      } else {
        if (!selectedDepartmentId) return;
        const dept = departments.find((d) => String(d.id) === selectedDepartmentId);
        if (!dept) return;
        result = await generateLabelData({ departmentName: dept.name });
      }
      if (result.success) {
        setLabels(result.data);
        setPreviewed(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // 打印
  const handlePrint = () => {
    window.print();
  };

  // 导出 PDF
  const handleExportPDF = async () => {
    const labelArea = document.getElementById("label-print-area");
    if (!labelArea) return;

    setExporting(true);
    try {
      const canvas = await html2canvas(labelArea, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save("设备标签.pdf");
    } finally {
      setExporting(false);
    }
  };

  const canPreview =
    mode === "asset"
      ? selectedIds.size > 0
      : mode === "employee"
        ? selectedEmployeeId !== ""
        : selectedIds.size > 0;

  return (
    <div className="space-y-6">
      <PageHeader title="标签打印" description="选择设备并生成标签，支持打印或导出 PDF" />

      {/* 操作区域 - 打印时隐藏 */}
      <div className="print:hidden space-y-5">
        {/* 模式选择 */}
        <div className="flex items-center gap-3">
          {MODE_CONFIG.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => handleModeChange(m.key)}
                className={`
                  flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${mode === m.key
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* 按部门：部门选择器（在设备列表上方） */}
        {mode === "department" && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap">选择部门</label>
            <Select value={selectedDepartmentId} onValueChange={(v) => {
              setSelectedDepartmentId(v);
              setSelectedIds(new Set());
              setPreviewed(false);
              setLabels([]);
            }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="请选择部门" />
              </SelectTrigger>
              <SelectContent>
                {departments.length === 0 ? (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                    暂无部门数据
                  </div>
                ) : (
                  departments.map((dept) => (
                    <SelectItem key={dept.id} value={String(dept.id)}>
                      {dept.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 按设备/按部门模式：显示可选设备列表 */}
        {(mode === "asset" || mode === "department") && (
          <div className="bg-card border rounded-xl overflow-hidden">
            {/* 列表头部 */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
              <span className="text-sm font-medium">设备列表</span>
              <span className="text-sm text-muted-foreground">
                已选 <span className="font-medium text-foreground">{selectedIds.size}</span> / {selectableAssets.length} 台设备
              </span>
            </div>

            {/* 设备表格 */}
            {selectableAssets.length === 0 ? (
              <div className="py-12 text-center">
                <Monitor className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {mode === "department" && !selectedDepartmentId
                    ? "请先选择部门"
                    : mode === "department"
                      ? "该部门暂无设备"
                      : "暂无设备数据"}
                </p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px] text-center">
                        <Checkbox
                          checked={
                            selectedIds.size === selectableAssets.length
                              ? true
                              : selectedIds.size > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="text-center">编号</TableHead>
                      <TableHead className="text-center">名称</TableHead>
                      <TableHead className="text-center">状态</TableHead>
                      <TableHead className="text-center">使用人</TableHead>
                      <TableHead className="text-center">部门</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectableAssets.map((asset) => {
                      const status = STATUS_MAP[asset.status] ?? { label: asset.status, variant: "secondary" as const };
                      const isSelected = selectedIds.has(asset.id);
                      return (
                        <TableRow
                          key={asset.id}
                          className={`cursor-pointer ${isSelected ? "bg-primary/5 hover:bg-primary/5" : ""}`}
                          onClick={() => handleToggleAsset(asset.id)}
                        >
                          <TableCell className="text-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleToggleAsset(asset.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </TableCell>
                          <TableCell className="text-center font-mono font-medium text-primary">
                            {asset.assetNo}
                          </TableCell>
                          <TableCell className="text-center">{asset.name}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={status.variant} className="text-xs">
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">{asset.employeeName || "-"}</TableCell>
                          <TableCell className="text-center">{asset.departmentName || "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* 按员工模式 */}
        {mode === "employee" && (
          <div className="bg-card border rounded-xl p-5">
            <label className="text-sm font-medium block mb-3">选择员工</label>
            <SearchableSelect
              value={selectedEmployeeId}
              onValueChange={(v) => {
                setSelectedEmployeeId(v);
                setPreviewed(false);
                setLabels([]);
              }}
              placeholder="请选择员工"
              triggerClassName="w-full max-w-xs"
              options={[
                { value: "", label: "请选择员工" },
                ...employees.map((emp) => ({
                  value: String(emp.id),
                  label: `${emp.name}${emp.departmentName ? `（${emp.departmentName}）` : ""}`,
                })),
              ]}
            />
            {selectedEmployeeId && (
              <p className="text-xs text-muted-foreground mt-2">
                将生成该员工名下所有设备的标签
              </p>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-3">
          <Button onClick={handlePreview} disabled={!canPreview || loading} className="shadow-sm">
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Printer className="h-4 w-4 mr-2" />
            )}
            预览标签
          </Button>
          {previewed && labels.length > 0 && (
            <>
              <Button variant="outline" onClick={handlePrint} className="shadow-sm">
                <Printer className="h-4 w-4 mr-2" />
                打印
              </Button>
              <Button variant="outline" onClick={handleExportPDF} disabled={exporting} className="shadow-sm">
                {exporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4 mr-2" />
                )}
                导出 PDF
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                共 {labels.length} 个标签
              </span>
            </>
          )}
        </div>
      </div>

      {/* 标签预览区域 */}
      {previewed && labels.length > 0 && (
        <div className="space-y-4">
          <div className="print:hidden flex items-center justify-between">
            <h3 className="text-base font-semibold">标签预览</h3>
            <p className="text-sm text-muted-foreground">
              预览效果如下，点击上方按钮打印或导出
            </p>
          </div>
          <div id="label-print-area" className="grid grid-cols-3 gap-4 print:gap-0">
            {labels.map((label) => (
              <div
                key={label.assetNo}
                className="print:break-inside-avoid print:m-0 print:p-0"
              >
                {/* 屏幕预览样式 */}
                <div className="bg-white border border-border/50 rounded-lg shadow-sm p-4 print:hidden">
                  <LabelContent label={label} />
                </div>
                {/* 打印样式 */}
                <div className="hidden print:block p-3" style={{ width: "80mm", height: "40mm", boxSizing: "border-box" }}>
                  <LabelContent label={label} compact />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Label Content Component
// ============================================================

function LabelContent({ label, compact = false }: { label: LabelData; compact?: boolean }) {
  const hasComponents = label.components.length > 0;

  if (compact) {
    return (
      <div className="flex flex-col justify-center h-full text-xs">
        <div className="flex items-center justify-between border-b border-gray-200 pb-1 mb-1">
          <span className="font-bold font-mono">{label.assetNo}</span>
          <span className="text-gray-500">{label.departmentName}</span>
        </div>
        <div className="font-medium truncate">{label.name}</div>
        <div className="text-gray-500 mt-0.5">{label.employeeName || "-"}</div>
        {hasComponents && (
          <div className="mt-1 text-gray-400">
            {label.components.map((c) => c.modelName).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 头部：编号 + 部门 */}
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <p className="text-base font-mono font-bold text-primary tracking-wide">
            {label.assetNo}
          </p>
          <p className="text-sm font-semibold text-foreground">{label.name}</p>
        </div>
        {label.departmentName && (
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            {label.departmentName}
          </span>
        )}
      </div>

      {/* 中部：使用人 */}
      <div className="text-sm text-muted-foreground">
        {label.employeeName ? (
          <span>使用人：<span className="text-foreground font-medium">{label.employeeName}</span></span>
        ) : (
          <span className="text-muted-foreground/60">未分配</span>
        )}
      </div>

      {/* 底部：配件列表 */}
      {hasComponents && (
        <div className="pt-2 border-t border-border/40">
          <div className="flex flex-wrap gap-1">
            {label.components.slice(0, 4).map((comp, i) => (
              <span
                key={i}
                className="text-xs bg-muted px-1.5 py-0.5 rounded"
              >
                {comp.modelName}
                {comp.brand ? ` (${comp.brand})` : ""}
              </span>
            ))}
            {label.components.length > 4 && (
              <span className="text-xs text-muted-foreground px-1.5 py-0.5">
                +{label.components.length - 4}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
