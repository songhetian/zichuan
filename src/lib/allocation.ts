/**
 * 分配规则唯一真相源。
 *
 * 纯函数、不 import prisma —— 服务端 action 与前端预览共用同一份实现，避免
 * 「校验规则在前后端各写一遍、然后漂移」的历史问题（本项目的唯一规则已经漂移过
 * 一次：批量路径因为 `notIn` 排除了本批设备而形同虚设）。
 */

import { getStatusLabel } from "./status-labels";

export interface AllocationAsset {
  id: number;
  assetNo: string;
  status: string;
  categoryId: number;
  categoryName: string;
  /** 该分类是否「唯一」= 每人仅限一台 */
  categoryUnique: boolean;
  /** 当前使用人（闲置/库存态通常为 null） */
  employeeId: number | null;
}

export interface AllocationEmployee {
  id: number;
  name: string;
  employeeNo: string;
  departmentId: number;
  departmentName: string;
  /** 该员工当前已持有的「唯一」分类 id（用于历史占用判定） */
  ownedUniqueCategoryIds: number[];
}

export interface AllocationAssignment {
  assetId: number;
  employeeId: number;
}

export interface AllocationConflict {
  assetId: number;
  assetNo: string;
  reason: string;
}

export interface AllocationPlan {
  assignments: AllocationAssignment[];
  conflicts: AllocationConflict[];
  perEmployee: { employeeId: number; count: number }[];
}

export interface PlanAllocationOptions {
  /** 是否执行「唯一」规则（配额封顶 1 + 历史占用作废）。默认 true */
  enforceUnique?: boolean;
}

/** 设备排序：编号自然序（兼容 `DN-0002` < `DN-0010` 与 `{R4}` 随机后缀） */
function compareAssetNo(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** 员工排序：部门 → 工号（同部门内按工号，最后用 id 兜底保证稳定） */
function compareEmployee(a: AllocationEmployee, b: AllocationEmployee): number {
  if (a.departmentId !== b.departmentId) return a.departmentId - b.departmentId;
  const byNo = a.employeeNo.localeCompare(b.employeeNo, undefined, { numeric: true });
  if (byNo !== 0) return byNo;
  return a.id - b.id;
}

interface Slot {
  employee: AllocationEmployee;
  /** 非空表示该槽位无效（历史占用），站位保留但不产出分配 */
  invalidReason?: string;
}

/**
 * 生成分配计划。
 *
 * 配额规则：`base = ⌊N/M⌋`，前 `N % M` 人各多拿 1 台（余数前置）。
 * 槽位是**预先算好的固定序列**，某个槽位无效时该台设备直接判冲突，
 * **不转给后面还有名额的人**（决策 15：就地跳过，不重平衡）。
 */
export function planAllocation(
  assets: AllocationAsset[],
  employees: AllocationEmployee[],
  options: PlanAllocationOptions = {}
): AllocationPlan {
  const enforceUnique = options.enforceUnique ?? true;

  const sortedAssets = [...assets].sort((a, b) => compareAssetNo(a.assetNo, b.assetNo));
  const sortedEmployees = [...employees].sort(compareEmployee);
  const assetNoById = new Map(sortedAssets.map((a) => [a.id, a.assetNo]));

  const assignments: AllocationAssignment[] = [];
  const conflicts: AllocationConflict[] = [];
  const perEmployee = sortedEmployees.map((e) => ({ employeeId: e.id, count: 0 }));

  // 状态不可分配的设备先剔除：它们本来就给不了任何人，不该占用配额槽位
  // （闲置与库存都算可分配，与 allocateAssets 的状态白名单一致）
  const pool: AllocationAsset[] = [];
  for (const a of sortedAssets) {
    if (a.status === "IDLE" || a.status === "IN_STOCK") {
      pool.push(a);
    } else {
      conflicts.push({
        assetId: a.id,
        assetNo: a.assetNo,
        reason: `设备状态为「${getStatusLabel(a.status)}」，不可分配`,
      });
    }
  }

  // 没选员工：没有任何设备可分（边界情况，由调用方提示）
  if (sortedEmployees.length === 0) {
    for (const a of pool) {
      conflicts.push({ assetId: a.id, assetNo: a.assetNo, reason: "未选择员工" });
    }
    conflicts.sort((a, b) => compareAssetNo(a.assetNo, b.assetNo));
    return { assignments, conflicts, perEmployee };
  }

  // 按分类分组（保持编号序中的首次出现顺序），配额按分类各自计算
  const groups = new Map<number, AllocationAsset[]>();
  for (const a of pool) {
    const list = groups.get(a.categoryId);
    if (list) list.push(a);
    else groups.set(a.categoryId, [a]);
  }

  const m = sortedEmployees.length;

  for (const [categoryId, groupAssets] of groups) {
    const categoryName = groupAssets[0].categoryName;
    const categoryUnique = groupAssets[0].categoryUnique;
    const n = groupAssets.length;
    const base = Math.floor(n / m);
    const remainder = n % m;

    // 槽位：每个员工按配额连续占位。唯一分类下配额封顶 1 —— 这不是「重平衡」，
    // 而是把「每人仅限一台」这条规则纳入配额计算本身。
    const slots: Slot[] = [];
    sortedEmployees.forEach((emp, i) => {
      let quota = base + (i < remainder ? 1 : 0);
      if (enforceUnique && categoryUnique) quota = Math.min(quota, 1);
      for (let k = 0; k < quota; k++) slots.push({ employee: emp });
    });

    // 历史占用：该员工已持有本分类设备 → 其槽位作废（站位保留，不补给后面的人）
    if (enforceUnique && categoryUnique) {
      for (const slot of slots) {
        if (slot.employee.ownedUniqueCategoryIds.includes(categoryId)) {
          slot.invalidReason = `${slot.employee.name}已持有${categoryName}`;
        }
      }
    }

    groupAssets.forEach((a, index) => {
      const slot = slots[index];
      if (!slot) {
        // 唯一分类的「没槽位」和普通分类的「没槽位」不是一回事：前者是「每人仅限 1 台」
        // 这条规则本身把名额压到人数，写成「名额不足」会让人以为系统算错了（真实反馈）。
        conflicts.push({
          assetId: a.id,
          assetNo: a.assetNo,
          reason: categoryUnique
            ? `${categoryName}每人仅限 1 台`
            : `${categoryName}可分配名额不足`,
        });
        return;
      }
      if (slot.invalidReason) {
        conflicts.push({ assetId: a.id, assetNo: a.assetNo, reason: slot.invalidReason });
        return;
      }
      assignments.push({ assetId: a.id, employeeId: slot.employee.id });
      const counter = perEmployee.find((p) => p.employeeId === slot.employee.id);
      if (counter) counter.count += 1;
    });
  }

  assignments.sort((a, b) =>
    compareAssetNo(assetNoById.get(a.assetId) ?? "", assetNoById.get(b.assetId) ?? "")
  );
  conflicts.sort((a, b) => compareAssetNo(a.assetNo, b.assetNo));

  return { assignments, conflicts, perEmployee };
}
