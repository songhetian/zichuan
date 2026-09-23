"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, UserCog } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { ListSearchInput } from "@/components/ui/list-search-input";
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
import { filterItemsByText } from "@/lib/list-search";

type Department = {
  id: number;
  name: string;
  managerId: number | null;
  manager: { id: number; name: string } | null;
};

type EmployeeOpt = { id: number; employeeNo: string; name: string };

const PAGE_SIZE = 10;

export function DepartmentsClient({
  initialDepartments,
  employees,
}: {
  initialDepartments: Department[];
  employees: EmployeeOpt[];
}) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [managerDept, setManagerDept] = useState<Department | null>(null);
  const router = useRouter();

  // 按部门名称过滤
  const filteredDepartments = useMemo(
    () => filterItemsByText(departments, search, (d) => d.name),
    [departments, search],
  );

  const totalPages = Math.ceil(filteredDepartments.length / PAGE_SIZE);
  const paginatedDepartments = filteredDepartments.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const managerOptions = employees.map((e) => ({
    value: String(e.id),
    label: `${e.employeeNo} · ${e.name}`,
  }));

  const handleCreate = async (name: string) => {
    const result = await createDepartment({ name });
    if (result.success) {
      setDepartments([
        ...departments,
        { id: result.data.id, name: result.data.name, managerId: null, manager: null },
      ]);
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

  const handleSetManager = async (values: Record<string, string>) => {
    if (!managerDept) return { success: false as const };
    const raw = values.managerId?.trim();
    const manager = raw ? employees.find((e) => e.id === Number(raw)) : undefined;
    const managerId = manager ? manager.id : null;

    const result = await updateDepartment(managerDept.id, { managerId });
    if (result.success) {
      setDepartments(
        departments.map((d) =>
          d.id === managerDept.id
            ? { ...d, managerId, manager: manager ? { id: manager.id, name: manager.name } : null }
            : d,
        ),
      );
    }
    return result;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="部门管理"
        description="管理部门信息"
      />

      <ListSearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setCurrentPage(1);
        }}
        placeholder="搜索部门名称"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>部门列表</CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />新建
          </Button>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>部门名称</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead className="w-[260px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDepartments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell>{dept.name}</TableCell>
                  <TableCell>{dept.manager?.name ?? "未设置"}</TableCell>
                  <TableCell className="w-[260px]">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="设置部门负责人"
                        onClick={() => setManagerDept(dept)}
                      >
                        <UserCog className="mr-1 h-4 w-4 text-primary" />设置负责人
                      </Button>
                      <ActionButtons
                        id={dept.id}
                        name={dept.name}
                        onEdit={(v) => handleEdit(dept.id, v.name)}
                        onDelete={() => handleDelete(dept.id)}
                        editTitle="编辑部门"
                        editFields={[{ key: "name", label: "部门名称", type: "text" }]}
                        initialValues={{ name: dept.name }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            total={filteredDepartments.length}
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

      <SimpleCrudDialog
        open={!!managerDept}
        onOpenChange={(v) => { if (!v) setManagerDept(null); }}
        mode="edit"
        title={`设置部门负责人 · ${managerDept?.name ?? ""}`}
        fields={[
          {
            key: "managerId",
            label: "部门负责人",
            type: "select",
            placeholder: "选择部门负责人",
            options: managerOptions,
            optional: true,
            hint: "选择该部门主管；留空可清除负责人",
          },
        ]}
        initialValues={{ managerId: managerDept?.managerId != null ? String(managerDept.managerId) : "" }}
        onSubmit={handleSetManager}
      />
    </div>
  );
}