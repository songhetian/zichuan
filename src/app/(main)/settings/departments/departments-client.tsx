"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/actions/department.actions";
import { ActionButtons } from "@/components/features/action-buttons";
import { SimpleCrudDialog } from "@/components/features/simple-crud-dialog";

type Department = { id: number; name: string };

const PAGE_SIZE = 10;

export function DepartmentsClient({ initialDepartments }: { initialDepartments: Department[] }) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();

  const totalPages = Math.ceil(departments.length / PAGE_SIZE);
  const paginatedDepartments = departments.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleCreate = async (name: string) => {
    const result = await createDepartment({ name });
    if (result.success) {
      setDepartments([...departments, result.data]);
    }
    return result;
  };

  const handleEdit = async (id: number, name: string) => {
    const result = await updateDepartment(id, { name });
    if (result.success) {
      setDepartments(departments.map((d) => (d.id === id ? { ...d, name: result.data.name } : d)));
    }
    return result;
  };

  const handleDelete = async (id: number) => {
    const result = await deleteDepartment(id);
    if (result.success) {
      setDepartments(departments.filter((d) => d.id !== id));
    }
    return result;
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
          <Button size="sm" onClick={() => setCreateOpen(true)}>
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
              {paginatedDepartments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell>{dept.name}</TableCell>
                  <TableCell>
                    <ActionButtons
                      id={dept.id}
                      name={dept.name}
                      onEdit={(v) => handleEdit(dept.id, v.name)}
                      onDelete={() => handleDelete(dept.id)}
                      editTitle="编辑部门"
                      editFields={[{ key: "name", label: "部门名称", type: "text" }]}
                      initialValues={{ name: dept.name }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            total={departments.length}
            current={currentPage}
            pageSize={PAGE_SIZE}
            onPageChange={setCurrentPage}
          />
        </CardContent>
      </Card>

      <SimpleCrudDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        title="新建部门"
        fields={[{ key: "name", label: "部门名称", type: "text", placeholder: "请输入部门名称" }]}
        onSubmit={async (v) => handleCreate(v.name)}
      />
    </div>
  );
}