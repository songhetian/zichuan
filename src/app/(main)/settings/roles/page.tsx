export const dynamic = 'force-dynamic';

import { getRoles } from "@/actions/admin.actions";
import { PERMISSION_MODULES } from "@/lib/permissions";
import { RolesClient } from "./roles-client";

export default async function RolesPage() {
  const rolesRes = await getRoles();
  const roles = rolesRes.success ? rolesRes.data : [];

  return <RolesClient initialRoles={roles} modules={PERMISSION_MODULES} />;
}