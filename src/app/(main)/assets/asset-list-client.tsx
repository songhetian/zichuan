"use client";

import { downloadExcelFile } from "@/lib/excel-download";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useId,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge } from "@/components/features/status-badge";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { ExportPreview } from "@/components/features/export-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { CreateAssetDialog } from "./create-asset-dialog";
import { AssetHeaderActions, type AssetHeaderAction } from "./asset-header-actions";
import {
  Eye,
  Pencil,
  Trash2,
  Ban,
  Search,
  X,
  RotateCcw,
  UserPlus,
  Wrench,
  CheckCircle2,
  ArrowRightLeft,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { categoryDotClass } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
import { updateAsset, deleteAsset } from "@/actions/asset.actions";
import {
  returnAssets,
  scrapAssets,
  allocateAssets,
  allocateAssetsBatch,
  transferAssets,
  maintenanceStart,
  maintenanceComplete,
} from "@/actions/lifecycle.actions";
import {
  EmployeePicker,
  type PickerEmployee,
} from "@/components/features/employee-pick-list";
import { BatchAllocateDialog } from "@/components/features/batch-allocate-dialog";
import type { PairingCategory } from "@/lib/allocation-pairing";
import { exportAssetsToExcel, importAssetsFromExcel } from "@/actions/excel.actions";
import { importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { getMemoryGB, getDiskGB } from "@/lib/asset-filter";
import { filterByImportDate } from "@/lib/filter-by-import-date";
import type { ActionResult } from "@/lib/types";

// ============================================================
// Helpers
// ============================================================

// 生成配置摘要：提取 CPU 型号、内存总容量、硬盘总容量
// 内存 / 硬盘容量统计复用 @/lib/asset-filter，与列表筛选口径一致
function getConfigSummary(components: AssetComponent[]): { cpu: string; memory: string; disk: string } {
  let cpu = "";

  for (const comp of components) {
    const cat = comp.categoryName;
    const name = comp.modelName ?? "";

    if (cat === "CPU" || /i[35779]-\d|ryzen|intel core|amd/i.test(name)) {
      if (!cpu) {
        // 提取 CPU 简短型号：Intel i7-13700K / AMD Ryzen 7 5800X
        const intelMatch = name.match(/(i[35779]-\d{4,5}[A-Z]*)/i);
        const amdMatch = name.match(/(Ryzen \d \w+)/i);
        cpu = intelMatch ? intelMatch[1]
            : amdMatch ? amdMatch[1]
            : name.length > 12 ? name.substring(0, 12) + "…" : name;
      }
    }
  }

  const memoryTotal = getMemoryGB(components);
  const diskTotal = getDiskGB(components);

  return {
    cpu: cpu || "-",
    memory: memoryTotal > 0 ? `${memoryTotal}GB` : "-",
    disk: diskTotal > 0 ? (diskTotal >= 1000 ? `${(diskTotal / 1000).toFixed(diskTotal % 1000 === 0 ? 0 : 1)}TB` : `${diskTotal}GB`) : "-",
  };
}

// ============================================================
// Hover Preview Hook (300ms delay)
// ============================================================

function useHoverPreview(delay: number = 300) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, delay);
  }, [delay]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { isOpen, handleMouseEnter, handleMouseLeave };
}

// ============================================================
// Asset Preview Content
// ============================================================

function AssetPreviewContent({ asset }: { asset: AssetItem }) {
  return (
    <>
      <div className="p-3 border-b border-border">
        <div className="font-medium text-sm">{asset.assetNo}</div>
        <div className="text-xs text-muted-foreground">{asset.name} · {asset.categoryName}</div>
        {asset.templateName && (
          <div className="text-xs text-muted-foreground mt-0.5">模板：{asset.templateName}</div>
        )}
      </div>
      {asset.components.length > 0 ? (
        <div className="p-2">
          <div className="text-xs font-medium text-muted-foreground mb-1.5 px-1">配件配置</div>
          <div className="space-y-0.5">
            {asset.components.map((comp) => (
              <div key={comp.id} className="flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-muted/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground shrink-0 w-12 text-right">{comp.categoryName}</span>
                  <span className="truncate">{comp.modelName}</span>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  {comp.modelBrand && (
                    <span className="text-muted-foreground">{comp.modelBrand}</span>
                  )}
                  {comp.quantity > 1 && (
                    <span className="text-muted-foreground">×{comp.quantity}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-3 text-xs text-muted-foreground text-center">暂无配件配置</div>
      )}
    </>
  );
}

interface AssetComponent {
  id: number;
  modelId: number;
  modelName: string;
  modelBrand: string | null;
  categoryName: string;
  quantity: number;
}

interface AssetLifecycleLog {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  operator: string;
  remark: string | null;
  createdAt: Date;
}

interface AssetItem {
  id: number;
  assetNo: string;
  name: string;
  templateId: number;
  templateName: string;
  categoryId: number;
  categoryName: string;
  status: string;
  employeeId: number | null;
  employeeName: string | null;
  departmentName: string | null;
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  createdAt: Date | string;
  purchaseDate: Date | null;
  warrantyMonths: number | null;
  location: string | null;
  notes: string | null;
  components: AssetComponent[];
  lifecycleLogs: AssetLifecycleLog[];
}

interface AssetListClientProps {
  assets: AssetItem[];
  templates: { id: number; name: string; categoryId: number; brand?: string | null; model?: string | null; components: { modelId: number; modelName: string; modelBrand: string | null; quantity: number }[] }[];
  categories: { id: number; name: string; code: string; unique: boolean; parentId: number | null }[];
  employees: PickerEmployee[];
  departments: { id: number; name: string }[];
}

// ============================================================
// Edit Dialog
// ============================================================

interface EditAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: AssetItem | null;
}

function EditAssetDialog({ open, onOpenChange, asset }: EditAssetDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  // 打开时回填。open 由外部（设备操作上下文）驱动，Radix 在受控打开时
  // 不会回调 onOpenChange，因此不能在 onOpenChange 里做回填，必须监听 open。
  useEffect(() => {
    if (!open || !asset) return;
    setBrand(asset.brand ?? "");
    setModel(asset.model ?? "");
    setSerialNo(asset.serialNo ?? "");
    setNotes(asset.notes ?? "");
  }, [open, asset]);

  const handleSubmit = async () => {
    if (!asset) return;
    setLoading(true);
    try {
      const result = await updateAsset(asset.id, {
        brand: brand.trim() || null,
        model: model.trim() || null,
        serialNo: serialNo.trim() || null,
        notes: notes.trim() || null,
      });
      if (result.success) {
        toast({ variant: "success", title: "更新成功" });
        onOpenChange(false);
        router.refresh();
      } else {
        toast({ title: "更新失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑设备</DialogTitle>
          <DialogDescription>修改设备登记信息（品牌 / 型号 / 序列号 / 备注）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>设备名称</Label>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              {asset?.name ?? "-"}
            </div>
            <p className="text-xs text-muted-foreground">
              名称随归属由系统维护：分配 / 调拨后为「使用人的设备分类」，归还后恢复模板名，不支持手工修改。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-brand">品牌</Label>
              <Input id="edit-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="选填，如 戴尔" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-model">型号</Label>
              <Input id="edit-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="选填，如 U2723QE" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-serial">序列号</Label>
            <Input id="edit-serial" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="选填，设备序列号（不作唯一校验）" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">备注</Label>
            <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选备注信息" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={loading} onClick={handleSubmit}>
            {loading ? "保存中..." : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// 员工选择弹窗
// 结构由 AssignFrame 统一渲染；分配 / 调拨各自是一个显式变体组件，
// 只负责填本变体固定的话术（员工标签 / 按钮文案）与排除规则，调用方不再传这些模式参数
// ============================================================

interface AssignFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  employeeLabel: string;
  employeePlaceholder: string;
  confirmText: string;
  loadingText: string;
  employees: EmployeeOption[];
  departments: { id: number; name: string }[];
  /** 需要排除的员工（调拨时排除设备当前使用人） */
  excludeEmployeeId?: number | null;
  loading: boolean;
  onConfirm: (employeeId: number) => void;
}

function AssignFrame({
  open,
  onOpenChange,
  title,
  description,
  employeeLabel,
  employeePlaceholder,
  confirmText,
  loadingText,
  employees,
  departments,
  excludeEmployeeId,
  loading,
  onConfirm,
}: AssignFrameProps) {
  const fieldId = useId();
  const [employeeId, setEmployeeId] = useState<number | null>(null);

  // 关闭时清空选择（无论由按钮还是遮罩 / ESC 关闭），下次打开从空白开始
  useEffect(() => {
    if (!open) setEmployeeId(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={fieldId}>{employeeLabel}</Label>
          {/* 与批量场景共用同一个选择器：部门筛选、按部门分组、离职禁选保持一致 */}
          <EmployeePicker
            id={fieldId}
            employees={employees}
            departments={departments}
            value={employeeId}
            onValueChange={setEmployeeId}
            placeholder={employeePlaceholder}
            excludeIds={excludeEmployeeId != null ? [excludeEmployeeId] : undefined}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => employeeId != null && onConfirm(employeeId)}
            disabled={loading || employeeId == null}
          >
            {loading ? loadingText : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AssignVariantProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  employees: EmployeeOption[];
  departments: { id: number; name: string }[];
  loading: boolean;
  onConfirm: (employeeId: number) => void;
}

/** 分配设备：把闲置设备交给某员工 */
function AllocateDialog(props: AssignVariantProps) {
  return (
    <AssignFrame
      {...props}
      employeeLabel="选择员工"
      employeePlaceholder="请选择员工"
      confirmText="确认分配"
      loadingText="分配中..."
    />
  );
}

/** 调拨设备：把在用设备转给其他员工，排除当前使用人 */
function TransferDialog({
  excludeEmployeeId,
  ...props
}: AssignVariantProps & { excludeEmployeeId?: number | null }) {
  return (
    <AssignFrame
      {...props}
      employeeLabel="目标员工"
      employeePlaceholder="请选择目标员工"
      confirmText="确认调拨"
      loadingText="调拨中..."
      excludeEmployeeId={excludeEmployeeId}
    />
  );
}

// ============================================================
// 设备操作上下文（state / actions / meta）
// 行级与批量弹窗共用同一份状态与同一套业务动作，弹窗全局只渲染一份
// ============================================================

/** 行级动作：作用于单台设备 */
type RowAction =
  | "edit"
  | "return"
  | "scrap"
  | "delete"
  | "allocate"
  | "transfer"
  | "maintenance"
  | "maintenanceComplete";

/** 批量动作：作用于当前选中集合 */
type BatchAction =
  | "allocate"
  | "transfer"
  | "return"
  | "maintenance"
  | "maintenanceComplete"
  | "scrap"
  | "delete";

/** 显式变体：同一时刻至多一个弹窗可见，从状态层面消除「多个弹窗同时打开」这类不可能状态 */
type ActiveDialog =
  | { scope: "row"; kind: RowAction; asset: AssetItem }
  | { scope: "batch"; kind: BatchAction }
  | null;

/** 员工选择器用的最小员工信息：与批量配对引擎共用同一个结构，避免两套类型互转 */
type EmployeeOption = PickerEmployee;

interface AssetActionsState {
  dialog: ActiveDialog;
  loading: boolean;
  selection: AssetItem[];
  /** 按状态机 R2 预筛后的可执行集合：只对符合条件的设备生效 */
  eligible: Record<BatchAction, AssetItem[]>;
}

interface AssetActionsActions {
  setSelection: (rows: AssetItem[]) => void;
  openRow: (kind: RowAction, asset: AssetItem) => void;
  openBatch: (kind: BatchAction) => void;
  close: () => void;
}

interface AssetActionsMeta {
  employees: EmployeeOption[];
}

interface AssetActionsContextValue {
  state: AssetActionsState;
  actions: AssetActionsActions;
  meta: AssetActionsMeta;
}

const AssetActionsContext = createContext<AssetActionsContextValue | null>(null);

function useAssetActions() {
  const ctx = useContext(AssetActionsContext);
  if (!ctx) throw new Error("useAssetActions 必须在 AssetActionsProvider 内使用");
  return ctx;
}

function AssetActionsProvider({
  employees,
  departments,
  categories,
  assets,
  children,
}: {
  employees: EmployeeOption[];
  departments: { id: number; name: string }[];
  categories: PairingCategory[];
  /** 全量资产：批量分配要拿它做「目标员工是否已持有同唯一分类设备」的预校验 */
  assets: AssetItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [selection, setSelection] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => setDialog(null), []);
  const openRow = useCallback(
    (kind: RowAction, asset: AssetItem) => setDialog({ scope: "row", kind, asset }),
    []
  );
  const openBatch = useCallback((kind: BatchAction) => setDialog({ scope: "batch", kind }), []);

  // 批量动作按状态机 R2 预筛：只对符合条件的设备生效；预占（RESERVED）不参与任何人工流转
  const eligible = useMemo(() => {
    const pick = (pred: (s: string) => boolean) => selection.filter((a) => pred(a.status));
    return {
      allocate: pick((s) => s === "IDLE"),
      return: pick((s) => s === "IN_USE"),
      transfer: pick((s) => s === "IN_USE"),
      maintenance: pick((s) => s === "IDLE" || s === "IN_USE"),
      maintenanceComplete: pick((s) => s === "IN_MAINTENANCE"),
      scrap: pick((s) => s !== "SCRAPPED" && s !== "RESERVED"),
      delete: pick((s) => s !== "RESERVED"),
    };
  }, [selection]);

  // 成功后统一收口：关弹窗 → 批量再清空选择 → 刷新服务端数据
  const finish = useCallback(
    (batch: boolean) => {
      setDialog(null);
      if (batch) setSelection([]);
      router.refresh();
    },
    [router]
  );

  /**
   * 业务动作的执行壳：单条与批量只在 remark / 文案 / 关闭时机上不同，逻辑只写一次。
   * closeOn 保留原有交互差异：确认类弹窗无论成败都关，员工选择弹窗仅成功才关。
   */
  const run = useCallback(
    async (
      perform: () => Promise<ActionResult<unknown>>,
      options: { batch: boolean; ok: string; fail: string; closeOn: "always" | "success" }
    ) => {
      setLoading(true);
      try {
        const result = await perform();
        if (result.success) {
          toast({ variant: "success", title: options.ok });
          finish(options.batch);
        } else {
          toast({ title: options.fail, description: result.error, variant: "destructive" });
          if (options.closeOn === "always") setDialog(null);
        }
      } catch {
        toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
        if (options.closeOn === "always") setDialog(null);
      } finally {
        setLoading(false);
      }
    },
    [toast, finish]
  );

  const ids = (assets: AssetItem[]) => assets.map((a) => a.id);
  // 确认类操作：单条无论成败都关闭、批量仅成功才关闭（均为原有交互）
  const confirmClose = (batch: boolean): "always" | "success" => (batch ? "success" : "always");

  const handleReturn = (assets: AssetItem[], batch: boolean) =>
    run(
      () =>
        returnAssets({
          assetIds: ids(assets),
          operator: "admin",
          remark: batch ? "批量归还" : "列表快捷归还",
        }),
      {
        batch,
        ok: batch ? "批量归还成功" : "归还成功",
        fail: batch ? "批量归还失败" : "归还失败",
        closeOn: confirmClose(batch),
      }
    );

  const handleScrap = (assets: AssetItem[], batch: boolean) =>
    run(
      () =>
        scrapAssets({
          assetIds: ids(assets),
          operator: "admin",
          remark: batch ? "批量报废" : "手动报废",
        }),
      {
        batch,
        ok: batch ? "批量报废成功" : "报废成功",
        fail: batch ? "批量报废失败" : "报废失败",
        closeOn: confirmClose(batch),
      }
    );

  const handleMaintenance = (assets: AssetItem[], batch: boolean) =>
    run(
      () =>
        maintenanceStart({
          assetIds: ids(assets),
          operator: "admin",
          remark: batch ? "批量送修" : undefined,
        }),
      {
        batch,
        ok: batch ? "批量送修成功" : "送修成功",
        fail: batch ? "批量送修失败" : "送修失败",
        closeOn: confirmClose(batch),
      }
    );

  const handleMaintenanceComplete = (assets: AssetItem[], batch: boolean) =>
    run(() => maintenanceComplete({ assetIds: ids(assets), operator: "admin" }), {
      batch,
      ok: batch ? "批量维修完成成功" : "维修完成",
      fail: batch ? "批量维修完成失败" : "操作失败",
      closeOn: confirmClose(batch),
    });

  const handleDelete = (asset: AssetItem) =>
    run(() => deleteAsset(asset.id), {
      batch: false,
      ok: "删除成功",
      fail: "删除失败",
      closeOn: "always",
    });

  // 单台分配走这里；批量分配改由 BatchAllocateDialog 调 allocateAssetsBatch（整批单事务）
  const handleAllocate = (assets: AssetItem[], employeeId: number) => {
    if (assets.length === 0) return;
    return run(
      () =>
        allocateAssets({
          assetIds: ids(assets),
          employeeId,
          operator: "admin",
          remark: "列表快捷分配",
        }),
      {
        batch: false,
        ok: "分配成功",
        fail: "分配失败",
        closeOn: "success",
      }
    );
  };

  const handleTransfer = (assets: AssetItem[], employeeId: number, batch: boolean) => {
    if (assets.length === 0) return;
    return run(
      () =>
        transferAssets({
          assetIds: ids(assets),
          toEmployeeId: employeeId,
          operator: "admin",
          remark: batch ? "批量调拨" : "列表快捷调拨",
        }),
      {
        batch,
        ok: batch ? "批量调拨成功" : "调拨成功",
        fail: batch ? "批量调拨失败" : "调拨失败",
        closeOn: "success",
      }
    );
  };

  // 批量删除逐台真删并按成败计数，不走 run 的统一文案
  const handleBatchDelete = async (assets: AssetItem[]) => {
    if (assets.length === 0) return;
    setLoading(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const a of assets) {
        const r = await deleteAsset(a.id);
        if (r.success) ok++;
        else fail++;
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
      finish(true);
      return;
    } finally {
      setLoading(false);
    }
    if (fail === 0) {
      toast({ variant: "success", title: `批量删除成功，共 ${ok} 台` });
    } else {
      toast({ title: `删除完成：${ok} 成功，${fail} 失败`, variant: "destructive" });
    }
    finish(true);
  };

  const rowAsset = dialog?.scope === "row" ? dialog.asset : null;
  const rowKind = dialog?.scope === "row" ? dialog.kind : null;
  const batchKind = dialog?.scope === "batch" ? dialog.kind : null;
  const rowNo = rowAsset?.assetNo ?? "";

  const actions = useMemo(
    () => ({ setSelection, openRow, openBatch, close }),
    [openRow, openBatch, close]
  );
  const value: AssetActionsContextValue = {
    state: { dialog, loading, selection, eligible },
    actions,
    meta: { employees },
  };

  return (
    <AssetActionsContext.Provider value={value}>
      {children}
      {/* 弹窗全局只渲染一份（行级 8 + 批量 7），取代原先「每行各挂 8 个」的 N 倍开销 */}
      <EditAssetDialog
        open={rowKind === "edit"}
        onOpenChange={(v) => !v && close()}
        asset={rowAsset}
      />
      <ConfirmDialog
        open={rowKind === "return"}
        onOpenChange={(v) => !v && close()}
        title="确认归还"
        description={`确定要归还设备「${rowNo}」吗？`}
        confirmText="归还"
        onConfirm={() => {
          if (rowAsset) return handleReturn([rowAsset], false);
        }}
      />
      <ConfirmDialog
        open={rowKind === "scrap"}
        onOpenChange={(v) => !v && close()}
        title="确认报废"
        description={`确定要报废设备「${rowNo}」吗？`}
        confirmText="报废"
        variant="destructive"
        onConfirm={() => {
          if (rowAsset) return handleScrap([rowAsset], false);
        }}
      />
      <ConfirmDialog
        open={rowKind === "delete"}
        onOpenChange={(v) => !v && close()}
        title="确认删除"
        description={`确定要永久删除设备「${rowNo}」吗？该操作将同时删除其全部配件与生命周期记录，不可恢复！`}
        confirmText="删除"
        variant="destructive"
        onConfirm={() => {
          if (rowAsset) return handleDelete(rowAsset);
        }}
      />
      <ConfirmDialog
        open={rowKind === "maintenance"}
        onOpenChange={(v) => !v && close()}
        title="确认送修"
        description={`确定要将设备「${rowNo}」送修吗？`}
        confirmText="送修"
        onConfirm={() => {
          if (rowAsset) return handleMaintenance([rowAsset], false);
        }}
      />
      <ConfirmDialog
        open={rowKind === "maintenanceComplete"}
        onOpenChange={(v) => !v && close()}
        title="确认维修完成"
        description={`设备「${rowNo}」维修完成了吗？`}
        confirmText="完成维修"
        onConfirm={() => {
          if (rowAsset) return handleMaintenanceComplete([rowAsset], false);
        }}
      />
      {/* 单台分配 / 单台调拨；批量分配另走 BatchAllocateDialog（多员工严格 1:1） */}
      <AllocateDialog
        open={rowKind === "allocate"}
        onOpenChange={(v) => !v && close()}
        title="分配设备"
        description="选择要分配的员工"
        employees={employees}
        departments={departments}
        loading={loading}
        onConfirm={(employeeId) => {
          if (rowAsset) handleAllocate([rowAsset], employeeId);
        }}
      />
      <TransferDialog
        open={rowKind === "transfer"}
        onOpenChange={(v) => !v && close()}
        title="调拨设备"
        description="将设备调拨给其他员工"
        employees={employees}
        departments={departments}
        excludeEmployeeId={rowAsset?.employeeId}
        loading={loading}
        onConfirm={(employeeId) => {
          if (rowAsset) handleTransfer([rowAsset], employeeId, false);
        }}
      />

      {/* 批量确认类弹窗 */}
      <ConfirmDialog
        open={batchKind === "return"}
        onOpenChange={(v) => !v && close()}
        title="确认批量归还"
        description={`确定要归还选中的 ${eligible.return.length} 台设备吗？`}
        confirmText="批量归还"
        onConfirm={() => handleReturn(eligible.return, true)}
      />
      <ConfirmDialog
        open={batchKind === "maintenance"}
        onOpenChange={(v) => !v && close()}
        title="确认批量送修"
        description={`确定要将选中的 ${eligible.maintenance.length} 台设备送修吗？`}
        confirmText="批量送修"
        onConfirm={() => handleMaintenance(eligible.maintenance, true)}
      />
      <ConfirmDialog
        open={batchKind === "maintenanceComplete"}
        onOpenChange={(v) => !v && close()}
        title="确认批量维修完成"
        description={`确定选中的 ${eligible.maintenanceComplete.length} 台设备已维修完成吗？完成后回到「闲置」，名称恢复为模板名。`}
        confirmText="批量维修完成"
        onConfirm={() => handleMaintenanceComplete(eligible.maintenanceComplete, true)}
      />
      <ConfirmDialog
        open={batchKind === "scrap"}
        onOpenChange={(v) => !v && close()}
        title="确认批量报废"
        description={`确定要报废选中的 ${eligible.scrap.length} 台设备吗？此操作不可撤销。`}
        confirmText="批量报废"
        variant="destructive"
        onConfirm={() => handleScrap(eligible.scrap, true)}
      />
      <ConfirmDialog
        open={batchKind === "delete"}
        onOpenChange={(v) => !v && close()}
        title="确认批量删除"
        description={`确定要永久删除选中的 ${eligible.delete.length} 台设备吗？将同时删除其全部配件与生命周期记录，不可恢复！`}
        confirmText="批量删除"
        variant="destructive"
        onConfirm={() => handleBatchDelete(eligible.delete)}
      />
      {/* 批量分配：多员工严格 1:1，整批单事务，冲突就地标出 */}
      <BatchAllocateDialog
        open={batchKind === "allocate"}
        onOpenChange={(v) => !v && close()}
        assets={eligible.allocate}
        excludedCount={selection.length - eligible.allocate.length}
        allAssets={assets}
        categories={categories}
        employees={employees}
        departments={departments}
        loading={loading}
        onConfirm={async (pairs) => {
          setLoading(true);
          try {
            const result = await allocateAssetsBatch({
              pairs,
              operator: "admin",
              remark: "批量分配",
            });
            if (result.success) {
              toast({
                variant: "success",
                title: `批量分配成功，共 ${result.data.allocatedCount} 台`,
              });
              finish(true);
              return [];
            }
            toast({ title: "批量分配失败", description: result.error, variant: "destructive" });
            return result.conflicts;
          } catch {
            toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
            return [];
          } finally {
            setLoading(false);
          }
        }}
      />
      <TransferDialog
        open={batchKind === "transfer"}
        onOpenChange={(v) => !v && close()}
        title="批量调拨设备"
        description={
          selection.length > eligible.transfer.length
            ? `将选中的 ${eligible.transfer.length} 台在用设备调拨给指定员工（另有 ${selection.length - eligible.transfer.length} 台不是「在用」状态，未纳入）`
            : `将选中的 ${eligible.transfer.length} 台设备调拨给指定员工`
        }
        employees={employees}
        departments={departments}
        loading={loading}
        onConfirm={(employeeId) => handleTransfer(eligible.transfer, employeeId, true)}
      />
    </AssetActionsContext.Provider>
  );
}

// ============================================================
// Action Buttons - 图标化（只负责触发，弹窗统一由 Provider 渲染）
// ============================================================

function ActionButtons({ asset }: { asset: AssetItem }) {
  const router = useRouter();
  const { actions } = useAssetActions();
  const canEdit = usePermission("asset.device.update");
  const canDelete = usePermission("asset.device.delete");
  // 分配/归还/调拨/送修/维修完成/报废在后端均要求 asset.manage
  const canManage = usePermission("asset.manage");
  const open = (kind: RowAction) => actions.openRow(kind, asset);

  return (
    <div className="flex items-center gap-0.5 justify-center">
      {/* 高频：查看配置始终可见，不藏进「更多」 */}
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="查看配置" aria-label="查看配置" onClick={() => router.push(`/assets/${asset.id}`)}>
        <Eye className="h-4 w-4" />
      </Button>
      {/* 编辑收进「更多」：行内只留 查看配置 + 状态流转按钮（≤4），控制在 176px 操作列预算内 */}
      {/* 状态流转按钮：按状态机 R2 的生命周期顺序排列（分配 → 归还 → 调拨 → 维修完成 → 送修），
          同一状态只会命中其中一项，行内最多 4 个图标 + 「更多」 */}
      {canManage && asset.status === "IDLE" && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10" title="分配" aria-label="分配" onClick={() => open("allocate")}>
          <UserPlus className="h-4 w-4" />
        </Button>
      )}
      {canManage && asset.status === "IN_USE" && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10" title="归还" aria-label="归还" onClick={() => open("return")}>
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
      {canManage && asset.status === "IN_USE" && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-violet hover:bg-violet/10" title="调拨" aria-label="调拨" onClick={() => open("transfer")}>
          <ArrowRightLeft className="h-4 w-4" />
        </Button>
      )}
      {canManage && asset.status === "IN_MAINTENANCE" && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-success hover:bg-success/10" title="维修完成" aria-label="维修完成" onClick={() => open("maintenanceComplete")}>
          <CheckCircle2 className="h-4 w-4" />
        </Button>
      )}
      {canManage && asset.status !== "SCRAPPED" && asset.status !== "IN_MAINTENANCE" && asset.status !== "RESERVED" && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-warning hover:bg-warning/10" title="送修" aria-label="送修" onClick={() => open("maintenance")}>
          <Wrench className="h-4 w-4" />
        </Button>
      )}
      {/* 低频 / 破坏性操作收进「更多」，避免遮挡高频操作；无溢出项时隐藏「更多」 */}
      {canEdit || (canManage && asset.status !== "SCRAPPED") || canDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="更多操作" aria-label="更多操作">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {/* 顺序：编辑（中性）→ 报废（警示）→ 删除（破坏），破坏性操作始终在最后 */}
            {canEdit && (
              <DropdownMenuItem onSelect={() => open("edit")}>
                <Pencil className="mr-2 h-4 w-4" />编辑
              </DropdownMenuItem>
            )}
            {canManage && asset.status !== "SCRAPPED" && asset.status !== "RESERVED" && (
              <DropdownMenuItem onSelect={() => open("scrap")} className="text-warning focus:text-warning">
                <Ban className="mr-2 h-4 w-4" />报废
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                onSelect={() => open("delete")}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// ============================================================
// Status Column - 纯状态显示
// ============================================================

function StatusCell({ asset }: { asset: AssetItem }) {
  return (
    <div className="flex items-center justify-center">
      <StatusBadge status={asset.status} />
    </div>
  );
}

// ============================================================
// Column Definitions
// ============================================================

// ============================================================
// Asset No Cell with Hover Preview
// ============================================================

function AssetNoCell({ asset }: { asset: AssetItem }) {
  const router = useRouter();
  const preview = useHoverPreview(300);

  return (
    <Popover open={preview.isOpen} onOpenChange={() => {}}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-center cursor-pointer group min-w-0"
          onClick={() => router.push(`/assets/${asset.id}`)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
          aria-label={`查看设备 ${asset.assetNo}（${asset.name}）详情`}
        >
          <div className="text-primary group-hover:underline truncate">{asset.assetNo}</div>
          <div className="text-muted-foreground text-xs truncate">{asset.name}</div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side="right"
        align="start"
        onMouseEnter={preview.handleMouseEnter}
        onMouseLeave={preview.handleMouseLeave}
      >
        <AssetPreviewContent asset={asset} />
      </PopoverContent>
    </Popover>
  );
}

function getColumns(): ColumnDef<AssetItem>[] {
  return [
    {
      id: "select",
      meta: { align: "center" as const },
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllRowsSelected() ||
            (table.getIsSomeRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
          aria-label="全选"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="选择行"
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
      minSize: 40,
      maxSize: 40,
    },
    {
      accessorKey: "assetNo",
      header: "编号/名称",
      size: 200,
      minSize: 180,
      cell: ({ row }) => <AssetNoCell asset={row.original} />,
    },
    {
      accessorKey: "categoryName",
      header: "分类",
      cell: ({ row }) => {
        const name = row.original.categoryName;
        if (!name) return <span className="text-muted-foreground text-xs">-</span>;
        return (
          <span className="inline-flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", categoryDotClass(name))} aria-hidden />
            <span>{name}</span>
          </span>
        );
      },
    },
    {
      accessorKey: "brand",
      header: "品牌",
      size: 120,
      cell: ({ row }) => row.original.brand || <span className="text-muted-foreground text-xs">-</span>,
    },
    {
      accessorKey: "model",
      header: "型号",
      size: 140,
      cell: ({ row }) => row.original.model || <span className="text-muted-foreground text-xs">-</span>,
    },
    {
      accessorKey: "serialNo",
      header: "序列号",
      size: 150,
      cell: ({ row }) => row.original.serialNo || <span className="text-muted-foreground text-xs">-</span>,
    },
    {
      id: "config",
      header: "配置",
      enableSorting: false,
      size: 180,
      minSize: 160,
      maxSize: 240,
      cell: ({ row }) => {
        const summary = getConfigSummary(row.original.components);
        const hasConfig = summary.cpu !== "-" || summary.memory !== "-" || summary.disk !== "-";
        if (!hasConfig) {
          return <span className="text-muted-foreground text-xs">-</span>;
        }
        return (
          <div className="text-xs text-center whitespace-nowrap overflow-hidden text-ellipsis">
            <span className="text-foreground/80">{summary.cpu}</span>
            <span className="text-muted-foreground"> / {summary.memory} / {summary.disk}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "employeeName",
      meta: { align: "center" as const },
      header: "使用人",
      cell: ({ row }) => {
        const asset = row.original;
        return (
          <div className="text-center">
            <div>{asset.employeeName ?? "-"}</div>
            {asset.departmentName && (
              <div className="text-muted-foreground text-xs">{asset.departmentName}</div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      meta: { align: "center" as const },
      header: "状态",
      cell: ({ row }) => <StatusCell asset={row.original} />,
    },
    {
      accessorKey: "createdAt",
      header: "创建时间",
      size: 170,
      cell: ({ row }) =>
        row.original.createdAt ? new Date(row.original.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-",
    },
    {
      id: "actions",
      meta: { align: "center" as const, sticky: "right" as const },
      header: "操作",
      size: 176,
      minSize: 168,
      cell: ({ row }) => {
        const asset = row.original;
        return <ActionButtons asset={asset} />;
      },
    },
  ];
}

// ============================================================
// 高级筛选栏（始终展示，不再折叠）
// ============================================================

interface AdvancedFilterBarProps {
  departmentFilter: string;
  employeeFilter: string;
  memoryMinGB: string;
  diskMinGB: string;
  onDepartmentChange: (v: string) => void;
  onEmployeeChange: (v: string) => void;
  onMemoryChange: (v: string) => void;
  onDiskChange: (v: string) => void;
  departments: { id: number; name: string }[];
  employees: { id: number; name: string; departmentName: string }[];
}

export function AdvancedFilterBar({
  departmentFilter,
  employeeFilter,
  memoryMinGB,
  diskMinGB,
  onDepartmentChange,
  onEmployeeChange,
  onMemoryChange,
  onDiskChange,
  departments,
  employees,
}: AdvancedFilterBarProps) {
  return (
    <>
      <SearchableSelect
        value={departmentFilter}
        onValueChange={onDepartmentChange}
        placeholder="全部部门"
        triggerClassName="w-[140px]"
        options={[
          { value: "all", label: "全部部门" },
          { value: "none", label: "未分配部门" },
          ...departments.map((d) => ({ value: d.id.toString(), label: d.name })),
        ]}
      />
      <SearchableSelect
        value={employeeFilter}
        onValueChange={onEmployeeChange}
        placeholder="全部员工"
        triggerClassName="w-[150px]"
        options={[
          { value: "all", label: "全部员工" },
          { value: "none", label: "未分配" },
          ...employees.map((e) => ({ value: e.id.toString(), label: `${e.name}（${e.departmentName}）` })),
        ]}
      />
      <Input
        type="number"
        placeholder="内存≥ GB"
        value={memoryMinGB}
        onChange={(e) => onMemoryChange(e.target.value)}
        className="w-[120px]"
        min="0"
      />
      <Input
        type="number"
        placeholder="硬盘≥ GB"
        value={diskMinGB}
        onChange={(e) => onDiskChange(e.target.value)}
        className="w-[120px]"
        min="0"
      />
    </>
  );
}

// ============================================================
// Main Component
// ============================================================

/** 列表页外壳：注入设备操作上下文，页面内容统一通过 state/actions/meta 消费 */
export function AssetListClient(props: AssetListClientProps) {
  return (
    <AssetActionsProvider
      employees={props.employees}
      departments={props.departments}
      categories={props.categories}
      assets={props.assets}
    >
      <AssetListContent {...props} />
    </AssetActionsProvider>
  );
}

function AssetListContent({
  assets,
  templates,
  categories,
  departments,
}: AssetListClientProps) {
  const { state, actions, meta } = useAssetActions();
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  // 默认收起低频列（序列号）。品牌/型号默认展示
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(["serialNo"]);
  const [memoryMinGB, setMemoryMinGB] = useState<string>("");
  const [diskMinGB, setDiskMinGB] = useState<string>("");
  const [importFrom, setImportFrom] = useState<string>("");
  const [importTo, setImportTo] = useState<string>("");
  const [pending, setPending] = useState<AssetHeaderAction | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "selected">("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoImportFileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 状态流转与批量流转动作在后端统一要求 asset.manage，前端同门控，避免无权限用户点了才报错
  const canManage = usePermission("asset.manage");
  const canDeleteAsset = usePermission("asset.device.delete");

  // 从 URL 参数初始化筛选状态
  useEffect(() => {
    const status = searchParams.get("status");
    if (status && ["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED", "RESERVED"].includes(status)) {
      setStatusFilter(status);
    }
  }, [searchParams]);

  const columns = getColumns().filter((c) => {
    const id = c.id ?? (c as { accessorKey?: string }).accessorKey ?? "";
    return !hiddenColumns.includes(id);
  });

  // 列显隐控件（品牌 / 型号 / 序列号）
  const columnControlOptions = [
    { id: "brand", label: "品牌" },
    { id: "model", label: "型号" },
    { id: "serialNo", label: "序列号" },
  ].map((opt) => ({ ...opt, visible: !hiddenColumns.includes(opt.id) }));

  // RSC 每次刷新都会把资产数据重新序列化成全新对象（行含 components/lifecycleLogs
  // 嵌套数组，TanStack 的一层浅比较识别不了「新对象、同内容」）→ data 引用必变 →
  // autoResetPageIndex 把用户打回第 1 页。按内容签名复用旧行对象：
  // 内容没变的行保持旧引用 → 浅比较通过 → 不重算；真变的行换新对象，正常重算。
  const prevAssetsRef = useRef(new Map<number, { sig: string; row: AssetItem }>());
  const stableAssets = useMemo(() => {
    const nextCache = new Map<number, { sig: string; row: AssetItem }>();
    const result = assets.map((asset) => {
      const sig = JSON.stringify(asset);
      const prev = prevAssetsRef.current.get(asset.id);
      const row = prev && prev.sig === sig ? prev.row : asset;
      nextCache.set(asset.id, { sig, row });
      return row;
    });
    prevAssetsRef.current = nextCache;
    return result;
  }, [assets]);
  // ⚠️ 结果数组必须 useMemo，且要做「数组级引用稳定」：TanStack 对 data 用逐项
  // Object.is 比较（memo 实现 deps[index] !== dep），任何新数组引用都会重算并
  // 触发 autoResetPageIndex。行级由 stableAssets 保证「同内容=同对象」，
  // 这里再把浅等的结果数组换成上一次的引用，彻底杜绝误重置。
  const prevFilteredRef = useRef<AssetItem[] | null>(null);
  const filteredAssets = useMemo(() => {
  // 构建部门名 -> ID 的映射，用于筛选
  const departmentNameMap = new Map(departments.map((d) => [d.name, d.id]));
  const result = stableAssets.filter((asset) => {
    const matchStatus = statusFilter === "all" || asset.status === statusFilter;
    const matchDepartment =
      departmentFilter === "all" ||
      (asset.departmentName && departmentNameMap.get(asset.departmentName) === Number(departmentFilter)) ||
      (!asset.departmentName && departmentFilter === "none");
    const matchCategory = categoryFilter === "all" || asset.categoryId === Number(categoryFilter);
    const matchEmployee =
      employeeFilter === "all" ||
      (asset.employeeId && asset.employeeId === Number(employeeFilter)) ||
      (!asset.employeeId && employeeFilter === "none");
    const matchKeyword =
      !keyword ||
      asset.assetNo.toLowerCase().includes(keyword.toLowerCase()) ||
      asset.name.toLowerCase().includes(keyword.toLowerCase()) ||
      (asset.brand ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
      (asset.model ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
      (asset.serialNo ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
      (asset.employeeName ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
      asset.components.some((c) =>
        (c.modelName ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
        (c.modelBrand ?? "").toLowerCase().includes(keyword.toLowerCase())
      );
    
    // 内存容量筛选（按配件分类名判定，与配置摘要口径一致）
    let matchMemory = true;
    if (memoryMinGB) {
      const minGB = parseFloat(memoryMinGB);
      if (!isNaN(minGB)) {
        matchMemory = getMemoryGB(asset.components) >= minGB;
      }
    }

    // 硬盘容量筛选
    let matchDisk = true;
    if (diskMinGB) {
      const minGB = parseFloat(diskMinGB);
      if (!isNaN(minGB)) {
        matchDisk = getDiskGB(asset.components) >= minGB;
      }
    }

    // 导入时间筛选（createdAt 在 [importFrom, importTo] 闭区间）
    const matchImportDate = filterByImportDate([asset], {
      from: importFrom || null,
      to: importTo || null,
    }).length > 0;

    return (
      matchStatus &&
      matchDepartment &&
      matchCategory &&
      matchEmployee &&
      matchKeyword &&
      matchMemory &&
      matchDisk &&
      matchImportDate
    );
  });
  const prevFiltered = prevFilteredRef.current;
  if (
    prevFiltered &&
    prevFiltered.length === result.length &&
    prevFiltered.every((row, i) => row === result[i])
  ) {
    return prevFiltered;
  }
  prevFilteredRef.current = result;
  return result;
  }, [
    stableAssets,
    statusFilter,
    departmentFilter,
    categoryFilter,
    employeeFilter,
    keyword,
    memoryMinGB,
    diskMinGB,
    importFrom,
    importTo,
    departments,
  ]);

  const handleExport = async (selectedFields: string[]) => {
    setPending("export");
    try {
      const assetIds =
        exportMode === "selected" ? state.selection.map((a) => a.id) : undefined;
      const result = await exportAssetsToExcel(selectedFields, assetIds);
      if (result.success) {
        downloadExcelFile(result.data.fileName, result.data.buffer);
        toast({ variant: "success", title: "导出成功" });
        setExportPreviewOpen(false);
      } else {
        toast({ title: "导出失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导出失败", variant: "destructive" });
    }
    setPending(null);
  };

  // 准备导出数据（按导出模式决定范围：全部筛选结果 or 仅选中）
  const exportSource = exportMode === "selected" ? state.selection : filteredAssets;
  const exportData = exportSource.map((asset) => ({
    assetNo: asset.assetNo,
    name: asset.name,
    categoryName: asset.categoryName,
    templateName: asset.templateName,
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serialNo: asset.serialNo ?? "",
    status: asset.status,
    employeeName: asset.employeeName,
    departmentName: asset.departmentName,
    location: asset.location,
  }));

  const exportColumns = [
    { key: "assetNo", label: "设备编号" },
    { key: "name", label: "设备名称" },
    { key: "categoryName", label: "分类" },
    { key: "templateName", label: "模板" },
    { key: "brand", label: "品牌" },
    { key: "model", label: "型号" },
    { key: "serialNo", label: "序列号" },
    { key: "status", label: "状态" },
    { key: "employeeName", label: "使用人" },
    { key: "departmentName", label: "部门" },
    { key: "location", label: "位置" },
  ];

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPending("import");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Array.from(new Uint8Array(arrayBuffer));
      const result = await importAssetsFromExcel({ buffer });
      if (result.success) {
        const { importedCount, errors = [] } = result.data;
        if (Array.isArray(errors) && errors.length > 0) {
          toast({
            title: `导入完成，成功 ${importedCount} 条，${errors.length} 条有误`,
            description: errors.slice(0, 3).join("；") + (errors.length > 3 ? "..." : ""),
            variant: "warning",
          });
        } else {
          toast({ variant: "success", title: `导入成功，共 ${importedCount} 条` });
        }
        router.refresh();
      } else {
        toast({ title: "导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    }
    setPending(null);
    // 重置 file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 自动导入（Excel格式，来自硬件扫描脚本）
  const handleAutoImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPending("autoImport");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Array.from(new Uint8Array(arrayBuffer));

      const result = await importAssetsFromExcelAuto({ buffer });
      if (result.success) {
        const { importedCount, errors = [], details } = result.data;
        if (Array.isArray(errors) && errors.length > 0) {
          toast({
            title: `自动导入完成，成功 ${importedCount} 条，${errors.length} 条有误`,
            description: errors.slice(0, 3).join("；") + (errors.length > 3 ? "..." : ""),
            variant: "warning",
          });
        } else {
          toast({ variant: "success", title: `自动导入成功，共 ${importedCount} 条` });
        }
        router.refresh();
      } else {
        toast({ title: "自动导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "自动导入失败", description: "Excel文件解析失败", variant: "destructive" });
    }
    setPending(null);
    if (autoImportFileRef.current) {
      autoImportFileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备管理"
        description="管理所有设备资产信息"
        action={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImport}
            />
            <input
              ref={autoImportFileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleAutoImport}
            />
            <AssetHeaderActions
            hasSelection={state.selection.length > 0}
            pending={pending}
            onCreate={() => setCreateOpen(true)}
            onExportAll={() => { setExportMode("all"); setExportPreviewOpen(true); }}
            onExportSelected={() => { setExportMode("selected"); setExportPreviewOpen(true); }}
            onImportClick={() => fileInputRef.current?.click()}
            onAutoImportClick={() => autoImportFileRef.current?.click()}
          />
          </>
        }
      />

      {/* 批量操作栏 */}
      {state.selection.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
          <span className="text-sm font-medium">
            已选择 {state.selection.length} 项
          </span>
          {/* 取消选择紧挨计数，作为退出选择的出口，避免落在破坏性操作之后 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.setSelection([])}
          >
            取消选择
          </Button>
          {/* 操作区按状态机 R2 顺序排列（分配 → 归还 → 调拨 → 送修 → 报废），破坏性操作（删除）收尾 */}
          <div className="flex items-center gap-2 ml-auto">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openBatch("allocate")}
                  disabled={state.loading || state.eligible.allocate.length === 0}
                  title={state.eligible.allocate.length === 0 ? "所选设备中没有「闲置」设备" : undefined}
                >
                  <UserPlus className="mr-1 h-3 w-3" />
                  批量分配
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openBatch("return")}
                  disabled={state.loading || state.eligible.return.length === 0}
                  title={state.eligible.return.length === 0 ? "所选设备中没有「在用」设备" : undefined}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  批量归还
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openBatch("transfer")}
                  disabled={state.loading || state.eligible.transfer.length === 0}
                  title={state.eligible.transfer.length === 0 ? "所选设备中没有「在用」设备" : undefined}
                >
                  <ArrowRightLeft className="mr-1 h-3 w-3" />
                  批量调拨
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openBatch("maintenance")}
                  disabled={state.loading || state.eligible.maintenance.length === 0}
                  title={state.eligible.maintenance.length === 0 ? "所选设备中没有可送修的「闲置 / 在用」设备" : undefined}
                >
                  <Wrench className="mr-1 h-3 w-3" />
                  批量送修
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openBatch("maintenanceComplete")}
                  disabled={state.loading || state.eligible.maintenanceComplete.length === 0}
                  title={state.eligible.maintenanceComplete.length === 0 ? "所选设备中没有「维修中」设备" : undefined}
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  批量维修完成
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => actions.openBatch("scrap")}
                  disabled={state.loading || state.eligible.scrap.length === 0}
                  title={state.eligible.scrap.length === 0 ? "所选设备中没有可报废的设备（已报废 / 预占不可报废）" : undefined}
                >
                  <Ban className="mr-1 h-3 w-3" />
                  批量报废
                </Button>
              </>
            )}
            {canDeleteAsset && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.openBatch("delete")}
                disabled={state.loading || state.eligible.delete.length === 0}
                title={state.eligible.delete.length === 0 ? "所选设备均为预占（在途审批），不可删除" : undefined}
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-1 h-3 w-3" />
                批量删除
              </Button>
            )}
          </div>
        </div>
      )}
      {/* 筛选栏：搜索 + 状态 + 分类 + 高级筛选（同一行） */}
      <div data-testid="filter-toolbar" className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索编号、名称、品牌、型号、序列号或使用人..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pl-9 pr-8"
          />
          {keyword && (
            <button aria-label="清除搜索"
              type="button"
              onClick={() => setKeyword("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="全部状态"
          triggerClassName="w-[120px]"
          options={[
            { value: "all", label: "全部状态" },
            { value: "IDLE", label: "闲置" },
            { value: "IN_USE", label: "在用" },
            { value: "IN_MAINTENANCE", label: "维修中" },
            { value: "SCRAPPED", label: "报废" },
            { value: "RESERVED", label: "预占" },
          ]}
        />
        <SearchableSelect
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          placeholder="全部分类"
          triggerClassName="w-[140px]"
          options={[
            { value: "all", label: "全部分类" },
            ...categories.map((c) => ({ value: c.id.toString(), label: c.name })),
          ]}
        />
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground whitespace-nowrap">导入时间</span>
          <Input
            type="date"
            value={importFrom}
            onChange={(e) => setImportFrom(e.target.value)}
            className="w-[150px]"
            aria-label="导入时间起"
          />
          <span className="text-sm text-muted-foreground">至</span>
          <Input
            type="date"
            value={importTo}
            onChange={(e) => setImportTo(e.target.value)}
            className="w-[150px]"
            aria-label="导入时间止"
          />
        </div>
        <AdvancedFilterBar
          departmentFilter={departmentFilter}
          employeeFilter={employeeFilter}
          memoryMinGB={memoryMinGB}
          diskMinGB={diskMinGB}
          onDepartmentChange={setDepartmentFilter}
          onEmployeeChange={setEmployeeFilter}
          onMemoryChange={setMemoryMinGB}
          onDiskChange={setDiskMinGB}
          departments={departments}
          employees={meta.employees}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 ml-auto text-muted-foreground" title="设置表格显示列">
              <Eye className="mr-1 h-3.5 w-3.5" />
              列设置
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56">
            <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">显示列</div>
            <div className="space-y-0.5">
              {columnControlOptions.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/40"
                >
                  <Checkbox
                    aria-label={`列显隐-${opt.label}`}
                    checked={opt.visible}
                    onCheckedChange={(v) =>
                      setHiddenColumns((prev) =>
                        v
                          ? prev.filter((id) => id !== opt.id)
                          : prev.includes(opt.id)
                          ? prev
                          : [...prev, opt.id]
                      )
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <DataTable
        columns={columns}
        data={filteredAssets}
        enableRowSelection={true}
        onRowSelectionChange={actions.setSelection}
        defaultSorting={[{ id: "createdAt", desc: true }]}
      />
      <CreateAssetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        categories={categories}
        employees={meta.employees}
      />

      {/* 导出预览对话框 */}
      <ExportPreview
        open={exportPreviewOpen}
        onOpenChange={setExportPreviewOpen}
        data={exportData}
        columns={exportColumns}
        onExport={handleExport}
        loading={pending === "export"}
      />
    </div>
  );
}