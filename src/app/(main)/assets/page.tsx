export const dynamic = 'force-dynamic';

import { getAssets } from "@/actions/asset.actions";
import { getDeviceTemplates } from "@/actions/device-template.actions";
import { AssetListClient } from "./asset-list-client";
import { prisma } from "@/lib/prisma";

export default async function AssetsPage() {
  // 第一轮：并行获取设备数据、模板、分类、部门、员工列表（这些互不依赖）
  const [assetsResult, templatesResult, categories, departments, employees] = await Promise.all([
    getAssets({}),
    getDeviceTemplates({}),
    prisma.assetCategory.findMany({ orderBy: { id: "asc" } }),
    prisma.department.findMany({ orderBy: { id: "asc" } }),
    prisma.employee.findMany({
      include: { department: { select: { name: true } } },
      orderBy: { id: "asc" },
    }),
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

  // 第二轮：用已查询的 employees 补全 departmentName，无需再查数据库
  const employeeMap = new Map<number, string>();
  employees.forEach((e) => employeeMap.set(e.id, e.department.name));

  const assetsWithDept = assets.map((a) => ({
    ...a,
    departmentName: a.employeeId
      ? employeeMap.get(a.employeeId) ?? null
      : null,
  }));

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