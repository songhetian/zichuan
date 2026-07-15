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

  // 补全 departmentName
  let assets = assetsResult.success ? assetsResult.data : [];
  if (assets.length > 0) {
    const employeeIds = [...new Set(assets.filter((a) => a.employeeId).map((a) => a.employeeId!))];
    const empMap = new Map<number, { departmentName: string }>();
    if (employeeIds.length > 0) {
      const emps = await prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, department: { select: { name: true } } },
      });
      emps.forEach((e) => empMap.set(e.id, { departmentName: e.department.name }));
    }
    assets = assets.map((a) => ({
      ...a,
      departmentName: a.employeeId ? empMap.get(a.employeeId)?.departmentName ?? "" : "",
    }));
  }

  const assetItems = assets.map((a) => ({
    id: a.id,
    assetNo: a.assetNo,
    name: a.name,
    status: a.status,
    employeeName: a.employeeName ?? "",
    departmentName: (a as any).departmentName ?? "",
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
