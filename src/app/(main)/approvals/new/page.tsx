export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { getUpgradeAssetOptions, getApprovalDelegationTargets } from "@/lib/approval-scope";
import { prisma } from "@/lib/prisma";
import { NewRequestClient } from "./new-request-client";

export default async function NewApprovalPage() {
  // 数据范围（权限矩阵 §6）：普通员工仅本人名下设备，资产管理员可见全部
  const user = await getCurrentUser();
  const assets = user ? await getUpgradeAssetOptions(user.id) : [];

  // 主管代申：可代为申请的下属员工及其名下设备（无代申权限时为空数组，前端隐藏入口）
  const delegation = user ? await getApprovalDelegationTargets(user.id) : [];

  // 发起人可选设备各自的「已有配件类别」：Asset → AssetComponent → ComponentModel.category
  const assetComponents = await prisma.assetComponent.findMany({
    where: { assetId: { in: assets.map((a) => a.id) } },
    select: {
      assetId: true,
      model: {
        select: {
          categoryId: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
  });

  const assetCats = Array.from(
    new Map(
      assetComponents.map((c) => {
        const key = `${c.assetId}:${c.model.categoryId}`;
        return [
          key,
          {
            assetId: c.assetId,
            categoryId: c.model.categoryId,
            categoryName: c.model.category.name,
          },
        ] as const;
      })
    ).values()
  );

  // 离职流程(DEPART)不选设备，改为选离职员工：在职员工列表
  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true },
    orderBy: { employeeNo: "asc" },
  });

  // 加购配件(PURCHASE)：配件全部分类 → 该分类下的型号（含品牌）
  const componentModels = await prisma.componentModel.findMany({
    select: {
      id: true,
      name: true,
      brand: true,
      categoryId: true,
      category: { select: { id: true, name: true } },
    },
    orderBy: { categoryId: "asc" },
  });
  const componentCatalog = Array.from(
    new Map(
      componentModels.map((m) => [
        m.categoryId,
        {
          id: m.categoryId,
          name: m.category.name,
          models: [] as { id: number; name: string; brand: string | null }[],
        },
      ])
    ).values()
  ).map((cat) => ({
    ...cat,
    models: componentModels
      .filter((m) => m.categoryId === cat.id)
      .map((m) => ({ id: m.id, name: m.name, brand: m.brand })),
  }));

  return (
    <NewRequestClient
      assets={assets}
      assetCats={assetCats}
      employees={employees}
      delegation={delegation}
      componentCatalog={componentCatalog}
    />
  );
}