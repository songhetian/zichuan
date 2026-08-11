const STATUS_LABELS: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
  IN_STOCK: "库存",
};

/**
 * 设备状态枚举 → 中文标签。未知状态返回原值兜底，避免界面出现英文字样。
 */
export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
