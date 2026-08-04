"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { StatusBadge } from "@/components/features/status-badge";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Pencil, Wrench, RotateCcw, Trash2, ArrowRightLeft, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { updateAsset } from "@/actions/asset.actions";
import {
  maintenanceStart,
  scrapAssets,
  returnAssets,
  transferAssets,
} from "@/actions/lifecycle.actions";
import { LifecycleTimeline } from "@/components/features/lifecycle-timeline";
import { ConfigEditor } from "./config-editor";

interface ComponentModel {
  id: number;
  name: string;
  brand: string | null;
  categoryId: number;
  categoryName: string;
  stock: number;
}

interface EmployeeOption {
  id: number;
  name: string;
  departmentName: string;
}

interface AssetDetailClientProps {
  asset: {
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
    location: string | null;
    purchaseDate: Date | null;
    warrantyMonths: number | null;
    notes: string | null;
    components: {
      id: number;
      modelId: number;
      modelName: string;
      modelBrand: string | null;
      categoryName: string;
      quantity: number;
    }[];
    lifecycleLogs: {
      id: number;
      action: string;
      fromStatus: string | null;
      toStatus: string | null;
      operator: string;
      remark: string | null;
      createdAt: Date;
    }[];
  };
  componentModels: ComponentModel[];
  employees: EmployeeOption[];
}

const actionLabelMap: Record<string, string> = {
  CREATED: "创建",
  ALLOCATED: "分配",
  RETURNED: "归还",
  TRANSFERRED: "调拨",
  UPGRADED: "升级/配置调整",
  SCRAPPED: "报废",
  MAINTENANCE_START: "送修",
  MAINTENANCE_DONE: "维修完成",
};

const statusLabelMap: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
};

export function AssetDetailClient({ asset, componentModels, employees }: AssetDetailClientProps) {
  const router = useRouter();
  const { toast } = useToast();

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(asset.name);
  const [editLocation, setEditLocation] = useState(asset.location ?? "");
  const [editPurchaseDate, setEditPurchaseDate] = useState(
    asset.purchaseDate ? new Date(asset.purchaseDate).toISOString().split("T")[0] : ""
  );
  const [editWarrantyMonths, setEditWarrantyMonths] = useState(
    asset.warrantyMonths?.toString() ?? ""
  );
  const [editNotes, setEditNotes] = useState(asset.notes ?? "");
  const [editLoading, setEditLoading] = useState(false);

  // Config editor dialog state（合并升级和调整配置）
  const [configEditorOpen, setConfigEditorOpen] = useState(false);

  // Confirm dialog state for maintenance/scrap/return
  const [confirmAction, setConfirmAction] = useState<"maintenance" | "scrap" | "return" | null>(null);

  // Transfer dialog state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmployeeId, setTransferEmployeeId] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);

  const isScrapped = asset.status === "SCRAPPED";
  const isInMaintenance = asset.status === "IN_MAINTENANCE";
  const isInUse = asset.status === "IN_USE";

  const handleEditOpen = (open: boolean) => {
    if (open) {
      setEditName(asset.name);
      setEditLocation(asset.location ?? "");
      setEditPurchaseDate(
        asset.purchaseDate ? new Date(asset.purchaseDate).toISOString().split("T")[0] : ""
      );
      setEditWarrantyMonths(asset.warrantyMonths?.toString() ?? "");
      setEditNotes(asset.notes ?? "");
    }
    setEditOpen(open);
  };

  const handleEdit = async () => {
    if (!editName.trim()) return;
    setEditLoading(true);
    const result = await updateAsset(asset.id, {
      name: editName.trim(),
      location: editLocation.trim() || undefined,
      purchaseDate: editPurchaseDate || undefined,
      warrantyMonths: editWarrantyMonths ? Number(editWarrantyMonths) : undefined,
      notes: editNotes.trim() || undefined,
    });
    setEditLoading(false);
    if (result.success) {
      toast({ title: "更新成功" });
      setEditOpen(false);
      router.refresh();
    } else {
      toast({ title: "更新失败", description: result.error, variant: "destructive" });
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
    setConfirmAction(null);
  };

  const handleScrap = async () => {
    const result = await scrapAssets({
      assetIds: [asset.id],
      operator: "admin",
    });
    if (result.success) {
      toast({ title: "报废成功" });
      router.refresh();
    } else {
      toast({ title: "报废失败", description: result.error, variant: "destructive" });
    }
    setConfirmAction(null);
  };

  const handleReturn = async () => {
    const result = await returnAssets({
      assetIds: [asset.id],
      operator: "admin",
    });
    if (result.success) {
      toast({ title: "归还成功" });
      router.refresh();
    } else {
      toast({ title: "归还失败", description: result.error, variant: "destructive" });
    }
    setConfirmAction(null);
  };

  const handleTransfer = async () => {
    if (!transferEmployeeId) return;
    setTransferLoading(true);
    const result = await transferAssets({
      assetIds: [asset.id],
      toEmployeeId: Number(transferEmployeeId),
      operator: "admin",
      remark: "详情页调拨",
    });
    setTransferLoading(false);
    if (result.success) {
      toast({ title: "调拨成功" });
      setTransferOpen(false);
      setTransferEmployeeId("");
      router.refresh();
    } else {
      toast({ title: "调拨失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={asset.name}
        description={`编号: ${asset.assetNo}`}
        showBack
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleEditOpen(true)} className="text-blue-600 hover:bg-blue-50 hover:text-blue-700">
              <Pencil className="mr-2 h-4 w-4" />
              编辑
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigEditorOpen(true)}
              disabled={isScrapped}
              className="border-violet-200 text-violet-600 hover:bg-violet-50 hover:text-violet-700"
            >
              <Package className="mr-2 h-4 w-4" />
              配置调整
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction("maintenance")}
              disabled={isInMaintenance || isScrapped}
              className="border-amber-200 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
            >
              <Wrench className="mr-2 h-4 w-4" />
              送修
            </Button>
            {isInUse && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTransferOpen(true)}
                className="border-cyan-200 text-cyan-600 hover:bg-cyan-50 hover:text-cyan-700"
              >
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                调拨
              </Button>
            )}
            {isInUse && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction("return")}
                className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                归还
              </Button>
            )}
            {!isScrapped && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction("scrap")} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                <Trash2 className="mr-2 h-4 w-4" />
                报废
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">基本信息</TabsTrigger>
          <TabsTrigger value="components">配件配置</TabsTrigger>
          <TabsTrigger value="lifecycle">操作记录</TabsTrigger>
        </TabsList>

        {/* 基本信息 */}
        <TabsContent value="info">
          <Card>
            <CardHeader>
              <CardTitle>设备基本信息</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <InfoItem label="设备编号" value={asset.assetNo} />
                <InfoItem label="设备名称" value={asset.name} />
                <InfoItem label="设备分类" value={asset.categoryName} />
                <InfoItem
                  label="设备状态"
                  value={
                    <StatusBadge status={asset.status} />
                  }
                />
                <InfoItem label="使用人" value={asset.employeeName ?? "-"} />
                <InfoItem label="所在位置" value={asset.location ?? "-"} />
                <InfoItem
                  label="采购日期"
                  value={asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString("zh-CN") : "-"}
                />
                <InfoItem label="保修月数" value={asset.warrantyMonths ? `${asset.warrantyMonths} 个月` : "-"} />
                <InfoItem label="备注" value={asset.notes ?? "-"} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 配件配置 */}
        <TabsContent value="components">
          <Card>
            <CardHeader>
              <CardTitle>配件配置</CardTitle>
            </CardHeader>
            <CardContent>
              {asset.components.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">分类</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>品牌</TableHead>
                      <TableHead className="text-right">数量</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asset.components.map((comp) => (
                      <TableRow key={comp.id}>
                        <TableCell>
                          <span className="text-muted-foreground">{comp.categoryName || "-"}</span>
                        </TableCell>
                        <TableCell className="font-medium">{comp.modelName}</TableCell>
                        <TableCell>{comp.modelBrand ?? "-"}</TableCell>
                        <TableCell className="text-right">{comp.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">暂无配件配置</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 操作记录 - 时间线视图 */}
        <TabsContent value="lifecycle">
          <Card>
            <CardHeader>
              <CardTitle>生命周期时间线</CardTitle>
            </CardHeader>
            <CardContent>
              <LifecycleTimeline logs={asset.lifecycleLogs} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑设备</DialogTitle>
            <DialogDescription>修改设备基本信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>设备名称</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="请输入设备名称" />
            </div>
            <div className="space-y-2">
              <Label>所在位置</Label>
              <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} placeholder="可选" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>采购日期</Label>
                <Input
                  type="date"
                  value={editPurchaseDate}
                  onChange={(e) => setEditPurchaseDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>保修月数</Label>
                <Input
                  type="number"
                  min="0"
                  value={editWarrantyMonths}
                  onChange={(e) => setEditWarrantyMonths(e.target.value)}
                  placeholder="可选"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="可选" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName.trim()}>
              {editLoading ? "更新中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config Editor Dialog（合并升级和调整配置） */}
      <ConfigEditor
        open={configEditorOpen}
        onOpenChange={setConfigEditorOpen}
        assetId={asset.id}
        assetNo={asset.assetNo}
        assetName={asset.name}
        currentComponents={asset.components.map((c) => ({
          modelId: c.modelId,
          name: c.modelName,
          brand: c.modelBrand,
          categoryName: c.categoryName,
          stock: 0,
          quantity: c.quantity,
        }))}
        componentModels={componentModels.map((m) => ({
          modelId: m.id,
          name: m.name,
          brand: m.brand,
          categoryName: m.categoryName,
          stock: m.stock,
        }))}
        disabled={isScrapped}
      />

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmAction === "maintenance"}
        onOpenChange={(open) => setConfirmAction(open ? "maintenance" : null)}
        title="确认送修"
        description={`确定要将设备「${asset.name}」送修吗？`}
        confirmText="送修"
        variant="default"
        onConfirm={handleMaintenance}
      />
      <ConfirmDialog
        open={confirmAction === "scrap"}
        onOpenChange={(open) => setConfirmAction(open ? "scrap" : null)}
        title="确认报废"
        description={`确定要报废设备「${asset.name}」吗？此操作不可撤销。`}
        confirmText="报废"
        variant="destructive"
        onConfirm={handleScrap}
      />
      <ConfirmDialog
        open={confirmAction === "return"}
        onOpenChange={(open) => setConfirmAction(open ? "return" : null)}
        title="确认归还"
        description={`确定要将设备「${asset.name}」归还吗？`}
        confirmText="归还"
        variant="default"
        onConfirm={handleReturn}
      />

      {/* Transfer Dialog */}
      <Dialog
        open={transferOpen}
        onOpenChange={(open) => {
          if (!open) setTransferEmployeeId("");
          setTransferOpen(open);
        }}
      >
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
            <Button variant="outline" onClick={() => { setTransferEmployeeId(""); setTransferOpen(false); }}>
              取消
            </Button>
            <Button onClick={handleTransfer} disabled={transferLoading || !transferEmployeeId}>
              {transferLoading ? "调拨中..." : "确认调拨"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
