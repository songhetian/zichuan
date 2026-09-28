"use client";

import { downloadExcelFile } from "@/lib/excel-download";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { FilterBar } from "@/components/features/filter-bar";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { ExportPreview } from "@/components/features/export-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Pencil, Trash2, Download, Upload, Monitor, History, Clock, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/use-permission";
import {
  createEmployee,
  deleteEmployee,
  updateEmployee,
  resetEmployeePassword,
  getEmployeeAssets,
  getAssetComponents,
  type EmployeeAsset,
} from "@/actions/employee.actions";
import {
  setAdminActive,
  setAccountDepartmentScope,
} from "@/actions/admin.actions";
import { exportEmployeesToExcel, importEmployeesFromExcel } from "@/actions/excel.actions";
import { getSystemLogs } from "@/actions/system-log.actions";

const employeeSchema = z.object({
  // 新建员工时工号自动生成，无需手动填写
  employeeNo: z.string().optional(),
  name: z.string().min(1, "姓名不能为空"),
  departmentId: z.string().min(1, "请选择部门"),
  email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
  phone: z.string().optional(),
  // 新建员工一并创建账号时的字段（仅账号管理权限可见，提交时手动校验必填）
  username: z.string().optional(),
  password: z.string().optional(),
  roleId: z.string().optional(),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

/** 登录账号信息（绑定到员工行；仅账号管理权限可见） */
export interface EmployeeAccount {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  role: { key: string; name: string } | null;
  departmentScope: string;
  departmentIds: number[];
}

interface Employee {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  departmentName: string;
  phone: string | null;
  email: string | null;
  assetCount?: number;
  createdAt: string;
  /** 绑定的登录账号；未创建账号为 null */
  account?: EmployeeAccount | null;
}

interface EmployeeListClientProps {
  employees: Employee[];
  departments: { id: number; name: string }[];
  /** 当前账号是否拥有「账号与权限管理」权限（决定账号列与账号操作是否可见） */
  canManageAccounts?: boolean;
  roles?: { id: number; key: string; name: string }[];
}

type EmployeeRow = Employee & { _departments: { id: number; name: string }[] };

/** 员工信息基础列（操作列/账号列需访问组件内状态，在组件内组装） */
const baseColumns: ColumnDef<EmployeeRow>[] = [
  { id: "employeeNo", accessorKey: "employeeNo", header: "工号", size: 100 },
  { id: "name", accessorKey: "name", header: "姓名", size: 100 },
  {
    id: "departmentName",
    accessorKey: "departmentName",
    header: "部门",
    size: 140,
    cell: ({ row }) => row.original.departmentName ?? "-",
  },
  {
    id: "phone",
    accessorKey: "phone",
    header: "电话",
    size: 140,
    cell: ({ row }) => row.getValue("phone") ?? "-",
  },
  {
    id: "email",
    accessorKey: "email",
    header: "邮箱",
    size: 200,
    cell: ({ row }) => row.getValue("email") ?? "-",
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "创建时间",
    size: 170,
    cell: ({ row }) =>
      row.original.createdAt ? new Date(row.original.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-",
  },
  {
    id: "assetCount",
    header: "在用设备数",
    size: 100,
    cell: ({ row }) => {
      const count = row.original.assetCount ?? 0;
      return (
        <span className={count > 0 ? "font-medium text-primary" : "text-muted-foreground"}>
          {count}
        </span>
      );
    },
  },
];

interface AssetLogItem {
  id: number;
  module: string;
  action: string;
  detail: string;
  operator: string;
  createdAt: Date;
}

const assetStatusMap: Record<string, { label: string; className: string }> = {
  IDLE: { label: "闲置", className: "bg-gray-100 text-gray-700" },
  IN_USE: { label: "在用", className: "bg-green-100 text-green-700" },
  IN_MAINTENANCE: { label: "维修中", className: "bg-yellow-100 text-yellow-700" },
  SCRAPPED: { label: "已报废", className: "bg-red-100 text-red-700" },
};

const logModuleColorMap: Record<string, string> = {
  "分配": "text-green-600 bg-green-50",
  "归还": "text-orange-600 bg-orange-50",
  "调拨": "text-blue-600 bg-blue-50",
};

const LOG_MODULES = ["分配", "归还", "调拨"];

/** 列显隐控制的可勾选列（actions 列固定显示，不参与显隐） */
const BASE_COLUMN_OPTIONS = [
  { id: "employeeNo", label: "工号" },
  { id: "name", label: "姓名" },
  { id: "departmentName", label: "部门" },
  { id: "phone", label: "电话" },
  { id: "email", label: "邮箱" },
  { id: "createdAt", label: "创建时间" },
  { id: "assetCount", label: "在用设备数" },
] as const;

const ACCOUNT_COLUMN_OPTIONS = [
  { id: "account", label: "账号" },
  { id: "accountRole", label: "角色" },
  { id: "accountScope", label: "数据范围" },
  { id: "accountStatus", label: "状态" },
] as const;

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 text-muted-foreground">{label}：</span>
      <span className="font-medium truncate max-w-[14rem]">{value}</span>
    </span>
  );
}

/** 展开区骨架屏（紧凑行） */
function SkeletonList({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5 py-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-4 w-10 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** 展开行手风琴：顶部低频信息条 + 在用设备/分配历史（仅可见 Tab 懒加载 + 骨架屏，布局紧凑） */
function ExpandedEmployeeRow({ employee }: { employee: Employee }) {
  const [activeTab, setActiveTab] = useState<"assets" | "history">("assets");
  const [assets, setAssets] = useState<EmployeeAsset[] | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [logs, setLogs] = useState<AssetLogItem[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [viewAsset, setViewAsset] = useState<EmployeeAsset | null>(null);

  // 默认 Tab 为「在用设备」，展开时立即按需加载（仅该 Tab，避免一律预取）
  useEffect(() => {
    if (assets === null && !assetsLoading) {
      setAssetsLoading(true);
      getEmployeeAssets(employee.id).then((result) => {
        setAssets(result.success ? result.data : []);
        setAssetsLoading(false);
      });
    }
  }, [assets, assetsLoading, employee.id]);

  const handleSelectTab = (tab: "assets" | "history") => {
    setActiveTab(tab);
    if (tab === "history" && logs === null && !logsLoading) {
      // 仅当前可见 Tab 才拉取分配历史
      setLogsLoading(true);
      getSystemLogs({ keyword: employee.name }).then((result) => {
        const relevant = result.success
          ? result.data.filter((log) => LOG_MODULES.includes(log.module))
          : [];
        setLogs(relevant);
        setLogsLoading(false);
      });
    }
  };

  const acc = employee.account ?? null;

  return (
    <div className="bg-muted/30 px-4 py-3">
      {/* 低频信息条：承接电话/邮箱/创建时间/角色/数据范围 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs">
        <InfoItem label="电话" value={employee.phone ?? "-"} />
        <InfoItem label="邮箱" value={employee.email ?? "-"} />
        <InfoItem
          label="创建时间"
          value={
            employee.createdAt
              ? new Date(employee.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
              : "-"
          }
        />
        <InfoItem label="角色" value={acc?.role?.name ?? "-"} />
        <InfoItem
          label="数据范围"
          value={
            acc
              ? acc.departmentScope === "SPEC" && (acc.departmentIds?.length ?? 0) > 0
                ? `本部门 +${acc.departmentIds.length} 个扩展部门`
                : "仅本部门"
              : "-"
          }
        />
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1.5 border-b pb-1.5">
        <Button
          type="button"
          variant={activeTab === "assets" ? "default" : "ghost"}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => handleSelectTab("assets")}
        >
          <Monitor className="h-3.5 w-3.5" />
          在用设备
        </Button>
        <Button
          type="button"
          variant={activeTab === "history" ? "default" : "ghost"}
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => handleSelectTab("history")}
        >
          <History className="h-3.5 w-3.5" />
          分配历史
        </Button>
      </div>

      {activeTab === "assets" &&
        (assets === null || assetsLoading ? (
          <SkeletonList rows={2} />
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Monitor className="mb-1.5 h-6 w-6 opacity-50" />
            <span className="text-xs">暂无分配设备</span>
          </div>
        ) : (
          <div className="space-y-1.5 py-2">
            <div className="text-xs font-medium text-muted-foreground">在用设备（{assets.length} 台）</div>
            <div className="grid gap-1.5">
              {assets.map((asset) => {
                const status = assetStatusMap[asset.status] ?? assetStatusMap.IDLE;
                return (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5 cursor-pointer hover:bg-accent/40"
                    onClick={() => setViewAsset(asset)}
                    title="点击查看设备详情"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Monitor className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <span className="font-medium">{asset.assetNo}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {asset.name} · {asset.categoryName} · {asset.templateName}
                        </span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {activeTab === "history" &&
        (logs === null || logsLoading ? (
          <SkeletonList rows={2} />
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <History className="mb-1.5 h-6 w-6 opacity-50" />
            <span className="text-xs">暂无分配历史记录</span>
          </div>
        ) : (
          <div className="space-y-1.5 py-2">
            <div className="text-xs font-medium text-muted-foreground">分配历史（{logs.length} 条）</div>
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-2.5 rounded-md border bg-background px-3 py-1.5"
                >
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${logModuleColorMap[log.module] ?? "bg-gray-100 text-gray-700"}`}>
                        {log.module}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm">{log.detail}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">操作人：{log.operator}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {/* 主机详细配置弹窗 */}
      <Dialog open={!!viewAsset} onOpenChange={(open) => !open && setViewAsset(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>主机详细配置</DialogTitle>
            <DialogDescription>
              {viewAsset ? `${viewAsset.assetNo} · ${viewAsset.name}${viewAsset.categoryName ? " · " + viewAsset.categoryName : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          {viewAsset && <AssetConfigList assetId={viewAsset.id} />}
          <DialogFooter>
            <Button onClick={() => setViewAsset(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 主机配置列表：按 assetId 拉取该主机的配件清单并展示（骨架屏 + 空态 + 错误回退） */
function AssetConfigList({ assetId }: { assetId: number }) {
  const [rows, setRows] = useState<{ modelName: string; modelBrand: string | null; categoryName: string; quantity: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    getAssetComponents(assetId).then((res) => {
      if (cancelled) return;
      if (res.success) setRows(res.data);
      else setError(res.error ?? "加载失败");
    });
    return () => { cancelled = true; };
  }, [assetId]);

  if (rows === null) {
    return <div className="space-y-2"><SkeletonList rows={3} /></div>;
  }
  if (error) return <div className="py-4 text-center text-sm text-destructive">{error}</div>;
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">该主机暂无配置详情</div>;
  }
  return (
    <div className="divide-y rounded-lg border">
      {rows.map((c, idx) => (
        <div key={idx} className="flex items-center justify-between px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">{c.modelName}</div>
            <div className="text-xs text-muted-foreground">
              {[c.modelBrand, c.categoryName].filter(Boolean).join(" · ") || "-"}
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">×{c.quantity}</span>
        </div>
      ))}
    </div>
  );
}

function EmployeeActionButtons({
  employee,
  departments,
  canManageAccounts,
  roles,
  onEdited,
  onDeleted,
}: {
  employee: Employee & { _departments?: { id: number; name: string }[] };
  departments?: { id: number; name: string }[];
  canManageAccounts?: boolean;
  roles?: { id: number; key: string; name: string }[];
  /** 编辑保存成功后回调，用于本地列表替换（避免整表刷新） */
  onEdited?: (emp: Employee, values: EmployeeFormValues) => void;
  /** 删除成功后回调，用于本地列表删除（避免整表刷新） */
  onDeleted?: (id: number) => void;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const { toast } = useToast();
  const roleList = roles ?? [];

  // 编辑时回显绑定账号当前角色：按 key 反查角色 id
  const currentRoleId = employee.account?.role
    ? roleList.find((r) => r.key === employee.account!.role!.key)?.id
    : undefined;

  const editForm = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNo: "",
      name: "",
      departmentId: "",
      phone: "",
      email: "",
      roleId: currentRoleId ? String(currentRoleId) : "",
    },
  });

  const handleDelete = async () => {
    const result = await deleteEmployee(employee.id);
    if (result.success) {
      toast({ title: "删除成功" });
      onDeleted?.(employee.id);
      router.refresh();
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
  };

  const handleEdit = async (values: EmployeeFormValues) => {
    setEditLoading(true);
    const result = await updateEmployee(employee.id, {
      employeeNo: values.employeeNo?.trim() || employee.employeeNo,
      name: values.name.trim(),
      departmentId: Number(values.departmentId),
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
      // 仅账号管理权限可修改角色，未选则不改
      roleId: canManageAccounts && values.roleId ? Number(values.roleId) : undefined,
    });
    setEditLoading(false);
    if (result.success) {
      toast({ title: "更新成功" });
      onEdited?.(result.data, values);
      setEditOpen(false);
      router.refresh();
    } else {
      toast({ title: "更新失败", description: result.error, variant: "destructive" });
    }
  };

  const handleEditOpen = (open: boolean) => {
    if (open) {
      editForm.reset({
        employeeNo: employee.employeeNo,
        name: employee.name,
        departmentId: employee.departmentId.toString(),
        phone: employee.phone ?? "",
        email: employee.email ?? "",
        roleId: currentRoleId ? String(currentRoleId) : "",
      });
    }
    setEditOpen(open);
  };

  return (
    <>
      {/* 员工增删改后端统一要求「账号与权限管理」，无权限时不展示操作入口，避免点了才报错 */}
      {canManageAccounts && (
        <>
          <Button type="button" variant="ghost" size="icon" title="编辑" onClick={() => handleEditOpen(true)}>
            <Pencil className="h-4 w-4 text-primary" />
          </Button>
          <Button type="button" variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      )}

      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑员工</DialogTitle>
            <DialogDescription>修改员工信息</DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(handleEdit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>工号</Label>
                <Input {...editForm.register("employeeNo")} placeholder="请输入工号" />
                {editForm.formState.errors.employeeNo && (
                  <p className="text-sm text-destructive">{editForm.formState.errors.employeeNo.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>姓名</Label>
                <Input {...editForm.register("name")} placeholder="请输入姓名" />
                {editForm.formState.errors.name && (
                  <p className="text-sm text-destructive">{editForm.formState.errors.name.message}</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>部门</Label>
              <SearchableSelect
                value={editForm.watch("departmentId")}
                onValueChange={(v) => {
                  // 部门为必填，忽略 toggle-off 空串保持原选中
                  if (v) editForm.setValue("departmentId", v);
                }}
                placeholder="选择部门"
                ariaLabel="部门"
                triggerClassName="w-full"
                options={(departments ?? []).map((d) => ({ value: d.id.toString(), label: d.name }))}
              />
              {editForm.formState.errors.departmentId && (
                <p className="text-sm text-destructive">{editForm.formState.errors.departmentId.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>电话</Label>
                <Input {...editForm.register("phone")} placeholder="可选" />
              </div>
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input {...editForm.register("email")} placeholder="可选" />
                {editForm.formState.errors.email && (
                  <p className="text-sm text-destructive">{editForm.formState.errors.email.message}</p>
                )}
              </div>
            </div>
            {canManageAccounts && (
              <div className="space-y-2">
                <Label>角色</Label>
                <Select
                  value={editForm.watch("roleId")}
                  onValueChange={(v) => editForm.setValue("roleId", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleList.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">账号角色随员工编辑同步更新</p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "更新中..." : "确认"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="确认删除"
        description={`确定要删除员工「${employee.name}」吗？`}
        confirmText="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}

export function EmployeeListClient({
  employees,
  departments,
  canManageAccounts = false,
  roles = [],
}: EmployeeListClientProps) {
  const canImportEmployee = usePermission("employee.import");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  // 本地员工列表：初始为 props.employees，写操作成功后本地增删改，避免整表刷新卡顿
  const [employeeData, setEmployeeData] = useState<Employee[]>(employees);
  // 默认收起低频列（电话/邮箱）。“创建时间”保留用于默认“新员工在前”排序，不被默认隐藏
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(["phone", "email"]);

  // 无「账号与权限管理」权限时，账号相关列与操作整体隐藏，进入页面给一次明确说明
  const noAccessNotified = useRef(false);
  useEffect(() => {
    if (!canManageAccounts && !noAccessNotified.current) {
      noAccessNotified.current = true;
      toast({
        title: "账号功能不可用",
        description:
          "当前账号无「账号与权限管理」权限，账号信息与账号操作（角色、数据范围、重置密码等）不可见，如需管理请联系管理员。",
      });
    }
  }, [canManageAccounts, toast]);

  // ===== 账号操作（仅 canManageAccounts 时启用）=====
  const [scopeEdit, setScopeEdit] = useState<Employee | null>(null);
  const [activeEdit, setActiveEdit] = useState<Employee | null>(null);
  const [resetPwd, setResetPwd] = useState<Employee | null>(null);
  const [scope, setScope] = useState<"ALL" | "SPEC">("ALL");
  const [scopeDeptIds, setScopeDeptIds] = useState<number[]>([]);
  const [scopeSaving, setScopeSaving] = useState(false);

  const openScopeEdit = useCallback((emp: Employee) => {
    const acc = emp.account ?? null;
    setScopeEdit(emp);
    setScope(acc?.departmentScope === "SPEC" ? "SPEC" : "ALL");
    setScopeDeptIds(acc?.departmentIds ?? []);
  }, []);

  const handleResetPassword = async () => {
    if (!resetPwd) return;
    try {
      const result = await resetEmployeePassword(resetPwd.id);
      if (result.success) {
        toast({ title: "重置成功", description: "密码已重置为 123456，该员工下次登录需修改密码" });
        router.refresh();
        setResetPwd(null);
      } else {
        toast({ title: "重置失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
  };

  const handleSaveScope = async () => {
    const staff = scopeEdit;
    if (!staff?.account) return;
    const acc = staff.account;
    const scopeTargetId = staff.id;
    setScopeSaving(true);
    try {
      const result = await setAccountDepartmentScope(acc.id, {
        scope,
        departmentIds: scope === "SPEC" ? scopeDeptIds : [],
      });
      if (result.success) {
        toast({ title: "保存成功" });
        setEmployeeData((prev) =>
          prev.map((e) =>
            e.id === scopeTargetId
              ? {
                  ...e,
                  account: e.account
                    ? { ...e.account, departmentScope: scope, departmentIds: scope === "SPEC" ? scopeDeptIds : [] }
                    : e.account,
                }
              : e
          )
        );
        router.refresh();
        setScopeEdit(null);
      } else {
        toast({ title: "保存失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setScopeSaving(false);
    }
  };

  const handleToggleActive = async () => {
    const staff = activeEdit;
    if (!staff?.account) return;
    const acc = staff.account;
    const activeTargetId = staff.id;
    try {
      const result = await setAdminActive(acc.id, !acc.isActive);
      if (result.success) {
        toast({ title: "操作成功" });
        setEmployeeData((prev) =>
          prev.map((e) =>
            e.id === activeTargetId
              ? { ...e, account: e.account ? { ...e.account, isActive: !e.account.isActive } : e.account }
              : e
          )
        );
        router.refresh();
        setActiveEdit(null);
      } else {
        toast({ title: "操作失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
  };

  // ===== 写操作完成后的本地列表更新（避免整表刷新） =====
  const handleLocalEdited = useCallback(
    (updated: Employee, values: EmployeeFormValues) => {
      const role =
        canManageAccounts && values.roleId
          ? (roles.find((r) => r.id === Number(values.roleId)) ?? null)
          : null;
      setEmployeeData((prev) =>
        prev.map((e) =>
          e.id === updated.id
            ? {
                ...e,
                employeeNo: updated.employeeNo,
                name: updated.name,
                departmentId: updated.departmentId,
                departmentName: updated.departmentName,
                phone: updated.phone,
                email: updated.email,
                assetCount: updated.assetCount ?? e.assetCount,
                createdAt: updated.createdAt ?? e.createdAt,
                account: e.account
                  ? { ...e.account, role: role ? { key: role.key, name: role.name } : e.account.role }
                  : e.account,
              }
            : e
        )
      );
    },
    [canManageAccounts, roles]
  );

  const handleLocalDeleted = useCallback((id: number) => {
    setEmployeeData((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // 新建员工默认「普通员工」角色（仅管理员需手动切换其他角色）
  const defaultRoleId = roles.find((r) => r.key === "EMPLOYEE")?.id;
  /** 新建/编辑弹窗的角色下拉：必填，不含「不分配角色」 */
  const roleOptions = roles.map((r) => ({ value: String(r.id), label: r.name }));

  const columns = useMemo<ColumnDef<EmployeeRow>[]>(() => {
    const accountCols: ColumnDef<EmployeeRow>[] = canManageAccounts
      ? [
          {
            id: "account",
            header: "账号",
            size: 150,
            cell: ({ row }) => {
              const acc = row.original.account ?? null;
              if (!acc) return <span className="text-muted-foreground">未创建</span>;
              return (
                <div>
                  <div>{acc.username}</div>
                  {acc.displayName && <div className="text-xs text-muted-foreground">{acc.displayName}</div>}
                </div>
              );
            },
          },
          {
            id: "accountRole",
            header: "角色",
            size: 120,
            cell: ({ row }) => {
              const acc = row.original.account ?? null;
              if (!acc) return "-";
              return acc.role ? (
                <Badge variant="secondary">{acc.role.name}</Badge>
              ) : (
                <span className="text-muted-foreground">未分配</span>
              );
            },
          },
          {
            id: "accountScope",
            header: "数据范围",
            size: 170,
            cell: ({ row }) => {
              const acc = row.original.account ?? null;
              if (!acc) return "-";
              if (acc.departmentScope === "EXACT" && acc.departmentIds.length > 0) {
                return <Badge variant="outline">仅指定部门 ({acc.departmentIds.length})</Badge>;
              }
              if (acc.departmentScope === "SPEC" && acc.departmentIds.length > 0) {
                return <Badge variant="outline">本部门 +{acc.departmentIds.length} 个扩展部门</Badge>;
              }
              return <span className="text-muted-foreground">本部门</span>;
            },
          },
          {
            id: "accountStatus",
            header: "状态",
            size: 80,
            cell: ({ row }) => {
              const acc = row.original.account ?? null;
              if (!acc) return "-";
              return <Badge variant={acc.isActive ? "default" : "destructive"}>{acc.isActive ? "启用" : "停用"}</Badge>;
            },
          },
        ]
      : [];

    const actionsCol: ColumnDef<EmployeeRow> = {
      id: "actions",
      header: "操作",
      size: canManageAccounts ? 340 : 120,
      cell: ({ row }) => {
        const emp = row.original;
        const acc = emp.account ?? null;
        return (
          <div className="flex items-center gap-1 justify-center">
            {/* 行点击展开手风琴，操作按钮需阻止冒泡以免误触展开 */}
            <div onClick={(e) => e.stopPropagation()}>
              <EmployeeActionButtons
                employee={emp}
                departments={emp._departments}
                canManageAccounts={canManageAccounts}
                roles={roles}
                onEdited={handleLocalEdited}
                onDeleted={handleLocalDeleted}
              />
            </div>
            {canManageAccounts && acc && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="设置数据范围"
                  onClick={(e) => {
                    e.stopPropagation();
                    openScopeEdit(emp);
                  }}
                >
                  数据范围
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="重置密码"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResetPwd(emp);
                  }}
                >
                  重置密码
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={acc.isActive ? "停用账号" : "启用账号"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveEdit(emp);
                  }}
                >
                  {acc.isActive ? "停用" : "启用"}
                </Button>
              </>
            )}
          </div>
        );
      },
    };

    // 按 id 过滤：排除用户勾选隐藏的低频列（actions 列始终保留）
    return [...baseColumns, ...accountCols, actionsCol].filter(
      (c) => !hiddenColumns.includes(c.id ?? "")
    );
  }, [canManageAccounts, openScopeEdit, roles, hiddenColumns, handleLocalEdited, handleLocalDeleted]);

  const createForm = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNo: "",
      name: "",
      departmentId: "",
      phone: "",
      email: "",
      roleId: defaultRoleId ? String(defaultRoleId) : "",
    },
  });

  const handleCreate = async (values: EmployeeFormValues) => {
    setLoading(true);
    const result = await createEmployee({
      name: values.name.trim(),
      departmentId: Number(values.departmentId),
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
      // 仅账号管理权限可指定角色，未选时后端默认普通员工
      roleId: canManageAccounts && values.roleId ? Number(values.roleId) : undefined,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功", description: "登录账号已自动创建（工号 + 初始密码 123456，首登需修改密码）" });
      // 本地追加新员工，避免整表刷新卡顿
      setEmployeeData((prev) => {
        const d = result.data;
        const role =
          canManageAccounts && values.roleId
            ? (roles.find((r) => r.id === Number(values.roleId)) ?? null)
            : null;
        const deptName =
          departments.find((x) => x.id === d.departmentId)?.name ?? d.departmentName ?? "";
        return [
          {
            id: d.id,
            employeeNo: d.employeeNo,
            name: d.name,
            departmentId: d.departmentId,
            departmentName: d.departmentName ?? deptName,
            phone: d.phone,
            email: d.email,
            assetCount: d.assetCount ?? 0,
            createdAt: d.createdAt ?? new Date().toISOString(),
            account: canManageAccounts
              ? {
                  id: -Date.now(),
                  username: d.employeeNo,
                  displayName: d.name,
                  isActive: true,
                  role: role ? { key: role.key, name: role.name } : null,
                  departmentScope: "ALL",
                  departmentIds: [],
                }
              : null,
          },
          ...prev,
        ];
      });
      setCreateOpen(false);
      createForm.reset();
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleExport = async (selectedFields: string[]) => {
    setExportLoading(true);
    try {
      const result = await exportEmployeesToExcel(selectedFields);
      if (result.success) {
        downloadExcelFile(result.data.fileName, result.data.buffer);
        toast({ title: "导出成功" });
      } else {
        toast({ title: "导出失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导出失败", variant: "destructive" });
    }
    setExportLoading(false);
    setPreviewOpen(false);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const result = await importEmployeesFromExcel({ buffer });
      if (result.success) {
        const desc = result.data.errors.length > 0
          ? `成功 ${result.data.importedCount} 条，失败 ${result.data.errors.length} 条`
          : `成功导入 ${result.data.importedCount} 条`;
        toast({ title: "导入完成", description: desc });
        router.refresh();
      } else {
        toast({ title: "导入失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    }
    setImportLoading(false);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const filteredEmployees = useMemo(() => {
    return employeeData.filter((emp) => {
      const matchesDepartment =
        departmentFilter === "all" || emp.departmentId.toString() === departmentFilter;
      const matchesKeyword =
        !keyword.trim() ||
        emp.name.toLowerCase().includes(keyword.toLowerCase()) ||
        emp.employeeNo.toLowerCase().includes(keyword.toLowerCase());
      return matchesDepartment && matchesKeyword;
    });
  }, [employeeData, departmentFilter, keyword]);

  const columnControlOptions = canManageAccounts
    ? [...BASE_COLUMN_OPTIONS, ...ACCOUNT_COLUMN_OPTIONS]
    : BASE_COLUMN_OPTIONS;

  // 列显隐控件的勾选状态计算
  const colVisibilityOptions = columnControlOptions.map((opt) => ({
    id: opt.id,
    label: opt.label,
    visible: !hiddenColumns.includes(opt.id),
  }));

  const dataWithDepartments = filteredEmployees.map((e) => ({
    ...e,
    _departments: departments,
  }));

  // 导出预览数据 + 列定义（与 exportEmployeesToExcel 的字段 key 一一对应）
  const exportData = filteredEmployees.map((e) => ({
    employeeNo: e.employeeNo,
    name: e.name,
    departmentName: e.departmentName ?? "",
    phone: e.phone ?? "",
    email: e.email ?? "",
  }));
  const exportColumns = [
    { key: "employeeNo", label: "工号" },
    { key: "name", label: "姓名" },
    { key: "departmentName", label: "部门" },
    { key: "phone", label: "电话" },
    { key: "email", label: "邮箱" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="员工管理"
        description="管理员工信息、登录账号与数据范围"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={exportLoading}>
              <Download className="mr-2 h-4 w-4" />
              导出 Excel
            </Button>
            {canImportEmployee && (
              <Button variant="outline" onClick={handleImportClick} disabled={importLoading}>
                <Upload className="mr-2 h-4 w-4" />
                {importLoading ? "导入中..." : "导入 Excel"}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            {canManageAccounts && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                新建员工
              </Button>
            )}
          </div>
        }
      />
      <FilterBar
        items={[
          {
            key: "department",
            content: (
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="全部部门" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部部门</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ),
          },
          ]}
        searchValue={keyword}
        searchPlaceholder="搜索工号、姓名..."
        onSearchChange={setKeyword}
        showReset
        onReset={() => { setDepartmentFilter("all"); setKeyword(""); }}
        rightSlot={
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground" title="设置表格显示列">
                <Eye className="mr-1 h-3.5 w-3.5" />
                列设置
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">显示列</div>
              <div className="space-y-0.5">
                {colVisibilityOptions.map((opt) => (
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
        }
      />
      <div className="rounded-lg border border-border/80 bg-card">
        <DataTable
          columns={columns}
          data={dataWithDepartments}
          defaultSorting={[{ id: "createdAt", desc: true }]}
          renderExpandedRow={(employee) => <ExpandedEmployeeRow employee={employee} />}
        />
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => {
        if (!open) createForm.reset();
        setCreateOpen(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建员工</DialogTitle>
            <DialogDescription>添加新的员工信息</DialogDescription>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>工号</Label>
                <Input value="自动生成" disabled className="text-muted-foreground" />
                <p className="text-xs text-muted-foreground">保存后自动生成（如 EMP0001）</p>
              </div>
              <div className="space-y-2">
                <Label>姓名</Label>
                <Input {...createForm.register("name")} placeholder="请输入姓名" />
                {createForm.formState.errors.name && (
                  <p className="text-sm text-destructive">{createForm.formState.errors.name.message}</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>部门</Label>
              <SearchableSelect
                value={createForm.watch("departmentId")}
                onValueChange={(v) => {
                  // 部门为必填，忽略 toggle-off 空串保持原选中
                  if (v) createForm.setValue("departmentId", v);
                }}
                placeholder="选择部门"
                ariaLabel="部门"
                triggerClassName="w-full"
                options={departments.map((d) => ({ value: d.id.toString(), label: d.name }))}
              />
              {createForm.formState.errors.departmentId && (
                <p className="text-sm text-destructive">{createForm.formState.errors.departmentId.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>电话</Label>
                <Input {...createForm.register("phone")} placeholder="可选" />
              </div>
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input {...createForm.register("email")} placeholder="可选" />
                {createForm.formState.errors.email && (
                  <p className="text-sm text-destructive">{createForm.formState.errors.email.message}</p>
                )}
              </div>
            </div>
            {canManageAccounts && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground">登录账号（创建员工时自动创建）</p>
                <div className="space-y-2">
                  <Label>角色</Label>
                  <Select
                    value={createForm.watch("roleId")}
                    onValueChange={(v) => createForm.setValue("roleId", v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择角色" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">默认普通员工，仅管理员需手动选择其他角色</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  登录名 = 工号，初始密码 123456，首次登录需修改密码
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== 账号操作弹窗（重置密码 / 数据范围 / 停用启用） ===== */}
      <ConfirmDialog
        open={resetPwd !== null}
        onOpenChange={(v) => {
          if (!v) setResetPwd(null);
        }}
        title="重置密码"
        description={`确定要重置员工「${resetPwd?.name ?? ""}」的登录密码吗？密码将重置为 123456，该员工下次登录需修改密码。`}
        confirmText="重置"
        onConfirm={handleResetPassword}
      />

      <Dialog
        open={scopeEdit !== null}
        onOpenChange={(v) => {
          if (!v && !scopeSaving) setScopeEdit(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>数据范围设置</DialogTitle>
            <DialogDescription>配置该账号可见的部门数据范围</DialogDescription>
          </DialogHeader>

          {/* 当前账号信息概览 */}
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">员工</span>
              <span className="font-medium">
                {scopeEdit?.name ?? "-"}
                <span className="ml-1.5 text-xs text-muted-foreground">{scopeEdit?.employeeNo}</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">登录账号</span>
              <span className="font-medium">{scopeEdit?.account?.username ?? "未创建"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">当前范围</span>
              <span className="font-medium">
                {scopeEdit?.account?.departmentScope === "SPEC" && (scopeEdit.account.departmentIds?.length ?? 0) > 0
                  ? `本部门 +${scopeEdit.account.departmentIds.length} 个扩展部门`
                  : "仅本部门"}
              </span>
            </div>
          </div>

          {/* 范围模式选择 */}
          <div className="grid gap-2">
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                scope === "ALL" ? "border-primary/60 bg-primary/[0.06]" : "hover:bg-accent/40"
              }`}
            >
              <input
                type="radio"
                name="dept-scope"
                value="ALL"
                aria-label="数据范围-本部门"
                className="sr-only"
                checked={scope === "ALL"}
                onChange={() => {
                  setScope("ALL");
                  setScopeDeptIds([]);
                }}
              />
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  scope === "ALL" ? "border-primary" : "border-muted-foreground/40"
                }`}
              >
                {scope === "ALL" && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span>
                <span className="block text-sm font-medium">仅本部门（默认）</span>
                <span className="block text-xs text-muted-foreground">只能访问本部门及下属部门的数据</span>
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                scope === "SPEC" ? "border-primary/60 bg-primary/[0.06]" : "hover:bg-accent/40"
              }`}
            >
              <input
                type="radio"
                name="dept-scope"
                value="SPEC"
                aria-label="数据范围-扩展其他部门"
                className="sr-only"
                checked={scope === "SPEC"}
                onChange={() => setScope("SPEC")}
              />
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  scope === "SPEC" ? "border-primary" : "border-muted-foreground/40"
                }`}
              >
                {scope === "SPEC" && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span>
                <span className="block text-sm font-medium">扩展其他部门</span>
                <span className="block text-xs text-muted-foreground">在本部门之外，追加选择需要监管的部门</span>
              </span>
            </label>
          </div>

          {/* 扩展部门勾选 */}
          {scope === "SPEC" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  已选 <span className="font-medium text-foreground">{scopeDeptIds.length}</span> 个扩展部门
                </span>
                {scopeDeptIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setScopeDeptIds([])}
                  >
                    清空
                  </Button>
                )}
              </div>
              {departments.length === 0 ? (
                <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                  暂无部门，请先在部门管理中创建
                </div>
              ) : (
                <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
                  {departments.map((d) => {
                    const on = scopeDeptIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-accent/40"
                      >
                        <Checkbox
                          aria-label={`范围部门-${d.name}`}
                          checked={on}
                          onCheckedChange={() =>
                            setScopeDeptIds((prev) =>
                              on ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                            )
                          }
                        />
                        {d.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setScopeEdit(null)} disabled={scopeSaving}>
              取消
            </Button>
            <Button onClick={handleSaveScope} disabled={scopeSaving}>
              {scopeSaving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={activeEdit !== null}
        onOpenChange={(v) => {
          if (!v) setActiveEdit(null);
        }}
        title={activeEdit?.account?.isActive ? "停用账号" : "启用账号"}
        description={
          activeEdit?.account
            ? activeEdit.account.isActive
              ? `确定要停用账号「${activeEdit.account.username}」吗？停用后该账号将无法登录。`
              : `确定要启用账号「${activeEdit.account.username}」吗？`
            : ""
        }
        confirmText={activeEdit?.account?.isActive ? "确认停用" : "确认启用"}
        onConfirm={handleToggleActive}
      />

      <ExportPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={exportData}
        columns={exportColumns}
        onExport={handleExport}
        loading={exportLoading}
      />
    </div>
  );
}
