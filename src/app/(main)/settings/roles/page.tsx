export const dynamic = 'force-dynamic';

import { getRoles } from "@/actions/admin.actions";
import { getDepartments } from "@/actions/department.actions";
import { PERMISSION_MODULES } from "@/lib/permissions";
import { RolesClient } from "./roles-client";

export default async function RolesPage() {
  const rolesRes = await getRoles();
  const roles = rolesRes.success ? rolesRes.data : [];

  const deptRes = await getDepartments();
  const departments =
    deptRes.success
      ? deptRes.data.map((d) => ({ id: d.id, name: d.name }))
      : [];

  return <RolesClient initialRoles={roles} modules={PERMISSION_MODULES} departments={departments} />;
}