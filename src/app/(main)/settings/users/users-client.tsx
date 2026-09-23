"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { SimpleCrudDialog } from "@/components/features/simple-crud-dialog";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { filterItemsByText } from "@/lib/list-search";
import {
  getAdmins,
  createAdmin,
  updateAdminRole,
  setAdminActive,
} from "@/actions/admin.actions";

type AdminRow = {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  role: { key: string; name: string } | null;
  employee: { id: number; name: string } | null;
};

type RoleOption = { id: number; key: string; name: string };

const PAGE_SIZE = 10;
/** 角色下拉里「不分配角色」的占位值（Radix Select 不允许空字符串值） */
const NONE_ROLE = "__none__";

export function UsersClient({
  initialAdmins,
  roles,
}: {
  initialAdmins: AdminRow[];
  roles: RoleOption[];
}) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [roleEdit, setRoleEdit] = useState<AdminRow | null>(null);
  const [activeEdit, setActiveEdit] = useState<AdminRow | null>(null);

  const filteredAdmins = useMemo(
    () =>
      filterItemsByText(
        admins,
        search,
        (a) => `${a.username} ${a.displayName ?? ""}`
      ),
    [admins, search]
  );
  const totalPages = Math.max(1, Math.ceil(filteredAdmins.length / PAGE_SIZE));
  const paginatedAdmins = filteredAdmins.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const refresh = async () => {
    const result = await getAdmins();
    if (result.success) setAdmins(result.data);
  };

  const roleOptions = [
    { value: NONE_ROLE, label: "不分配角色" },
    ...roles.map((r) => ({ value: String(r.id), label: r.name })),
  ];

  const handleCreate = async (v: Record<string, string>) => {
    const result = await createAdmin({
      username: v.username,
      password: v.password,
      roleId: v.roleId && v.roleId !== NONE_ROLE ? Number(v.roleId) : undefined,
      displayName: v.displayName || undefined,
    });
    if (result.success) await refresh();
    return result;
  };

  const handleRoleChange = async (v: Record<string, string>) => {
    if (!roleEdit) return { success: false, error: "" };
    const result = await updateAdminRole(
      roleEdit.id,
      v.roleId && v.roleId !== NONE_ROLE ? Number(v.roleId) : null
    );
    if (result.success) await refresh();
    return result;
  };

  const handleToggleActive = async () => {
    if (!activeEdit) return;
    const result = await setAdminActive(activeEdit.id, !activeEdit.isActive);
    if (result.success) {
      await refresh();
      setActiveEdit(null);
    }
  };

  // 编辑弹窗回显当前角色：按 key 反查角色 id
  const roleEditCurrentId = roleEdit?.role
    ? roles.find((r) => r.key === roleEdit.role!.key)?.id
    : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="用户管理" description="管理系统登录账号、角色与启用状态" />

      <ListSearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setCurrentPage(1);
        }}
        placeholder="搜索用户名或显示名"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>账号列表</CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />新建账号
          </Button>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>显示名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-[180px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedAdmins.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell>{admin.username}</TableCell>
                  <TableCell>{admin.displayName || "-"}</TableCell>
                  <TableCell>
                    {admin.role ? (
                      <Badge variant="secondary">{admin.role.name}</Badge>
                    ) : (
                      <span className="text-muted-foreground">未分配</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={admin.isActive ? "default" : "destructive"}>
                      {admin.isActive ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="w-[180px]">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="分配角色"
                        onClick={() => setRoleEdit(admin)}
                      >
                        分配角色
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title={admin.isActive ? "停用" : "启用"}
                        onClick={() => setActiveEdit(admin)}
                      >
                        {admin.isActive ? "停用" : "启用"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            total={filteredAdmins.length}
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
        title="新建账号"
        fields={[
          { key: "username", label: "用户名", type: "text", placeholder: "请输入用户名" },
          { key: "password", label: "密码", type: "password", placeholder: "请输入密码" },
          { key: "displayName", label: "显示名", type: "text", placeholder: "请输入显示名", optional: true },
          { key: "roleId", label: "角色", type: "select", placeholder: "请选择角色", optional: true, options: roleOptions },
        ]}
        onSubmit={handleCreate}
      />

      <SimpleCrudDialog
        open={roleEdit !== null}
        onOpenChange={(v) => {
          if (!v) setRoleEdit(null);
        }}
        mode="edit"
        title="分配角色"
        fields={[
          { key: "roleId", label: "角色", type: "select", placeholder: "请选择角色", options: roleOptions },
        ]}
        initialValues={{ roleId: roleEditCurrentId ? String(roleEditCurrentId) : NONE_ROLE }}
        onSubmit={handleRoleChange}
      />

      <ConfirmDialog
        open={activeEdit !== null}
        onOpenChange={(v) => {
          if (!v) setActiveEdit(null);
        }}
        title={activeEdit?.isActive ? "停用账号" : "启用账号"}
        description={
          activeEdit
            ? activeEdit.isActive
              ? `确定要停用账号「${activeEdit.username}」吗？停用后该账号将无法登录。`
              : `确定要启用账号「${activeEdit.username}」吗？`
            : ""
        }
        confirmText={activeEdit?.isActive ? "确认停用" : "确认启用"}
        onConfirm={handleToggleActive}
      />
    </div>
  );
}
