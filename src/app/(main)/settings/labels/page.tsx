export const dynamic = 'force-dynamic';

import { LabelsClient } from "./labels-client";
import { getAssets } from "@/actions/asset.actions";
import { getEmployees } from "@/actions/employee.actions";
import { getDepartments } from "@/actions/department.actions";
import { prisma } from "@/lib/prisma";

export default async function LabelsPage() {
  const [assetsResult, employeesResult, departmentsResult] = await Promise.all([
    getAssets({}),
    getEmployees({}),
    getDepartments(),
  ]);

  // 补全 departmentName —— 立即映射出带 departmentName 字段的类型，避免后续 as any
  const baseAssets = assetsResult.success ? assetsResult.data : [];
  const employeeIds = [...new Set(baseAssets.filter((a) => a.employeeId).map((a) => a.employeeId!))];
  const empDeptMap = new Map<number, string>();
  if (employeeIds.length > 0) {
    const emps = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, department: { select: { name: true } } },
    });
    emps.forEach((e) => empDeptMap.set(e.id, e.department.name));
  }
  const assets = baseAssets.map((a) => ({
    ...a,
    departmentName: a.employeeId ? empDeptMap.get(a.employeeId) ?? "" : "",
  }));

  const assetItems = assets.map((a) => ({
    id: a.id,
    assetNo: a.assetNo,
    name: a.name,
    status: a.status,
    employeeName: a.employeeName ?? "",
    departmentName: a.departmentName,
  }));

  const employees = employeesResult.success
    ? employeesResult.data.map((e) => ({
        id: e.id,
        name: e.name,
        departmentName: e.departmentName,
      }))
    : [];

  const departments = departmentsResult.success ? departmentsResult.data : [];

  return <LabelsClient assets={assetItems} employees={employees} departments={departments} />;
}
