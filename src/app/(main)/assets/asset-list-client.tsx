"use client";

import { downloadExcelFile } from "@/lib/excel-download";

import { useState, useRef, useEffect, useCallback } from "react";
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
import { AssetHeaderActions } from "./asset-header-actions";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  transferAssets,
  maintenanceStart,
  maintenanceComplete,
} from "@/actions/lifecycle.actions";
import { exportAssetsToExcel, importAssetsFromExcel } from "@/actions/excel.actions";
import { importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { getMemoryGB, getDiskGB } from "@/lib/asset-filter";
import { filterByImportDate } from "@/lib/filter-by-import-date";

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
  employees: { id: number; name: string; departmentName: string }[];
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
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const handleOpen = (v: boolean) => {
    if (v && asset) {
      setName(asset.name);
      setBrand(asset.brand ?? "");
      setModel(asset.model ?? "");
      setSerialNo(asset.serialNo ?? "");
      setNotes(asset.notes ?? "");
    }
    onOpenChange(v);
  };

  const handleSubmit = async () => {
    if (!asset) return;
    if (!name.trim()) {
      toast({ title: "设备名称不能为空", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await updateAsset(asset.id, {
        name: name.trim(),
        brand: brand.trim() || null,
        model: model.trim() || null,
        serialNo: serialNo.trim() || null,
        notes: notes.trim() || null,
      });
      if (result.success) {
        toast({ title: "更新成功" });
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
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑设备</DialogTitle>
          <DialogDescription>修改设备基本信息。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>设备名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入设备名称" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>品牌</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="选填，如 戴尔" />
            </div>
            <div className="space-y-2">
              <Label>型号</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="选填，如 U2723QE" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>序列号</Label>
            <Input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="选填，设备序列号（不作唯一校验）" />
          </div>
          <div className="space-y-2">
            <Label>备注</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选备注信息" rows={3} />
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
// Action Buttons - 图标化
// ============================================================

function ActionButtons({
  asset,
  employees,
}: {
  asset: AssetItem;
  employees: { id: number; name: string; departmentName: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const canEdit = usePermission("asset.device.update");
  const canDelete = usePermission("asset.device.delete");
  // 分配/归还/调拨/送修/维修完成/报废在后端均要求 asset.manage
  const canManage = usePermission("asset.manage");
  const [scrapOpen, setScrapOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [allocateEmployeeId, setAllocateEmployeeId] = useState("");
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceCompleteOpen, setMaintenanceCompleteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmployeeId, setTransferEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleScrap = async () => {
    try {
      const result = await scrapAssets({
        assetIds: [asset.id],
        operator: "admin",
        remark: "手动报废",
      });
      if (result.success) {
        toast({ title: "报废成功" });
        router.refresh();
      } else {
        toast({ title: "报废失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
    setScrapOpen(false);
  };

  const handleDelete = async () => {
    try {
      const result = await deleteAsset(asset.id);
      if (result.success) {
        toast({ title: "删除成功" });
        router.refresh();
      } else {
        toast({ title: "删除失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
    setDeleteOpen(false);
  };

  const handleReturn = async () => {
    try {
      const result = await returnAssets({
        assetIds: [asset.id],
        operator: "admin",
        remark: "列表快捷归还",
      });
      if (result.success) {
        toast({ title: "归还成功" });
        router.refresh();
      } else {
        toast({ title: "归还失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
    setReturnOpen(false);
  };

  const handleAllocate = async () => {
    if (!allocateEmployeeId) return;
    setLoading(true);
    try {
      const result = await allocateAssets({
        assetIds: [asset.id],
        employeeId: Number(allocateEmployeeId),
        operator: "admin",
        remark: "列表快捷分配",
      });
      if (result.success) {
        toast({ title: "分配成功" });
        setAllocateOpen(false);
        setAllocateEmployeeId("");
        router.refresh();
      } else {
        toast({ title: "分配失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleMaintenance = async () => {
    try {
      const result = await maintenanceStart({
        assetIds: [asset.id],
        operator: "admin",
      });
      if (result.success) {
        toast({ title: "送修成功" });
        router.refresh();
      } else {
        toast({ title: "送修失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
    setMaintenanceOpen(false);
  };

  const handleMaintenanceDone = async () => {
    try {
      const result = await maintenanceComplete({
        assetIds: [asset.id],
        operator: "admin",
      });
      if (result.success) {
        toast({ title: "维修完成" });
        router.refresh();
      } else {
        toast({ title: "操作失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
    setMaintenanceCompleteOpen(false);
  };

  const handleTransfer = async () => {
    if (!transferEmployeeId) return;
    setLoading(true);
    try {
      const result = await transferAssets({
        assetIds: [asset.id],
        toEmployeeId: Number(transferEmployeeId),
        operator: "admin",
        remark: "列表快捷调拨",
      });
      if (result.success) {
        toast({ title: "调拨成功" });
        setTransferOpen(false);
        setTransferEmployeeId("");
        router.refresh();
      } else {
        toast({ title: "调拨失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-0.5 justify-center">
        {canManage && asset.status === "IDLE" && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600" title="分配" aria-label="分配" onClick={() => setAllocateOpen(true)}>
            <UserPlus className="h-4 w-4" />
          </Button>
        )}
        {canManage && asset.status === "IN_USE" && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600" title="归还" aria-label="归还" onClick={() => setReturnOpen(true)}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        {canManage && asset.status === "IN_MAINTENANCE" && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600" title="维修完成" aria-label="维修完成" onClick={() => setMaintenanceCompleteOpen(true)}>
            <CheckCircle2 className="h-4 w-4" />
          </Button>
        )}
        {canManage && asset.status === "IN_USE" && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-cyan-500 hover:bg-cyan-50 hover:text-cyan-600" title="调拨" aria-label="调拨" onClick={() => setTransferOpen(true)}>
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
        )}
        {canManage && asset.status !== "SCRAPPED" && asset.status !== "IN_MAINTENANCE" && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-amber-500 hover:bg-amber-50 hover:text-amber-600" title="送修" aria-label="送修" onClick={() => setMaintenanceOpen(true)}>
            <Wrench className="h-4 w-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="更多操作" aria-label="更多操作">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onSelect={() => router.push(`/assets/${asset.id}`)}>
              <Eye className="mr-2 h-4 w-4 text-blue-500" />查看配置
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4 text-blue-500" />编辑
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canManage && asset.status !== "SCRAPPED" && (
              <DropdownMenuItem onSelect={() => setScrapOpen(true)} className="text-orange-600 focus:text-orange-700">
                <Ban className="mr-2 h-4 w-4" />报废
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-red-600 focus:text-red-700"
              >
                <Trash2 className="mr-2 h-4 w-4" />删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <EditAssetDialog open={editOpen} onOpenChange={setEditOpen} asset={asset} />
      <ConfirmDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        title="确认归还"
        description={`确定要归还设备「${asset.assetNo}」吗？`}
        confirmText="归还"
        onConfirm={handleReturn}
      />
      <ConfirmDialog
        open={scrapOpen}
        onOpenChange={setScrapOpen}
        title="确认报废"
        description={`确定要报废设备「${asset.assetNo}」吗？`}
        confirmText="报废"
        variant="destructive"
        onConfirm={handleScrap}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要永久删除设备「${asset.assetNo}」吗？该操作将同时删除其全部配件与生命周期记录，不可恢复！`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={maintenanceOpen}
        onOpenChange={setMaintenanceOpen}
        title="确认送修"
        description={`确定要将设备「${asset.assetNo}」送修吗？`}
        confirmText="送修"
        onConfirm={handleMaintenance}
      />
      <ConfirmDialog
        open={maintenanceCompleteOpen}
        onOpenChange={setMaintenanceCompleteOpen}
        title="确认维修完成"
        description={`设备「${asset.assetNo}」维修完成了吗？`}
        confirmText="完成维修"
        onConfirm={handleMaintenanceDone}
      />
      <Dialog open={allocateOpen} onOpenChange={(v) => { if (!v) setAllocateEmployeeId(""); setAllocateOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>分配设备</DialogTitle>
            <DialogDescription>选择要分配的员工</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>选择员工</Label>
            <SearchableSelect
              value={allocateEmployeeId}
              onValueChange={setAllocateEmployeeId}
              placeholder="请选择员工"
              triggerClassName="w-full"
              options={employees.map((e) => ({
                value: e.id.toString(),
                label: `${e.name}（${e.departmentName}）`,
              }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAllocateEmployeeId(""); setAllocateOpen(false); }}>取消</Button>
            <Button onClick={handleAllocate} disabled={loading || !allocateEmployeeId}>
              {loading ? "分配中..." : "确认分配"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={(v) => { if (!v) setTransferEmployeeId(""); setTransferOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>调拨设备</DialogTitle>
            <DialogDescription>将设备调拨给其他员工</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>目标员工</Label>
            <SearchableSelect
              value={transferEmployeeId}
              onValueChange={setTransferEmployeeId}
              placeholder="请选择目标员工"
              triggerClassName="w-full"
              options={employees
                .filter((e) => e.id !== asset.employeeId)
                .map((e) => ({
                  value: e.id.toString(),
                  label: `${e.name}（${e.departmentName}）`,
                }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTransferEmployeeId(""); setTransferOpen(false); }}>取消</Button>
            <Button onClick={handleTransfer} disabled={loading || !transferEmployeeId}>
              {loading ? "调拨中..." : "确认调拨"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
        <div
          className="text-center cursor-pointer group min-w-0"
          onClick={() => router.push(`/assets/${asset.id}`)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
        >
          <div className="text-primary group-hover:underline truncate">{asset.assetNo}</div>
          <div className="text-muted-foreground text-xs truncate">{asset.name}</div>
        </div>
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

function getColumns(
  employees: { id: number; name: string; departmentName: string }[]
): ColumnDef<AssetItem>[] {
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
      accessorKey: "status",
      meta: { align: "center" as const },
      header: "状态",
      cell: ({ row }) => <StatusCell asset={row.original} />,
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
      accessorKey: "createdAt",
      header: "创建时间",
      size: 170,
      cell: ({ row }) =>
        row.original.createdAt ? new Date(row.original.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-",
    },
    {
      id: "actions",
      meta: { align: "center" as const },
      header: "操作",
      size: 176,
      minSize: 168,
      cell: ({ row }) => {
        const asset = row.original;
        return <ActionButtons asset={asset} employees={employees} />;
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

export function AssetListClient({
  assets,
  templates,
  categories,
  employees,
  departments,
}: AssetListClientProps) {
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
  const [exportLoading, setExportLoading] = useState(false);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"all" | "selected">("all");
  const [importLoading, setImportLoading] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<AssetItem[]>([]);
  const [batchAllocateOpen, setBatchAllocateOpen] = useState(false);
  const [batchReturnOpen, setBatchReturnOpen] = useState(false);
  const [batchScrapOpen, setBatchScrapOpen] = useState(false);
  const [batchTransferOpen, setBatchTransferOpen] = useState(false);
  const [batchMaintenanceOpen, setBatchMaintenanceOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchAllocateEmployeeId, setBatchAllocateEmployeeId] = useState("");
  const [batchTransferEmployeeId, setBatchTransferEmployeeId] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const [autoImportLoading, setAutoImportLoading] = useState(false);
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

  const columns = getColumns(employees).filter((c) => {
    const id = c.id ?? (c as { accessorKey?: string }).accessorKey ?? "";
    return !hiddenColumns.includes(id);
  });

  // 列显隐控件（品牌 / 型号 / 序列号）
  const columnControlOptions = [
    { id: "brand", label: "品牌" },
    { id: "model", label: "型号" },
    { id: "serialNo", label: "序列号" },
  ].map((opt) => ({ ...opt, visible: !hiddenColumns.includes(opt.id) }));

  // 构建部门名 -> ID 的映射，用于筛选
  const departmentNameMap = new Map(departments.map((d) => [d.name, d.id]));

  const filteredAssets = assets.filter((asset) => {
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

  const handleExport = async (selectedFields: string[]) => {
    setExportLoading(true);
    try {
      const assetIds =
        exportMode === "selected" ? selectedAssets.map((a) => a.id) : undefined;
      const result = await exportAssetsToExcel(selectedFields, assetIds);
      if (result.success) {
        downloadExcelFile(result.data.fileName, result.data.buffer);
        toast({ title: "导出成功" });
        setExportPreviewOpen(false);
      } else {
        toast({ title: "导出失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导出失败", variant: "destructive" });
    }
    setExportLoading(false);
  };

  // 准备导出数据（按导出模式决定范围：全部筛选结果 or 仅选中）
  const exportSource = exportMode === "selected" ? selectedAssets : filteredAssets;
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

    setImportLoading(true);
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
            variant: "destructive",
          });
        } else {
          toast({ title: `导入成功，共 ${importedCount} 条` });
        }
        router.refresh();
      } else {
        toast({ title: "导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    }
    setImportLoading(false);
    // 重置 file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 自动导入（Excel格式，来自硬件扫描脚本）
  const handleAutoImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAutoImportLoading(true);
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
            variant: "destructive",
          });
        } else {
          toast({ title: `自动导入成功，共 ${importedCount} 条` });
        }
        router.refresh();
      } else {
        toast({ title: "自动导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "自动导入失败", description: "Excel文件解析失败", variant: "destructive" });
    }
    setAutoImportLoading(false);
    if (autoImportFileRef.current) {
      autoImportFileRef.current.value = "";
    }
  };

  // 批量分配
  const handleBatchAllocate = async () => {
    if (!batchAllocateEmployeeId || selectedAssets.length === 0) return;
    setBatchLoading(true);
    try {
      const result = await allocateAssets({
        assetIds: selectedAssets.map((a) => a.id),
        employeeId: Number(batchAllocateEmployeeId),
        operator: "admin",
        remark: "批量分配",
      });
      if (result.success) {
        toast({ title: "批量分配成功" });
        setBatchAllocateOpen(false);
        setBatchAllocateEmployeeId("");
        setSelectedAssets([]);
        router.refresh();
      } else {
        toast({ title: "批量分配失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  // 批量归还
  const handleBatchReturn = async () => {
    if (selectedAssets.length === 0) return;
    setBatchLoading(true);
    try {
      const result = await returnAssets({
        assetIds: selectedAssets.map((a) => a.id),
        operator: "admin",
        remark: "批量归还",
      });
      if (result.success) {
        toast({ title: "批量归还成功" });
        setBatchReturnOpen(false);
        setSelectedAssets([]);
        router.refresh();
      } else {
        toast({ title: "批量归还失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  // 批量报废
  const handleBatchScrap = async () => {
    if (selectedAssets.length === 0) return;
    setBatchLoading(true);
    try {
      const result = await scrapAssets({
        assetIds: selectedAssets.map((a) => a.id),
        operator: "admin",
        remark: "批量报废",
      });
      if (result.success) {
        toast({ title: "批量报废成功" });
        setBatchScrapOpen(false);
        setSelectedAssets([]);
        router.refresh();
      } else {
        toast({ title: "批量报废失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  // 批量调拨
  const handleBatchTransfer = async () => {
    if (!batchTransferEmployeeId || selectedAssets.length === 0) return;
    setBatchLoading(true);
    try {
      const result = await transferAssets({
        assetIds: selectedAssets.map((a) => a.id),
        toEmployeeId: Number(batchTransferEmployeeId),
        operator: "admin",
        remark: "批量调拨",
      });
      if (result.success) {
        toast({ title: "批量调拨成功" });
        setBatchTransferOpen(false);
        setBatchTransferEmployeeId("");
        setSelectedAssets([]);
        router.refresh();
      } else {
        toast({ title: "批量调拨失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  // 批量送修
  const handleBatchMaintenance = async () => {
    if (selectedAssets.length === 0) return;
    setBatchLoading(true);
    try {
      const result = await maintenanceStart({
        assetIds: selectedAssets.map((a) => a.id),
        operator: "admin",
        remark: "批量送修",
      });
      if (result.success) {
        toast({ title: "批量送修成功" });
        setBatchMaintenanceOpen(false);
        setSelectedAssets([]);
        router.refresh();
      } else {
        toast({ title: "批量送修失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  // 批量删除（真删，不可恢复）
  const handleBatchDelete = async () => {
    if (selectedAssets.length === 0) return;
    setBatchLoading(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const a of selectedAssets) {
        const r = await deleteAsset(a.id);
        if (r.success) ok++;
        else fail++;
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
      setBatchDeleteOpen(false);
      setSelectedAssets([]);
      router.refresh();
      return;
    } finally {
      setBatchLoading(false);
    }
    if (fail === 0) {
      toast({ title: `批量删除成功，共 ${ok} 台` });
    } else {
      toast({ title: `删除完成：${ok} 成功，${fail} 失败`, variant: "destructive" });
    }
    setBatchDeleteOpen(false);
    setSelectedAssets([]);
    router.refresh();
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
            hasSelection={selectedAssets.length > 0}
            exportLoading={exportLoading}
            importLoading={importLoading}
            autoImportLoading={autoImportLoading}
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
      {selectedAssets.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
          <span className="text-sm font-medium">
            已选择 {selectedAssets.length} 项
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchAllocateOpen(true)}
                  disabled={batchLoading}
                >
                  <UserPlus className="mr-1 h-3 w-3" />
                  批量分配
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchReturnOpen(true)}
                  disabled={batchLoading}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  批量归还
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchTransferOpen(true)}
                  disabled={batchLoading}
                >
                  <ArrowRightLeft className="mr-1 h-3 w-3" />
                  批量调拨
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchMaintenanceOpen(true)}
                  disabled={batchLoading}
                >
                  <Wrench className="mr-1 h-3 w-3" />
                  批量送修
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchScrapOpen(true)}
                  disabled={batchLoading}
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
                onClick={() => setBatchDeleteOpen(true)}
                disabled={batchLoading}
                className="border-red-200 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="mr-1 h-3 w-3" />
                批量删除
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedAssets([])}
            >
              取消选择
            </Button>
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
            <button
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
          employees={employees}
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
        onRowSelectionChange={setSelectedAssets}
        defaultSorting={[{ id: "createdAt", desc: true }]}
      />
      <CreateAssetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        categories={categories}
        employees={employees}
      />

      {/* 批量分配对话框 */}
      <Dialog open={batchAllocateOpen} onOpenChange={(v) => { if (!v) setBatchAllocateEmployeeId(""); setBatchAllocateOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>批量分配设备</DialogTitle>
            <DialogDescription>将选中的 {selectedAssets.length} 台设备分配给指定员工</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>选择员工</Label>
            <SearchableSelect
              value={batchAllocateEmployeeId}
              onValueChange={setBatchAllocateEmployeeId}
              placeholder="请选择员工"
              triggerClassName="w-full"
              options={employees.map((e) => ({
                value: e.id.toString(),
                label: `${e.name}（${e.departmentName}）`,
              }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBatchAllocateEmployeeId(""); setBatchAllocateOpen(false); }}>取消</Button>
            <Button onClick={handleBatchAllocate} disabled={batchLoading || !batchAllocateEmployeeId}>
              {batchLoading ? "分配中..." : "确认分配"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量调拨对话框 */}
      <Dialog open={batchTransferOpen} onOpenChange={(v) => { if (!v) setBatchTransferEmployeeId(""); setBatchTransferOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>批量调拨设备</DialogTitle>
            <DialogDescription>将选中的 {selectedAssets.length} 台设备调拨给指定员工</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>目标员工</Label>
            <SearchableSelect
              value={batchTransferEmployeeId}
              onValueChange={setBatchTransferEmployeeId}
              placeholder="请选择目标员工"
              triggerClassName="w-full"
              options={employees.map((e) => ({
                value: e.id.toString(),
                label: `${e.name}（${e.departmentName}）`,
              }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBatchTransferEmployeeId(""); setBatchTransferOpen(false); }}>取消</Button>
            <Button onClick={handleBatchTransfer} disabled={batchLoading || !batchTransferEmployeeId}>
              {batchLoading ? "调拨中..." : "确认调拨"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量送修确认对话框 */}
      <ConfirmDialog
        open={batchMaintenanceOpen}
        onOpenChange={setBatchMaintenanceOpen}
        title="确认批量送修"
        description={`确定要将选中的 ${selectedAssets.length} 台设备送修吗？`}
        confirmText="批量送修"
        onConfirm={handleBatchMaintenance}
      />

      {/* 批量归还确认对话框 */}
      <ConfirmDialog
        open={batchReturnOpen}
        onOpenChange={setBatchReturnOpen}
        title="确认批量归还"
        description={`确定要归还选中的 ${selectedAssets.length} 台设备吗？`}
        confirmText="批量归还"
        onConfirm={handleBatchReturn}
      />

      {/* 批量报废确认对话框 */}
      <ConfirmDialog
        open={batchScrapOpen}
        onOpenChange={setBatchScrapOpen}
        title="确认批量报废"
        description={`确定要报废选中的 ${selectedAssets.length} 台设备吗？此操作不可撤销。`}
        confirmText="批量报废"
        variant="destructive"
        onConfirm={handleBatchScrap}
      />

      {/* 批量删除确认对话框 */}
      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title="确认批量删除"
        description={`确定要永久删除选中的 ${selectedAssets.length} 台设备吗？将同时删除其全部配件与生命周期记录，不可恢复！`}
        confirmText="批量删除"
        variant="destructive"
        onConfirm={handleBatchDelete}
      />

      {/* 导出预览对话框 */}
      <ExportPreview
        open={exportPreviewOpen}
        onOpenChange={setExportPreviewOpen}
        data={exportData}
        columns={exportColumns}
        onExport={handleExport}
        loading={exportLoading}
      />
    </div>
  );
}