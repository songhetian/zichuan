export interface ImportDateRange {
  from?: string | Date | null;
  to?: string | Date | null;
}

/** 将 Date / 时间字符串归一化为本地「YYYY-MM-DD」，按天比较，避免时区误差 */
function toDateKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 按「导入时间」(createdAt) 在 [from, to] 闭区间筛选设备。
 * - 未提供范围（或 from/to 都为空）时返回原数组，不做过滤。
 * - 只传 from：保留当天及之后；只传 to：保留当天及之前。
 * - createdAt 为空的设备在筛选开启时被排除（无法确定导入时间）。
 */
export function filterByImportDate<T extends { createdAt?: Date | string | null }>(
  assets: T[],
  range?: ImportDateRange
): T[] {
  if (!range) return assets;
  const fromKey = range.from ? toDateKey(range.from) : null;
  const toKey = range.to ? toDateKey(range.to) : null;
  if (!fromKey && !toKey) return assets;

  return assets.filter((a) => {
    if (!a.createdAt) return false;
    const key = toDateKey(a.createdAt);
    if (fromKey && key < fromKey) return false;
    if (toKey && key > toKey) return false;
    return true;
  });
}
