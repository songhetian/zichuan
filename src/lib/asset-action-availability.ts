// 设备状态 → 可执行操作的唯一判定源。
//
// 背景：这套判定原先散落在 asset-list-client.tsx 的 ActionButtons 里，
// 写成 5 个独立的 `asset.status === "X"` 表达式。结果是「分配」漏掉了
// IN_STOCK —— 后端 allocateAssets 的状态白名单一直是 ["IDLE", "IN_STOCK"]，
// 但界面上库存态设备点不出「分配」，批量入库后直接卡住。
// 抽成纯函数后，状态语义只有一处，也能被测试锚住。

/** 设备行级操作标识 */
export type AssetAction =
  | "allocate" // 分配
  | "return" // 归还
  | "completeRepair" // 维修完成
  | "transfer" // 调拨
  | "sendRepair" // 送修
  | "scrap"; // 报废

// 状态 → 可用操作。顺序即菜单展示顺序。
const ACTIONS_BY_STATUS: Record<string, AssetAction[]> = {
  // 闲置与库存都可分配（与 allocateAssets 的白名单一致）
  IDLE: ["allocate", "sendRepair", "scrap"],
  IN_STOCK: ["allocate", "sendRepair", "scrap"],
  IN_USE: ["return", "transfer", "sendRepair", "scrap"],
  IN_MAINTENANCE: ["completeRepair", "scrap"],
  SCRAPPED: [],
};

/**
 * 返回某状态下可执行的操作列表。
 * 未知状态 fail-closed：不提供任何操作，避免展示出后端不会接受的动作。
 */
export function getAvailableActions(status: string): AssetAction[] {
  return ACTIONS_BY_STATUS[status] ?? [];
}

/** 该状态是否可分配（供批量工具栏等场景单独判断） */
export function canAllocate(status: string): boolean {
  return getAvailableActions(status).includes("allocate");
}
