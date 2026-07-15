"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { FilterBar } from "@/components/features/filter-bar";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
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
import { Plus, Pencil, Trash2, Download, Upload, ChevronRight, Loader2, Monitor, History, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createEmployee,
  deleteEmployee,
  updateEmployee,
  getEmployeeAssets,
  type EmployeeAsset,
} from "@/actions/employee.actions";
import { exportEmployeesToExcel, importEmployeesFromExcel } from "@/actions/excel.actions";
import { getSystemLogs } from "@/actions/system-log.actions";

const employeeSchema = z.object({
  employeeNo: z.string().min(1, "工号不能为空"),
  name: z.string().min(1, "姓名不能为空"),
  departmentId: z.string().min(1, "请选择部门"),
  email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
  phone: z.string().optional(),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

interface Employee {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  departmentName: string;
  phone: string | null;
  email: string | null;
  assetCount?: number;
}

interface EmployeeListClientProps {
  employees: Employee[];
  departments: { id: number; name: string }[];
}

const columns: ColumnDef<Employee & { _departments: { id: number; name: string }[] }>[] = [
  { accessorKey: "employeeNo", header: "工号" },
  { accessorKey: "name", header: "姓名" },
  {
    accessorKey: "departmentName",
    header: "部门",
    cell: ({ row }) => row.original.departmentName ?? "-",
  },
  {
    accessorKey: "phone",
    header: "电话",
    cell: ({ row }) => row.getValue("phone") ?? "-",
  },
  {
    accessorKey: "email",
    header: "邮箱",
    cell: ({ row }) => row.getValue("email") ?? "-",
  },
  {
    id: "assetCount",
    header: "在用设备数",
    cell: ({ row }) => {
      const count = row.original.assetCount ?? 0;
      return (
        <span className={count > 0 ? "font-medium text-primary" : "text-muted-foreground"}>
          {count}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => {
      const emp = row.original;
      return (
        <div className="flex items-center gap-1 justify-center">
          <EmployeeActionButtons employee={emp} departments={emp._departments} />
        </div>
      );
    },
  },
];

function ExpandedEmployeeRow({ employee }: { employee: Employee }) {
  const [assets, setAssets] = useState<EmployeeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<{ id: number; module: string; action: string; detail: string; operator: string; createdAt: Date }[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"assets" | "history">("assets");

  useEffect(() => {
    const loadAssets = async () => {
      setLoading(true);
      const result = await getEmployeeAssets(employee.id);
      setLoading(false);
      if (result.success) {
        setAssets(result.data);
      }
    };
    loadAssets();
  }, [employee.id]);

  const loadHistory = async () => {
    if (logs.length > 0 || logsLoading) return;
    setLogsLoading(true);
    const result = await getSystemLogs({ keyword: employee.name });
    setLogsLoading(false);
    if (result.success) {
      const relevantLogs = result.data.filter(
        (log) => log.module === "分配" || log.module === "归还" || log.module === "调拨"
      );
      setLogs(relevantLogs);
    }
  };

  const statusMap: Record<string, { label: string; className: string }> = {
    IDLE: { label: "闲置", className: "bg-gray-100 text-gray-700" },
    IN_USE: { label: "在用", className: "bg-green-100 text-green-700" },
    IN_MAINTENANCE: { label: "维修中", className: "bg-yellow-100 text-yellow-700" },
    SCRAPPED: { label: "已报废", className: "bg-red-100 text-red-700" },
  };

  const moduleColorMap: Record<string, string> = {
    "分配": "text-green-600 bg-green-50",
    "归还": "text-orange-600 bg-orange-50",
    "调拨": "text-blue-600 bg-blue-50",
  };

  return (
    <div className="bg-muted/30 p-4 animate-in slide-in-from-top-1">
      <div className="flex gap-2 mb-4 border-b pb-2">
        <Button
          type="button"
          variant={activeTab === "assets" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("assets")}
          className="gap-2"
        >
          <Monitor className="h-4 w-4" />
          在用设备
        </Button>
        <Button
          type="button"
          variant={activeTab === "history" ? "default" : "ghost"}
          size="sm"
          onClick={() => {
            setActiveTab("history");
            loadHistory();
          }}
          className="gap-2"
        >
          <History className="h-4 w-4" />
          分配历史
        </Button>
      </div>

      {activeTab === "assets" && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Monitor className="mb-2 h-8 w-8 opacity-50" />
              <span className="text-sm">暂无分配设备</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground mb-3">
                分配设备列表（{assets.length} 台）
              </div>
              <div className="grid gap-2">
                {assets.map((asset) => {
                  const status = statusMap[asset.status] ?? statusMap.IDLE;
                  return (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between rounded-md border bg-background p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Monitor className="h-5 w-5 text-primary" />
                        <div>
                          <div className="font-medium">{asset.assetNo}</div>
                          <div className="text-xs text-muted-foreground">
                            {asset.name} · {asset.categoryName} · {asset.templateName}
                          </div>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "history" && (
        <>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <History className="mb-2 h-8 w-8 opacity-50" />
              <span className="text-sm">暂无分配历史记录</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground mb-3">
                设备分配历史（{logs.length} 条）
              </div>
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 rounded-md border bg-background p-3"
                  >
                    <div className="mt-0.5">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${moduleColorMap[log.module] ?? "bg-gray-100 text-gray-700"}`}>
                          {log.module}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <div className="text-sm mt-1">{log.detail}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        操作人：{log.operator}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmployeeActionButtons({
  employee,
  departments,
}: {
  employee: Employee & { _departments?: { id: number; name: string }[] };
  departments?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const { toast } = useToast();

  const editForm = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNo: "",
      name: "",
      departmentId: "",
      phone: "",
      email: "",
    },
  });

  const handleDelete = async () => {
    const result = await deleteEmployee(employee.id);
    if (result.success) {
      toast({ title: "删除成功" });
      router.refresh();
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
  };

  const handleEdit = async (values: EmployeeFormValues) => {
    setEditLoading(true);
    const result = await updateEmployee(employee.id, {
      employeeNo: values.employeeNo.trim(),
      name: values.name.trim(),
      departmentId: Number(values.departmentId),
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
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

  const handleEditOpen = (open: boolean) => {
    if (open) {
      editForm.reset({
        employeeNo: employee.employeeNo,
        name: employee.name,
        departmentId: employee.departmentId.toString(),
        phone: employee.phone ?? "",
        email: employee.email ?? "",
      });
    }
    setEditOpen(open);
  };

  return (
    <>
      <Button type="button" variant="ghost" size="icon" title="编辑" onClick={() => handleEditOpen(true)}>
        <Pencil className="h-4 w-4 text-primary" />
      </Button>
      <Button type="button" variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

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
              <Select
                value={editForm.watch("departmentId")}
                onValueChange={(v) => editForm.setValue("departmentId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择部门" />
                </SelectTrigger>
                <SelectContent>
                  {(departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

export function EmployeeListClient({ employees, departments }: EmployeeListClientProps) {
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

  const createForm = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeNo: "",
      name: "",
      departmentId: "",
      phone: "",
      email: "",
    },
  });

  const handleCreate = async (values: EmployeeFormValues) => {
    setLoading(true);
    const result = await createEmployee({
      employeeNo: values.employeeNo.trim(),
      name: values.name.trim(),
      departmentId: Number(values.departmentId),
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      createForm.reset();
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const result = await exportEmployeesToExcel();
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
    return employees.filter((emp) => {
      const matchesDepartment =
        departmentFilter === "all" || emp.departmentId.toString() === departmentFilter;
      const matchesKeyword =
        !keyword.trim() ||
        emp.name.toLowerCase().includes(keyword.toLowerCase()) ||
        emp.employeeNo.toLowerCase().includes(keyword.toLowerCase());
      return matchesDepartment && matchesKeyword;
    });
  }, [employees, departmentFilter, keyword]);

  const dataWithDepartments = filteredEmployees.map((e) => ({
    ...e,
    _departments: departments,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="员工管理"
        description="管理员工信息"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={exportLoading}>
              <Download className="mr-2 h-4 w-4" />
              导出 Excel
            </Button>
            <Button variant="outline" onClick={handleImportClick} disabled={importLoading}>
              <Upload className="mr-2 h-4 w-4" />
              {importLoading ? "导入中..." : "导入 Excel"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建员工
            </Button>
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
      />
      <DataTable
        columns={columns}
        data={dataWithDepartments}
        renderExpandedRow={(employee) =>
          (employee.assetCount ?? 0) > 0 ? <ExpandedEmployeeRow employee={employee} /> : null
        }
      />

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
                <Input {...createForm.register("employeeNo")} placeholder="请输入工号" />
                {createForm.formState.errors.employeeNo && (
                  <p className="text-sm text-destructive">{createForm.formState.errors.employeeNo.message}</p>
                )}
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
              <Select
                value={createForm.watch("departmentId")}
                onValueChange={(v) => createForm.setValue("departmentId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择部门" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>导出预览</DialogTitle>
            <DialogDescription>
              共 {filteredEmployees.length} 条员工数据将被导出
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left font-medium p-2">工号</th>
                  <th className="text-left font-medium p-2">姓名</th>
                  <th className="text-left font-medium p-2">部门</th>
                  <th className="text-left font-medium p-2">电话</th>
                  <th className="text-left font-medium p-2">邮箱</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.slice(0, 50).map((emp) => (
                  <tr key={emp.id} className="border-t">
                    <td className="p-2">{emp.employeeNo}</td>
                    <td className="p-2">{emp.name}</td>
                    <td className="p-2">{emp.departmentName ?? "-"}</td>
                    <td className="p-2">{emp.phone ?? "-"}</td>
                    <td className="p-2">{emp.email ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredEmployees.length > 50 && (
              <div className="p-2 text-center text-sm text-muted-foreground border-t">
                仅显示前 50 条，共 {filteredEmployees.length} 条
              </div>
            )}
            {filteredEmployees.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                暂无数据
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>取消</Button>
            <Button onClick={handleExport} disabled={exportLoading || filteredEmployees.length === 0}>
              {exportLoading ? "导出中..." : "确认导出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}