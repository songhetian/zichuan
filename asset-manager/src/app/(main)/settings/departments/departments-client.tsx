"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/actions/department.actions";

export function DepartmentsClient({ initialDepartments }: { initialDepartments: { id: number; name: string }[] }) {
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
    <div className="space-y-4">
      <PageHeader
        title="部门管理"
        description="管理部门信息"
      />

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
                    <div className="flex items-center gap-1 justify-center">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(dept)}>
                        <Pencil className="h-4 w-4 text-primary" />
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
    </div>
  );
}