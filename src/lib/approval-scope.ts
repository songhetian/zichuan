import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { hasPermission, resolveDepartmentScope } from "./permissions";

/**
 * 发起升级申请时用户可选的设备（数据范围，对应权限矩阵「查看本人资产」）：
 * 拥有 asset.manage 的资产管理员/超管可见全部设备；普通员工仅本人名下（employeeId 匹配）的设备。
 * 资产管理员被角色限定部门（'SPEC'）时，仅可选这些部门员工持有的设备。
 */
export async function getUpgradeAssetOptions(adminId: number) {
  const canManageAll = await hasPermission({ id: adminId }, "asset.manage");
  const me = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { employeeId: true },
  });
  // RESERVED(已预占) 设备不参与再次发起升级/降级选择（升级单占位期间的状态）
  const baseWhere = { status: { not: "RESERVED" as const } };
  let where: Prisma.AssetWhereInput = baseWhere;
  if (canManageAll) {
    const scope = await resolveDepartmentScope({ id: adminId });
    if (scope !== "ALL") {
      where = { ...baseWhere, employee: { departmentId: { in: scope } } };
    }
  } else {
    where = { ...baseWhere, employeeId: me?.employeeId ?? -1 };
  }
  return prisma.asset.findMany({
    where,
    select: { id: true, assetNo: true, name: true },
    orderBy: { assetNo: "asc" },
  });
}

/**
 * 主管代申数据范围：返回可代为申请的下属员工（本人主管部门内）及其名下可发起设备。
 * 具备 system.account.manage 时范围不限（全部部门在职员工）；否则需 dept.data.view 且仅限本人主管部门。
 * 无代申权限或无下属时返回空数组（前端隐藏代申入口）。
 */
export async function getApprovalDelegationTargets(adminId: number): Promise<
  Array<{
    id: number;
    employeeNo: string;
    name: string;
    assets: { id: number; assetNo: string; name: string }[];
    assetCats: { assetId: number; categoryId: number; categoryName: string }[];
  }>
> {
  const canAll = await hasPermission({ id: adminId }, "system.account.manage");
  if (!canAll && !(await hasPermission({ id: adminId }, "dept.data.view"))) return [];

  // 统一走 resolveDepartmentScope（账号级，本部门+扩展部门追加式），保证代审与资产/人员数据范围一致
  const scope = await resolveDepartmentScope({ id: adminId });
  let managed: number[];
  if (scope === "ALL") {
    const all = await prisma.department.findMany({ select: { id: true } });
    managed = all.map((d) => d.id);
  } else {
    managed = scope;
  }
  if (managed.length === 0) return [];

  const employees = await prisma.employee.findMany({
    where: { status: { not: "LEFT" }, departmentId: { in: managed } },
    select: { id: true, employeeNo: true, name: true },
    orderBy: { employeeNo: "asc" },
  });
  if (employees.length === 0) return [];

  // RESERVED(已预占) 设备不参与再次发起选择
  const assets = await prisma.asset.findMany({
    where: { status: { not: "RESERVED" as const }, employeeId: { in: employees.map((e) => e.id) } },
    select: { id: true, assetNo: true, name: true, employeeId: true },
    orderBy: { assetNo: "asc" },
  });
  const ac = await prisma.assetComponent.findMany({
    where: { assetId: { in: assets.map((a) => a.id) } },
    select: {
      assetId: true,
      model: { select: { categoryId: true, category: { select: { id: true, name: true } } } },
    },
  });
  const catsByAsset = new Map<number, { assetId: number; categoryId: number; categoryName: string }[]>();
  for (const c of ac) {
    const arr = catsByAsset.get(c.assetId) ?? [];
    if (!arr.some((x) => x.categoryId === c.model.categoryId)) {
      arr.push({
        assetId: c.assetId,
        categoryId: c.model.categoryId,
        categoryName: c.model.category.name,
      });
      catsByAsset.set(c.assetId, arr);
    }
  }

  return employees.map((e) => {
    const owned = assets.filter((a) => a.employeeId === e.id);
    // 该员工名下全部设备去重后的配件类别
    const cats = Array.from(
      new Map(
        owned
          .flatMap((a) => catsByAsset.get(a.id) ?? [])
          .map((c) => [c.categoryId, c])
      ).values()
    );
    return {
      id: e.id,
      employeeNo: e.employeeNo,
      name: e.name,
      assets: owned.map((a) => ({ id: a.id, assetNo: a.assetNo, name: a.name })),
      assetCats: cats,
    };
  });
}
