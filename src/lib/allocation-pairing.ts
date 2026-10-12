/**
 * 批量分配的「自动配对 + 冲突预校验」纯函数层。
 *
 * 设计口径（与 src/actions/lifecycle.actions.ts 的 allocateAssets 服务端校验严格对齐）：
 *   1. 配对：设备按资产编号升序、员工按勾选顺序，一一对应（严格 1:1）。
 *   2. 可分配性：只有「闲置(IDLE)」设备可被分配。
 *   3. 人员：已离职(LEFT)员工不可被分配。
 *   4. 唯一性(R4)：AssetCategory.unique = true 的分类，同一员工至多持有 1 台。
 *      「持有」口径 = 状态属于 IDLE / IN_USE / IN_MAINTENANCE（SCRAPPED / RESERVED 不算）。
 *
 * 这里刻意不碰数据库、不碰 React —— 所有规则都能被单测锁死；
 * 服务端仍是最终权威，本层只负责「在提交前把问题提前标出来」。
 */

/** 参与配对的最小资产信息（由 AssetItem 投影而来） */
export interface PairingAsset {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  employeeId: number | null;
  categoryId: number;
}

/** 参与配对的最小员工信息 */
export interface PairingEmployee {
  id: number;
  name: string;
  departmentName: string;
  status: "ACTIVE" | "LEFT";
}

/** 分类的唯一性标记（取 AssetCategory.unique） */
export interface PairingCategory {
  id: number;
  name: string;
  unique: boolean;
}

export type PairConflictKind = "EMPLOYEE_LEFT" | "ASSET_NOT_IDLE" | "UNIQUE_VIOLATION";

export interface PairConflict {
  kind: PairConflictKind;
  /** 直接可展示的中文原因（含具体设备编号，便于就地判断） */
  message: string;
}

export interface AllocationPair {
  /** 展示用序号，从 1 开始 */
  index: number;
  asset: PairingAsset;
  employee: PairingEmployee;
  conflict: PairConflict | null;
}

export interface AllocationPairs {
  pairs: AllocationPair[];
  /** 待分配设备总数（选中数，不因配对不足而缩水） */
  assetCount: number;
  /** 已勾选员工总数 */
  employeeCount: number;
}

/**
 * 服务端批量分配返回的「某一对无法分配」结构化原因。
 * 前端把它回填到配对表同一套冲突行 UI 上 —— 本地预校验与服务端兜底共用一份展示。
 */
export interface AllocationConflict {
  assetId: number;
  assetNo: string;
  employeeId: number;
  employeeName: string;
  reason: string;
}

export interface PairingSummary {
  assetCount: number;
  employeeCount: number;
  pairCount: number;
  /** 还差几个人（设备多于人时为正值） */
  missingEmployees: number;
  /** 多勾了几个人（人多于设备时为正值） */
  extraEmployees: number;
  conflictCount: number;
  /** 提交闸门：数量严格相等、至少一台设备、且无任何冲突 */
  canSubmit: boolean;
}

/** 「持有」判定：这三种状态下的设备仍占着该员工的唯一性名额 */
const HOLDING_STATUSES = new Set(["IDLE", "IN_USE", "IN_MAINTENANCE"]);

/**
 * 按「资产编号升序 × 员工勾选顺序」自动配对。
 * 数量不等时只产出能配上的部分（预览区仍可展示），是否放行由 summarizePairing 决定。
 */
export function buildAllocationPairs(
  assets: readonly PairingAsset[],
  employees: readonly PairingEmployee[]
): AllocationPairs {
  const sortedAssets = [...assets].sort((a, b) =>
    a.assetNo.localeCompare(b.assetNo, "zh-Hans-CN", { numeric: true })
  );

  const count = Math.min(sortedAssets.length, employees.length);
  const pairs: AllocationPair[] = [];
  for (let i = 0; i < count; i++) {
    pairs.push({ index: i + 1, asset: sortedAssets[i], employee: employees[i], conflict: null });
  }

  return { pairs, assetCount: assets.length, employeeCount: employees.length };
}

/**
 * 为已配对的每一对标注冲突原因（就地返回新对象，不改原数组）。
 *
 * @param allAssets 前端持有的全量设备 —— 用于判断「目标员工当前是否已持有同唯一分类设备」。
 *                  能正常使用分配的账号，其资产可见范围必然为 ALL（带部门范围的账号连闲置池都看不到），
 *                  因此这里的数据是完整的。
 */
export function annotatePairConflicts(
  result: AllocationPairs,
  context: { allAssets: readonly PairingAsset[]; categories: readonly PairingCategory[] }
): AllocationPairs {
  const categoryById = new Map(context.categories.map((c) => [c.id, c]));
  const batchAssetIds = new Set(result.pairs.map((p) => p.asset.id));

  // 员工 → 当前持有的设备（排除本批次待分配的设备，与服务端 id: { notIn: assetIds } 同口径）
  const heldByEmployee = new Map<number, PairingAsset[]>();
  for (const a of context.allAssets) {
    if (a.employeeId == null) continue;
    if (!HOLDING_STATUSES.has(a.status)) continue;
    if (batchAssetIds.has(a.id)) continue;
    const list = heldByEmployee.get(a.employeeId);
    if (list) list.push(a);
    else heldByEmployee.set(a.employeeId, [a]);
  }

  const pairs = result.pairs.map((pair) => ({
    ...pair,
    conflict: resolveConflict(pair, categoryById, heldByEmployee),
  }));

  return { ...result, pairs };
}

/** 单对冲突判定，按「人 → 设备 → 唯一性」优先级只报第一条 */
function resolveConflict(
  pair: AllocationPair,
  categoryById: Map<number, PairingCategory>,
  heldByEmployee: Map<number, PairingAsset[]>
): PairConflict | null {
  if (pair.employee.status === "LEFT") {
    return { kind: "EMPLOYEE_LEFT", message: `${pair.employee.name} 已离职，不可分配设备` };
  }

  if (pair.asset.status !== "IDLE") {
    return {
      kind: "ASSET_NOT_IDLE",
      message: `设备 ${pair.asset.assetNo} 当前非闲置状态，不可分配`,
    };
  }

  const category = categoryById.get(pair.asset.categoryId);
  if (category?.unique) {
    const held = (heldByEmployee.get(pair.employee.id) ?? []).find(
      (a) => a.categoryId === category.id
    );
    if (held) {
      return {
        kind: "UNIQUE_VIOLATION",
        message: `${pair.employee.name} 已持有「${category.name}」${held.assetNo}，该分类每人限 1 台`,
      };
    }
  }

  return null;
}

/** 汇总成状态栏文案所需的数据 + 提交闸门 */
export function summarizePairing(result: AllocationPairs): PairingSummary {
  const conflictCount = result.pairs.filter((p) => p.conflict !== null).length;
  const missingEmployees = Math.max(0, result.assetCount - result.employeeCount);
  const extraEmployees = Math.max(0, result.employeeCount - result.assetCount);

  return {
    assetCount: result.assetCount,
    employeeCount: result.employeeCount,
    pairCount: result.pairs.length,
    missingEmployees,
    extraEmployees,
    conflictCount,
    canSubmit:
      result.assetCount > 0 &&
      result.assetCount === result.employeeCount &&
      conflictCount === 0,
  };
}
