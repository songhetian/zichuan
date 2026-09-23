export const dynamic = 'force-dynamic';

import { getAdmins, getRoles } from "@/actions/admin.actions";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const [adminsRes, rolesRes] = await Promise.all([getAdmins(), getRoles()]);
  const admins = adminsRes.success ? adminsRes.data : [];
  const roles = rolesRes.success ? rolesRes.data : [];

  return <UsersClient initialAdmins={admins} roles={roles} />;
}
