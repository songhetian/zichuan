/**
 * 资产状态相关常量
 * 统一管理状态标签。适配主题的语义色在 @/lib/status-styles，canvas（ECharts）用色在 @/lib/use-theme-colors。
 */

/** 资产状态 → 中文标签 */
export const ASSET_STATUS_LABEL_MAP: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
  RESERVED: "预占",
};

/**
 * 配件层分类名（与「设备层」相对）
 *
 * 判据：不满足设备层三条判据中的任何一条 —— 即「装在主机里、无独立序列号、不单独走审批」的可插拔件。
 * 清单与 CONTEXT.md「Device Layer / Component Layer」一节保持一致，由
 * tests/laptop-monitor-detection.test.ts 的同步用例守着，改一处必须改另一处。
 *
 * 用途：Excel 导入时【只认】这些分类名的「{分类名}型号」列。用白名单而非「排除设备层」的黑名单，
 * 是为了让清单外的列（「台式机型号」「规格型号」「设备型号」…）一律不被误当成配件。
 */
export const COMPONENT_LAYER_CATEGORIES = [
  "CPU",
  "内存",
  "硬盘",
  "主板",
  "显卡",
  "电源",
  "键盘",
  "鼠标",
];

// 资产状态样式已统一到 `@/lib/status-styles`（token 驱动）。
// 此处曾有一份 ASSET_STATUS_BADGE_MAP 副本，长期无人引用且颜色已与 StatusBadge 漂移，故删除。

/** 生命周期动作 → 中文标签 */
export const LIFECYCLE_ACTION_LABEL_MAP: Record<string, string> = {
  CREATED: "创建",
  ALLOCATED: "分配",
  RETURNED: "归还",
  TRANSFERRED: "调拨",
  UPGRADED: "升级",
  DOWNGRADED: "降级",
  SCRAPPED: "报废",
  REPLACED: "更换回收",
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