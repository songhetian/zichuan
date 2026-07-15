/**
 * 资产状态相关常量
 * 统一管理状态标签、颜色映射，消除 dashboard-client / stats-client / log-list-client / status-badge 中的重复定义
 */

/** 资产状态 → 中文标签 */
export const ASSET_STATUS_LABEL_MAP: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
};

/** 资产状态 → ECharts 颜色 */
export const ASSET_STATUS_COLOR_MAP: Record<string, string> = {
  IDLE: "#94a3b8",
  IN_USE: "#22c55e",
  IN_MAINTENANCE: "#eab308",
  SCRAPPED: "#ef4444",
};

/** 资产状态 → Badge className (用于 StatusBadge 组件) */
export const ASSET_STATUS_BADGE_MAP: Record<string, { label: string; className: string }> = {
  IDLE: { label: "闲置", className: "bg-slate-100 text-slate-700 border-slate-200" },
  IN_USE: { label: "在用", className: "bg-green-100 text-green-700 border-green-200" },
  IN_MAINTENANCE: { label: "维修中", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  SCRAPPED: { label: "报废", className: "bg-red-100 text-red-700 border-red-200" },
};

/** 生命周期动作 → 中文标签 */
export const LIFECYCLE_ACTION_LABEL_MAP: Record<string, string> = {
  CREATED: "创建",
  ALLOCATED: "分配",
  RETURNED: "归还",
  TRANSFERRED: "调拨",
  UPGRADED: "升级",
  SCRAPPED: "报废",
  MAINTENANCE_START: "送修",
  MAINTENANCE_DONE: "维修完成",
};

/** 盘点状态 → Badge 配置 */
export const STOCKTAKE_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  OPEN: { label: "进行中", variant: "secondary" },
  COMPLETED: { label: "已完成", variant: "default" },
};

/** 库存日志类型 → 中文标签 */
export const STOCK_LOG_TYPE_LABEL_MAP: Record<string, string> = {
  PURCHASE_IN: "采购入库",
  UPGRADE_RETURN: "升级退回",
  ASSET_BUILD: "组装设备出库",
  UPGRADE_USE: "升级使用",
};

/** 盘点结果 → 中文标签 */
export const STOCKTAKE_RESULT_LABEL_MAP: Record<string, string> = {
  NORMAL: "正常",
  MISSING: "盘亏",
  EXTRA: "盘盈",
};