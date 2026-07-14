"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
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
import { Plus, Pencil, Trash2, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createEmployee,
  deleteEmployee,
  updateEmployee,
} from "@/actions/employee.actions";
import { exportEmployeesToExcel, importEmployeesFromExcel } from "@/actions/excel.actions";

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
    cell: () => "-",
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => {
      const emp = row.original;
      return (
        <div className="flex items-center gap-1 justify-center">
          <EmployeeActionButtons employee={emp} departments={(emp as any)._departments} />
        </div>
      );
    },
  },
];

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
  const [editEmployeeNo, setEditEmployeeNo] = useState(employee.employeeNo);
  const [editName, setEditName] = useState(employee.name);
  const [editDepartmentId, setEditDepartmentId] = useState(employee.departmentId.toString());
  const [editPhone, setEditPhone] = useState(employee.phone ?? "");
  const [editEmail, setEditEmail] = useState(employee.email ?? "");
  const [editLoading, setEditLoading] = useState(false);
  const { toast } = useToast();

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

  const handleEdit = async () => {
    if (!editEmployeeNo.trim() || !editName.trim() || !editDepartmentId) return;
    setEditLoading(true);
    const result = await updateEmployee(employee.id, {
      employeeNo: editEmployeeNo.trim(),
      name: editName.trim(),
      departmentId: Number(editDepartmentId),
      phone: editPhone.trim() || undefined,
      email: editEmail.trim() || undefined,
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
      setEditEmployeeNo(employee.employeeNo);
      setEditName(employee.name);
      setEditDepartmentId(employee.departmentId.toString());
      setEditPhone(employee.phone ?? "");
      setEditEmail(employee.email ?? "");
    }
    setEditOpen(open);
  };

  return (
    <>
      <Button variant="ghost" size="icon" title="编辑" onClick={() => handleEditOpen(true)}>
        <Pencil className="h-4 w-4 text-primary" />
      </Button>
      <Button variant="ghost" size="icon" title="删除" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑员工</DialogTitle>
            <DialogDescription>修改员工信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>工号</Label>
                <Input value={editEmployeeNo} onChange={(e) => setEditEmployeeNo(e.target.value)} placeholder="请输入工号" />
              </div>
              <div className="space-y-2">
                <Label>姓名</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="请输入姓名" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>部门</Label>
              <Select value={editDepartmentId} onValueChange={setEditDepartmentId}>
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>电话</Label>
                <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="可选" />
              </div>
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="可选" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editEmployeeNo.trim() || !editName.trim() || !editDepartmentId}>
              {editLoading ? "更新中..." : "确认"}
            </Button>
          </DialogFooter>
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
  const [employeeNo, setEmployeeNo] = useState("");
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!employeeNo.trim() || !name.trim() || !departmentId) return;
    setLoading(true);
    const result = await createEmployee({
      employeeNo: employeeNo.trim(),
      name: name.trim(),
      departmentId: Number(departmentId),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCreateOpen(false);
      setEmployeeNo("");
      setName("");
      setDepartmentId("");
      setPhone("");
      setEmail("");
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

  const dataWithDepartments = employees.map((e) => ({
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
            <Button variant="outline" onClick={handleExport} disabled={exportLoading}>
              <Download className="mr-2 h-4 w-4" />
              {exportLoading ? "导出中..." : "导出 Excel"}
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
      <DataTable columns={columns} data={dataWithDepartments} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建员工</DialogTitle>
            <DialogDescription>添加新的员工信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>工号</Label>
                <Input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="请输入工号" />
              </div>
              <div className="space-y-2">
                <Label>姓名</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入姓名" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>部门</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>电话</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="可选" />
              </div>
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可选" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={loading || !employeeNo.trim() || !name.trim() || !departmentId}>
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}