export const dynamic = 'force-dynamic';

import { getDepartments } from "@/actions/department.actions";
import { prisma } from "@/lib/prisma";
import { DepartmentsClient } from "./departments-client";

export default async function DepartmentsPage() {
  const deptResult = await getDepartments();
  const departments = deptResult.success ? deptResult.data : [];

  // 可选作部门负责人的员工列表
  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true },
    orderBy: { employeeNo: "asc" },
  });

  return <DepartmentsClient initialDepartments={departments} employees={employees} />;
}