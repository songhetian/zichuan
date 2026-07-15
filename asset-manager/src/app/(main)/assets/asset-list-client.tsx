"use client";

import { useState, useRef, useEffect } from "react";
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
import { CreateAssetDialog } from "./create-asset-dialog";
import {
  Eye,
  Pencil,
  Trash2,
  Plus,
  Search,
  Download,
  Upload,
  RotateCcw,
  UserPlus,
  Wrench,
  CheckCircle2,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { updateAsset } from "@/actions/asset.actions";
import {
  returnAssets,
  scrapAssets,
  allocateAssets,
  maintenanceStart,
  maintenanceComplete,
} from "@/actions/lifecycle.actions";
import { exportAssetsToExcel, importAssetsFromExcel } from "@/actions/excel.actions";

// ============================================================
// Types
// ============================================================

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
  purchaseDate: Date | null;
  warrantyMonths: number | null;
  location: string | null;
  notes: string | null;
  components: any[];
  lifecycleLogs: any[];
}

interface AssetListClientProps {
  assets: AssetItem[];
  templates: { id: number; name: string }[];
  categories: { id: number; name: string; code: string; parentId: number | null }[];
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
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const handleOpen = (v: boolean) => {
    if (v && asset) {
      setName(asset.name);
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
    const result = await updateAsset(asset.id, {
      name: name.trim(),
      notes: notes.trim() || null,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "更新成功" });
      onOpenChange(false);
      router.refresh();
    } else {
      toast({ title: "更新失败", description: result.error, variant: "destructive" });
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
  const [scrapOpen, setScrapOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [allocateEmployeeId, setAllocateEmployeeId] = useState("");
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceCompleteOpen, setMaintenanceCompleteOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleScrap = async () => {
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
    setScrapOpen(false);
  };

  const handleReturn = async () => {
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
    setReturnOpen(false);
  };

  const handleAllocate = async () => {
    if (!allocateEmployeeId) return;
    setLoading(true);
    const result = await allocateAssets({
      assetIds: [asset.id],
      employeeId: Number(allocateEmployeeId),
      operator: "admin",
      remark: "列表快捷分配",
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "分配成功" });
      setAllocateOpen(false);
      setAllocateEmployeeId("");
      router.refresh();
    } else {
      toast({ title: "分配失败", description: result.error, variant: "destructive" });
    }
  };

  const handleMaintenance = async () => {
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
    setMaintenanceOpen(false);
  };

  const handleMaintenanceDone = async () => {
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
    setMaintenanceCompleteOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-1 justify-center">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="详情" onClick={() => router.push(`/assets/${asset.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="编辑" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 text-primary" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {asset.status === "IDLE" && (
              <DropdownMenuItem onClick={() => { setAllocateOpen(true); }}>
                <UserPlus className="mr-2 h-4 w-4 text-blue-500" />分配
              </DropdownMenuItem>
            )}
            {asset.status === "IN_USE" && (
              <DropdownMenuItem onClick={() => { setReturnOpen(true); }}>
                <RotateCcw className="mr-2 h-4 w-4 text-orange-500" />归还
              </DropdownMenuItem>
            )}
            {asset.status === "IN_MAINTENANCE" && (
              <DropdownMenuItem onClick={() => { setMaintenanceCompleteOpen(true); }}>
                <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />维修完成
              </DropdownMenuItem>
            )}
            {(asset.status === "IDLE" || asset.status === "IN_USE") && (
              <DropdownMenuItem onClick={() => { setMaintenanceOpen(true); }}>
                <Wrench className="mr-2 h-4 w-4 text-yellow-500" />送修
              </DropdownMenuItem>
            )}
            {asset.status !== "SCRAPPED" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => { setScrapOpen(true); }}>
                  <Trash2 className="mr-2 h-4 w-4" />报废
                </DropdownMenuItem>
              </>
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

function getColumns(
  employees: { id: number; name: string; departmentName: string }[]
): ColumnDef<AssetItem>[] {
  return [
    {
      accessorKey: "assetNo",
      header: "编号/名称",
      cell: ({ row }) => (
        <div className="text-center">
          <div>{row.original.assetNo}</div>
          <div className="text-muted-foreground text-xs">{row.original.name}</div>
        </div>
      ),
    },
    {
      accessorKey: "categoryName",
      header: "分类",
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => <StatusCell asset={row.original} />,
    },
    {
      accessorKey: "employeeName",
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
      id: "actions",
      header: "操作",
      size: 120,
      minSize: 120,
      cell: ({ row }) => {
        const asset = row.original;
        return <ActionButtons asset={asset} employees={employees} />;
      },
    },
  ];
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
  const [exportLoading, setExportLoading] = useState(false);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<AssetItem[]>([]);
  const [batchAllocateOpen, setBatchAllocateOpen] = useState(false);
  const [batchReturnOpen, setBatchReturnOpen] = useState(false);
  const [batchScrapOpen, setBatchScrapOpen] = useState(false);
  const [batchAllocateEmployeeId, setBatchAllocateEmployeeId] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // 从 URL 参数初始化筛选状态
  useEffect(() => {
    const status = searchParams.get("status");
    if (status && ["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED"].includes(status)) {
      setStatusFilter(status);
    }
  }, [searchParams]);

  const columns = getColumns(employees);

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
      (asset.components ?? []).some((c: any) =>
        (c.modelName ?? "").toLowerCase().includes(keyword.toLowerCase()) ||
        (c.modelBrand ?? "").toLowerCase().includes(keyword.toLowerCase())
      );
    return matchStatus && matchDepartment && matchCategory && matchEmployee && matchKeyword;
  });

  const handleExport = async (selectedFields: string[]) => {
    setExportLoading(true);
    try {
      const result = await exportAssetsToExcel(selectedFields);
      if (result.success) {
        const blob = new Blob([result.data.buffer as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.fileName;
        a.click();
        URL.revokeObjectURL(url);
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

  // 准备导出数据
  const exportData = filteredAssets.map((asset) => ({
    assetNo: asset.assetNo,
    name: asset.name,
    categoryName: asset.categoryName,
    templateName: asset.templateName,
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
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await importAssetsFromExcel({ buffer });
      if (result.success) {
        const { importedCount, errors } = result.data;
        if (errors.length > 0) {
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

  // 批量分配
  const handleBatchAllocate = async () => {
    if (!batchAllocateEmployeeId || selectedAssets.length === 0) return;
    setBatchLoading(true);
    const result = await allocateAssets({
      assetIds: selectedAssets.map((a) => a.id),
      employeeId: Number(batchAllocateEmployeeId),
      operator: "admin",
      remark: "批量分配",
    });
    setBatchLoading(false);
    if (result.success) {
      toast({ title: "批量分配成功" });
      setBatchAllocateOpen(false);
      setBatchAllocateEmployeeId("");
      setSelectedAssets([]);
      router.refresh();
    } else {
      toast({ title: "批量分配失败", description: result.error, variant: "destructive" });
    }
  };

  // 批量归还
  const handleBatchReturn = async () => {
    if (selectedAssets.length === 0) return;
    setBatchLoading(true);
    const result = await returnAssets({
      assetIds: selectedAssets.map((a) => a.id),
      operator: "admin",
      remark: "批量归还",
    });
    setBatchLoading(false);
    if (result.success) {
      toast({ title: "批量归还成功" });
      setBatchReturnOpen(false);
      setSelectedAssets([]);
      router.refresh();
    } else {
      toast({ title: "批量归还失败", description: result.error, variant: "destructive" });
    }
  };

  // 批量报废
  const handleBatchScrap = async () => {
    if (selectedAssets.length === 0) return;
    setBatchLoading(true);
    const result = await scrapAssets({
      assetIds: selectedAssets.map((a) => a.id),
      operator: "admin",
      remark: "批量报废",
    });
    setBatchLoading(false);
    if (result.success) {
      toast({ title: "批量报废成功" });
      setBatchScrapOpen(false);
      setSelectedAssets([]);
      router.refresh();
    } else {
      toast({ title: "批量报废失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备管理"
        description="管理所有设备资产信息"
        action={
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImport}
            />
            <Button
              variant="outline"
              onClick={() => setExportPreviewOpen(true)}
              disabled={exportLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportLoading ? "导出中..." : "导出 Excel"}
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importLoading}
            >
              <Upload className="mr-2 h-4 w-4" />
              {importLoading ? "导入中..." : "导入 Excel"}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建设备
            </Button>
          </div>
        }
      />

      {/* 批量操作栏 */}
      {selectedAssets.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
          <span className="text-sm font-medium">
            已选择 {selectedAssets.length} 项
          </span>
          <div className="flex items-center gap-2 ml-auto">
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
              onClick={() => setBatchScrapOpen(true)}
              disabled={batchLoading}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              批量报废
            </Button>
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
      {/* 筛选栏 - 单行 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索编号、名称或配件型号..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pl-9"
          />
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          placeholder="全部状态"
          triggerClassName="w-[130px]"
          options={[
            { value: "all", label: "全部状态" },
            { value: "IDLE", label: "闲置" },
            { value: "IN_USE", label: "在用" },
            { value: "IN_MAINTENANCE", label: "维修中" },
            { value: "SCRAPPED", label: "报废" },
          ]}
        />
        <SearchableSelect
          value={departmentFilter}
          onValueChange={setDepartmentFilter}
          placeholder="全部部门"
          triggerClassName="w-[150px]"
          options={[
            { value: "all", label: "全部部门" },
            { value: "none", label: "未分配部门" },
            ...departments.map((d) => ({ value: d.id.toString(), label: d.name })),
          ]}
        />
        <SearchableSelect
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          placeholder="全部分类"
          triggerClassName="w-[150px]"
          options={[
            { value: "all", label: "全部分类" },
            ...categories.map((c) => ({ value: c.id.toString(), label: c.name })),
          ]}
        />
        <SearchableSelect
          value={employeeFilter}
          onValueChange={setEmployeeFilter}
          placeholder="全部员工"
          triggerClassName="w-[160px]"
          options={[
            { value: "all", label: "全部员工" },
            { value: "none", label: "未分配" },
            ...employees.map((e) => ({ value: e.id.toString(), label: `${e.name}（${e.departmentName}）` })),
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        data={filteredAssets}
        enableRowSelection={true}
        onRowSelectionChange={setSelectedAssets}
      />
      <CreateAssetDialog open={createOpen} onOpenChange={setCreateOpen} templates={templates} />

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