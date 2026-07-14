"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2, Upload, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/actions/department.actions";
import {
  getAssetCategories,
  createAssetCategory,
  updateAssetCategory,
  deleteAssetCategory,
} from "@/actions/asset-category.actions";
import {
  getComponentCategories,
  createComponentCategory,
  updateComponentCategory,
  deleteComponentCategory,
} from "@/actions/component-category.actions";
import { changePassword } from "@/actions/auth.actions";
import { exportAssetsToExcel, exportEmployeesToExcel, exportComponentsToExcel } from "@/actions/excel.actions";

interface SettingsPageProps {
  initialDepartments: { id: number; name: string }[];
  initialAssetCategories: { id: number; name: string; code: string; parentId: number | null }[];
  initialComponentCategories: { id: number; name: string; parentId: number | null }[];
}

export function SettingsClient({
  initialDepartments,
  initialAssetCategories,
  initialComponentCategories,
}: SettingsPageProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="系统设置"
        description="管理系统基础配置"
      />
      <Tabs defaultValue="departments">
        <TabsList>
          <TabsTrigger value="departments">部门管理</TabsTrigger>
          <TabsTrigger value="asset-categories">设备分类</TabsTrigger>
          <TabsTrigger value="component-categories">配件分类</TabsTrigger>
          <TabsTrigger value="data">数据导入导出</TabsTrigger>
          <TabsTrigger value="password">账号设置</TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <DepartmentManager initialDepartments={initialDepartments} />
        </TabsContent>

        <TabsContent value="asset-categories">
          <AssetCategoryManager initialCategories={initialAssetCategories} />
        </TabsContent>

        <TabsContent value="component-categories">
          <ComponentCategoryManager initialCategories={initialComponentCategories} />
        </TabsContent>

        <TabsContent value="data">
          <DataIOSection />
        </TabsContent>

        <TabsContent value="password">
          <PasswordSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// 部门管理
// ============================================================

function DepartmentManager({ initialDepartments }: { initialDepartments: { id: number; name: string }[] }) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const result = await createDepartment({ name: name.trim() });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setDepartments([...departments, result.data]);
      setCreateOpen(false);
      setName("");
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!currentId || !name.trim()) return;
    setLoading(true);
    const result = await updateDepartment(currentId, { name: name.trim() });
    setLoading(false);
    if (result.success) {
      toast({ title: "更新成功" });
      setDepartments(departments.map((d) => (d.id === currentId ? { ...d, name: result.data.name } : d)));
      setEditOpen(false);
      setName("");
      setCurrentId(null);
    } else {
      toast({ title: "更新失败", description: result.error, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!currentId) return;
    const result = await deleteDepartment(currentId);
    if (result.success) {
      toast({ title: "删除成功" });
      setDepartments(departments.filter((d) => d.id !== currentId));
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
    setCurrentId(null);
  };

  const openEdit = (dept: { id: number; name: string }) => {
    setCurrentId(dept.id);
    setName(dept.name);
    setEditOpen(true);
  };

  const openDelete = (id: number) => {
    setCurrentId(id);
    setDeleteOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>部门列表</CardTitle>
        <Button size="sm" onClick={() => { setName(""); setCreateOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" />新建
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>部门名称</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.map((dept) => (
              <TableRow key={dept.id}>
                <TableCell>{dept.name}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(dept)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openDelete(dept.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>新建部门</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>部门名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入部门名称" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={loading || !name.trim()}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>编辑部门</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>部门名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
              <Button onClick={handleEdit} disabled={loading || !name.trim()}>
                {loading ? "更新中..." : "确认"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="确认删除"
          description="确定要删除该部门吗？"
          confirmText="删除"
          variant="destructive"
          onConfirm={handleDelete}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================
// 设备分类管理
// ============================================================

function AssetCategoryManager({
  initialCategories,
}: {
  initialCategories: { id: number; name: string; code: string; parentId: number | null }[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [catName, setCatName] = useState("");
  const [catCode, setCatCode] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!catName.trim() || !catCode.trim()) return;
    setLoading(true);
    const result = await createAssetCategory({ name: catName.trim(), code: catCode.trim() });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCategories([...categories, result.data]);
      setCreateOpen(false);
      setCatName("");
      setCatCode("");
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!currentId) return;
    const result = await deleteAssetCategory(currentId);
    if (result.success) {
      toast({ title: "删除成功" });
      setCategories(categories.filter((c) => c.id !== currentId));
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
    setCurrentId(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>设备分类</CardTitle>
        <Button size="sm" onClick={() => { setCatName(""); setCatCode(""); setCreateOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" />新建
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>分类名称</TableHead>
              <TableHead>编码</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell>{cat.name}</TableCell>
                <TableCell className="font-mono">{cat.code}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => { setCurrentId(cat.id); setDeleteOpen(true); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>新建设备分类</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>分类名称</Label>
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="如：笔记本电脑" />
              </div>
              <div className="space-y-2">
                <Label>分类编码</Label>
                <Input value={catCode} onChange={(e) => setCatCode(e.target.value)} placeholder="如：LAPTOP" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={loading || !catName.trim() || !catCode.trim()}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="确认删除"
          description="确定要删除该分类吗？"
          confirmText="删除"
          variant="destructive"
          onConfirm={handleDelete}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================
// 配件分类管理
// ============================================================

function ComponentCategoryManager({
  initialCategories,
}: {
  initialCategories: { id: number; name: string; parentId: number | null }[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [catName, setCatName] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!catName.trim()) return;
    setLoading(true);
    const result = await createComponentCategory({ name: catName.trim() });
    setLoading(false);
    if (result.success) {
      toast({ title: "创建成功" });
      setCategories([...categories, result.data]);
      setCreateOpen(false);
      setCatName("");
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!currentId) return;
    const result = await deleteComponentCategory(currentId);
    if (result.success) {
      toast({ title: "删除成功" });
      setCategories(categories.filter((c) => c.id !== currentId));
    } else {
      toast({ title: "删除失败", description: result.error, variant: "destructive" });
    }
    setDeleteOpen(false);
    setCurrentId(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>配件分类</CardTitle>
        <Button size="sm" onClick={() => { setCatName(""); setCreateOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" />新建
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>分类名称</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell>{cat.name}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => { setCurrentId(cat.id); setDeleteOpen(true); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>新建配件分类</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>分类名称</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="如：内存" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={loading || !catName.trim()}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="确认删除"
          description="确定要删除该分类吗？"
          confirmText="删除"
          variant="destructive"
          onConfirm={handleDelete}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================
// 数据导入导出
// ============================================================

function DataIOSection() {
  const { toast } = useToast();
  const [loading, setLoading] = useState("");

  const handleExport = async (type: "assets" | "employees" | "components") => {
    setLoading(type);
    try {
      let result;
      if (type === "assets") result = await exportAssetsToExcel();
      else if (type === "employees") result = await exportEmployeesToExcel();
      else result = await exportComponentsToExcel();

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
    setLoading("");
  };

  const handleImport = async (type: "employees" | "components") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setLoading(type);
      const buffer = Buffer.from(await file.arrayBuffer());
      try {
        const { importEmployeesFromExcel, importComponentModelsFromExcel } = await import("@/actions/excel.actions");
        let result;
        if (type === "employees") {
          result = await importEmployeesFromExcel({ buffer });
        } else {
          result = await importComponentModelsFromExcel({ buffer });
        }
        if (result.success) {
          const desc = result.data.errors.length > 0
            ? `成功 ${result.data.importedCount} 条，失败 ${result.data.errors.length} 条`
            : `成功导入 ${result.data.importedCount} 条`;
          toast({ title: "导入完成", description: desc });
        } else {
          toast({ title: "导入失败", description: result.error, variant: "destructive" });
        }
      } catch {
        toast({ title: "导入失败", variant: "destructive" });
      }
      setLoading("");
    };
    input.click();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>数据导入导出</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h4 className="text-sm font-medium mb-3">数据导出</h4>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleExport("assets")} disabled={!!loading}>
              <Download className="mr-2 h-4 w-4" />
              {loading === "assets" ? "导出中..." : "导出设备档案"}
            </Button>
            <Button variant="outline" onClick={() => handleExport("employees")} disabled={!!loading}>
              <Download className="mr-2 h-4 w-4" />
              {loading === "employees" ? "导出中..." : "导出员工列表"}
            </Button>
            <Button variant="outline" onClick={() => handleExport("components")} disabled={!!loading}>
              <Download className="mr-2 h-4 w-4" />
              {loading === "components" ? "导出中..." : "导出配件型号"}
            </Button>
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="text-sm font-medium mb-3">数据导入</h4>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleImport("employees")} disabled={!!loading}>
              <Upload className="mr-2 h-4 w-4" />
              {loading === "employees" ? "导入中..." : "导入员工"}
            </Button>
            <Button variant="outline" onClick={() => handleImport("components")} disabled={!!loading}>
              <Upload className="mr-2 h-4 w-4" />
              {loading === "components" ? "导入中..." : "导入配件型号"}
            </Button>
          </div>
        </div>

        <Separator />

        <div>
          <h4 className="text-sm font-medium mb-3">标签打印</h4>
          <p className="text-sm text-muted-foreground">标签打印功能可在设备详情页或设备列表页进行操作。</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 账号设置
// ============================================================

function PasswordSection() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      toast({ title: "请填写完整信息", variant: "destructive" });
      return;
    }
    setLoading(true);
    const result = await changePassword({ oldPassword, newPassword });
    setLoading(false);
    if (result.success) {
      toast({ title: "密码修改成功" });
      setOldPassword("");
      setNewPassword("");
    } else {
      toast({ title: "修改失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>修改密码</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label>旧密码</Label>
          <Input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="请输入旧密码"
          />
        </div>
        <div className="space-y-2">
          <Label>新密码</Label>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="请输入新密码"
          />
        </div>
        <Button onClick={handleChangePassword} disabled={loading || !oldPassword || !newPassword}>
          {loading ? "修改中..." : "确认修改"}
        </Button>
      </CardContent>
    </Card>
  );
}
