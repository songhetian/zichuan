import { getAssets } from "@/actions/asset.actions";
import { getDeviceTemplates } from "@/actions/device-template.actions";
import { AssetListClient } from "./asset-list-client";
import { prisma } from "@/lib/prisma";

export default async function AssetsPage() {
  const [assetsResult, templatesResult] = await Promise.all([
    getAssets({}),
    getDeviceTemplates({}),
  ]);

  if (!assetsResult.success) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">{assetsResult.error}</p>
      </div>
    );
  }

  const assets = assetsResult.data;
  const templates = templatesResult.success
    ? templatesResult.data.map((t) => ({ id: t.id, name: t.name }))
    : [];

  // 补全 departmentName：提取所有 employeeIds，批量查询员工及其部门
  const employeeIds = [
    ...new Set(assets.filter((a) => a.employeeId).map((a) => a.employeeId!)),
  ];
  const employeeMap = new Map<number, { departmentName: string }>();
  if (employeeIds.length > 0) {
    const emps = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        department: { select: { name: true } },
      },
    });
    emps.forEach((e) =>
      employeeMap.set(e.id, { departmentName: e.department.name })
    );
  }
  const assetsWithDept = assets.map((a) => ({
    ...a,
    departmentName: a.employeeId
      ? employeeMap.get(a.employeeId)?.departmentName ?? null
      : null,
  }));

  // 查询分类、部门、员工列表
  const [categories, departments, employees] = await Promise.all([
    prisma.assetCategory.findMany({ orderBy: { id: "asc" } }),
    prisma.department.findMany({ orderBy: { id: "asc" } }),
    prisma.employee.findMany({
      include: { department: { select: { name: true } } },
      orderBy: { id: "asc" },
    }),
  ]);

  return (
    <AssetListClient
      assets={assetsWithDept}
      templates={templates}
      categories={categories}
      employees={employees.map((e) => ({
        id: e.id,
        name: e.name,
        departmentName: e.department.name,
      }))}
      departments={departments}
    />
  );
}