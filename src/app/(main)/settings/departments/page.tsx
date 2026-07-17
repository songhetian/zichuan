export const dynamic = 'force-dynamic';

import { getDepartments } from "@/actions/department.actions";
import { DepartmentsClient } from "./departments-client";

export default async function DepartmentsPage() {
  const deptResult = await getDepartments();
  const departments = deptResult.success ? deptResult.data : [];

  return <DepartmentsClient initialDepartments={departments} />;
}