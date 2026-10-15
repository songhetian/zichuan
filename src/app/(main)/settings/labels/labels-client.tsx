"use client";

import { useState, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmployeePicker, type EmployeeOption } from "@/components/ui/employee-picker";
import { AssetLabel } from "@/components/features/asset-label";
import {
  LABEL_WIDTH_MM,
  LABEL_HEIGHT_MM,
  LABEL_CODE_FONT_PX,
  PX_PER_MM,
  EXPORT_PAGE_MARGIN_MM,
  EXPORT_GAP_MM,
  EXPORT_SHEET_PADDING_MM,
  EXPORT_SHEET_WIDTH_MM,
  EXPORT_ROWS_PER_PAGE,
  paginateForExport,
  mmToPx,
} from "@/lib/label-size";
import { filterByDateKey, formatImportDateTime } from "@/lib/import-date";
import {
  Printer,
  Loader2,
  FileDown,
  Monitor,
  Users,
  Building2,
  CalendarDays,
  X,
} from "lucide-react";
import { generateLabelData } from "@/actions/label.actions";
import html2canvas from "html2canvas-pro";
import jsPDF from "jspdf";

// ============================================================
// Types
// ============================================================

/**
 * 标签外框尺寸（预览与打印共用）：尺寸来自 lib/label-size.ts，
 * 改一处两边同时生效，避免「预览一个尺寸、打印另一个尺寸」。
 */
const LABEL_BOX_STYLE = {
  width: `${LABEL_WIDTH_MM}mm`,
  height: `${LABEL_HEIGHT_MM}mm`,
  boxSizing: "border-box",
} as const;

interface AssetItem {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  employeeName: string;
  departmentName: string;
  /** 导入时间（ISO 字符串）—— 用于列表展示与「按导入日期筛选」 */
  createdAt: string;
}

// 与全站选人控件共用同一形状（含 employeeNo / departmentId，供部门筛选使用）
type EmployeeItem = EmployeeOption;

interface DepartmentItem {
  id: number;
  name: string;
}

interface LabelData {
  id: number;
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
  /** 按导入日期筛选（本地时区的 YYYY-MM-DD；空串=全部） */
  const [importDate, setImportDate] = useState<string>("");
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 导出 PDF 当前渲染的页码（null = 不在导出中）；离屏 sheet 按页渲染后截图 */
  const [exportPage, setExportPage] = useState<number | null>(null);
  const exportSheetRef = useRef<HTMLDivElement>(null);

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

  // 再叠加「导入日期」筛选：列表、全选、计数都以筛选后的结果为准
  const visibleAssets = useMemo(
    () => filterByDateKey(selectableAssets, importDate),
    [selectableAssets, importDate]
  );

  // 切换导入日期时清空已选，避免「选了 A 天的设备、却看着 B 天的列表」
  const handleImportDateChange = (value: string) => {
    setImportDate(value);
    setSelectedIds(new Set());
  };

  // 切换设备选择
  const handleToggleAsset = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 全选/取消全选（只作用于当前筛选后的列表）
  const handleSelectAll = () => {
    if (selectedIds.size === visibleAssets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleAssets.map((a) => a.id)));
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
  //
  // ⚠️ 不能直接截屏幕上的 #label-print-area：html2canvas 不支持 cqw 字号与
  // 容器查询（曾导致导出的 PDF 三列、字体错乱、编号被截成 "DN-DN8…"），
  // 且屏幕栅格宽度 ≠ 打印布局。因此导出走专用渲染：React 在离屏容器里
  // 按页渲染【固定 px 字号的两列 compact 标签】，再按 px→mm 精确映射贴入
  // A4 —— PDF 里每个标签就是 75×35mm，与打印完全一致。
  const handleExportPDF = async () => {
    if (labels.length === 0) return;

    setExporting(true);
    try {
      const pages = paginateForExport(labels);
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const xMm = (pageW - EXPORT_SHEET_WIDTH_MM) / 2; // 水平居中
      const SCALE = 2; // html2canvas 放大倍数，影响清晰度不影响几何

      for (let i = 0; i < pages.length; i++) {
        // flushSync 让离屏 sheet 在本帧同步出现，随后才能截图
        flushSync(() => setExportPage(i));
        const sheet = exportSheetRef.current;
        if (!sheet) throw new Error("导出容器未就绪");

        // 首页等字体加载完成；每页等双 rAF 确保布局与绘制完成
        if (i === 0 && document.fonts) await document.fonts.ready;
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );

        const canvas = await html2canvas(sheet, {
          scale: SCALE,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });

        if (i > 0) pdf.addPage();
        // canvas 是 2x 渲染：先除回 scale 再按 96dpi 换算成 mm，
        // 保证 PDF 里每个标签物理尺寸就是 75×35mm
        const wMm = canvas.width / SCALE / PX_PER_MM;
        const hMm = canvas.height / SCALE / PX_PER_MM;
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", xMm, EXPORT_PAGE_MARGIN_MM, wMm, hMm);
      }

      pdf.save("设备标签.pdf");
    } finally {
      setExportPage(null);
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
            {/* 列表头部：导入日期筛选 + 选中计数 */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-muted/30 border-b">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium whitespace-nowrap">设备列表</span>
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    type="date"
                    value={importDate}
                    onChange={(e) => handleImportDateChange(e.target.value)}
                    aria-label="按导入日期筛选"
                    title="只看这一天导入的设备"
                    className="h-8 w-[150px] text-sm"
                  />
                  {importDate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleImportDateChange("")}
                      className="h-8 px-2 text-xs text-muted-foreground"
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      清除
                    </Button>
                  )}
                </div>
              </div>
              <span className="text-sm text-muted-foreground">
                已选 <span className="font-medium text-foreground">{selectedIds.size}</span> /{" "}
                {visibleAssets.length} 台设备
                {importDate && (
                  <span className="ml-1">（共 {selectableAssets.length} 台）</span>
                )}
              </span>
            </div>

            {/* 设备表格 */}
            {visibleAssets.length === 0 ? (
              <div className="py-12 text-center">
                <Monitor className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {mode === "department" && !selectedDepartmentId
                    ? "请先选择部门"
                    : selectableAssets.length > 0 && importDate
                      ? `该日期没有导入的设备（共 ${selectableAssets.length} 台）`
                      : mode === "department"
                        ? "该部门暂无设备"
                        : "暂无设备数据"}
                </p>
                {selectableAssets.length > 0 && importDate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleImportDateChange("")}
                    className="mt-3"
                  >
                    清除日期筛选
                  </Button>
                )}
              </div>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px] text-center">
                        <Checkbox
                          checked={
                            selectedIds.size === visibleAssets.length
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
                      <TableHead className="text-center whitespace-nowrap">导入时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleAssets.map((asset) => {
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
                          <TableCell className="text-center whitespace-nowrap text-xs text-muted-foreground">
                            {formatImportDateTime(asset.createdAt)}
                          </TableCell>
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
            <EmployeePicker
              employees={employees}
              value={selectedEmployeeId}
              onValueChange={(v) => {
                setSelectedEmployeeId(v);
                setPreviewed(false);
                setLabels([]);
              }}
              placeholder="请选择员工"
              triggerClassName="w-full max-w-xs"
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
              共 {labels.length} 个标签 · {LABEL_WIDTH_MM} × {LABEL_HEIGHT_MM} mm
            </p>
          </div>
          {/*
            打印布局固定两列：A4 竖版可打印宽度约 190mm，两列 75mm + 间隙刚好
            铺满，标签能放多大放多大；若用三列会被浏览器整体缩放，反而更小。
            print: 变体必须能覆盖 lg:grid-cols-3（Tailwind 变体顺序中 print 在
            responsive 之后，同特异性后者胜出）。
          */}
          <div id="label-print-area" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 print:grid-cols-2 print:gap-3">
            {labels.map((label) => (
              <div
                key={label.assetNo}
                className="print:break-inside-avoid print:m-0 print:p-0"
              >
                {/* 屏幕预览：按标签真实物理尺寸显示（1mm ≈ 3.78px），所见即所得 */}
                <div
                  className="print:hidden mx-auto"
                  style={LABEL_BOX_STYLE}
                >
                  <AssetLabel label={label} />
                </div>
                {/* 打印样式：与预览同一尺寸 */}
                <div className="hidden print:block" style={LABEL_BOX_STYLE}>
                  <AssetLabel label={label} compact />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 导出 PDF 的离屏渲染容器：屏幕上不可见（fixed -10000px），
          按页渲染固定 px 字号的两列 compact 标签，供 html2canvas 逐页截图。
          几何全部来自 label-size.ts 的导出常量，与打印布局同源。 */}
      {exportPage != null && (
        <div
          ref={exportSheetRef}
          aria-hidden
          style={{
            position: "fixed",
            left: -10000,
            top: 0,
            background: "#ffffff",
            boxSizing: "border-box",
            width: mmToPx(EXPORT_SHEET_WIDTH_MM),
            padding: mmToPx(EXPORT_SHEET_PADDING_MM),
            display: "grid",
            gridTemplateColumns: `repeat(2, ${mmToPx(LABEL_WIDTH_MM)}px)`,
            columnGap: mmToPx(EXPORT_GAP_MM),
            rowGap: mmToPx(EXPORT_GAP_MM),
          }}
        >
          {paginateForExport(labels)[exportPage]?.map((label) => (
            <div
              key={label.assetNo}
              style={{ width: mmToPx(LABEL_WIDTH_MM), height: mmToPx(LABEL_HEIGHT_MM) }}
            >
              <AssetLabel label={label} compact fontPx={LABEL_CODE_FONT_PX} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
