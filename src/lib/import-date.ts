/**
 * 导入日期筛选的纯逻辑（标签打印页用）。
 *
 * 为什么单拎出来：日期口径是最容易出错的地方——设备表的 createdAt 是 UTC 时间戳，
 * 而用户说的「哪天导入的」是本机日历日。若直接比较 UTC 日期，晚上 8 点后导入的设备
 * 会被算成「第二天」，用户按今天筛选就会漏掉。所以一律先转成**本地时区的 YYYY-MM-DD** 再比。
 *
 * 不 import 任何 prisma / React —— 前后端都能用，也方便单测。
 */

export type DateLike = Date | string | null | undefined;

const EMPTY = "";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseDate(value: DateLike): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 归一成**本地时区**的 `YYYY-MM-DD`；空值/非法值返回空串。 */
export function toDateKey(value: DateLike): string {
  const d = parseDate(value);
  if (!d) return EMPTY;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 按导入日期（本地时区的 `YYYY-MM-DD`）过滤。
 * `dateKey` 为空时**原样返回同一个数组引用**（便于调用方直接用于 useMemo）。
 */
export function filterByDateKey<T extends { createdAt: DateLike }>(
  items: T[],
  dateKey: string
): T[] {
  if (!dateKey) return items;
  return items.filter((item) => toDateKey(item.createdAt) === dateKey);
}

/** 列表展示用：`YYYY-MM-DD HH:mm`（本地时区）；空值返回 `-`。 */
export function formatImportDateTime(value: DateLike): string {
  const d = parseDate(value);
  if (!d) return "-";
  return `${toDateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
