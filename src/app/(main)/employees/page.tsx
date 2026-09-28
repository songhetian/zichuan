export const dynamic = 'force-dynamic';

import { getEmployees } from "@/actions/employee.actions";
import { getDepartments } from "@/actions/department.actions";
import { getAdmins, getRoles } from "@/actions/admin.actions";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { EmployeeListClient } from "./employee-list-client";

export default async function EmployeesPage() {
  const user = await getCurrentUser();

  const [employeesResult, departmentsResult] = await Promise.all([
    getEmployees({}),
    getDepartments(),
  ]);

  const employees = employeesResult.success ? employeesResult.data : [];
  const departments = departmentsResult.success ? departmentsResult.data : [];

  // 账号信息（登录账号/角色/数据范围/启用状态）仅对拥有「账号与权限管理」权限的账号可见，
  // 按员工 id 合并到员工行上；无该权限时不拉取账号数据，避免信息泄露。
  let canManageAccounts = false;
  let roles: { id: number; key: string; name: string }[] = [];
  const accountByEmployee = new Map<
    number,
    {
      id: number;
      username: string;
      displayName: string | null;
      isActive: boolean;
      role: { key: string; name: string } | null;
      departmentScope: string;
      departmentIds: number[];
    }
  >();

  if (user) {
    canManageAccounts = await hasPermission({ id: user.id }, "system.account.manage");
  }
  if (canManageAccounts) {
    const [adminsRes, rolesRes] = await Promise.all([getAdmins(), getRoles()]);
    if (adminsRes.success) {
      for (const a of adminsRes.data) {
        if (a.employee) accountByEmployee.set(a.employee.id, a);
      }
    }
    if (rolesRes.success) {
      roles = rolesRes.data.map((r) => ({ id: r.id, key: r.key, name: r.name }));
    }
  }

  return (
    <EmployeeListClient
      employees={employees.map((e) => ({
        ...e,
        account: accountByEmployee.get(e.id) ?? null,
      }))}
      departments={departments}
      canManageAccounts={canManageAccounts}
      roles={roles}
    />
  );
}
