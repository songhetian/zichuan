// 数据去重归并的纯函数（与数据库无关，便于单元测试）
// 用途：合并因「(n) 后缀」绕开唯一约束而产生的重复设备型号，
//       以及合并「同名不同伪品牌」而产生的重复配件型号。

// 匹配末尾的 " (数字)" 后缀，如 " (2)" " (6)" " (10)"
const DUPLICATE_SUFFIX_RE = / \([0-9]+\)$/;

/** 去掉型号名末尾的 (n) 重复序号后缀；非纯数字括号（如 (SSD)、(i5-9500)）不受影响。 */
export function stripTrailingDuplicateSuffix(name: string): string {
  return name.replace(DUPLICATE_SUFFIX_RE, "").trim();
}

/** 设备型号归并键：同分类 + 去掉后缀后的规范名。规格不同（硬盘/显示器）天然不同键。 */
export function templateDedupeKey(categoryId: number, name: string): string {
  return `${categoryId}::${stripTrailingDuplicateSuffix(name)}`;
}

/**
 * 配件型号归并键：仅按规格名归并，忽略伪品牌。
 * 用户场景中 08C8/88BC/89EC、0BF7/Colorful 都是无意义的品牌码，
 * 同规格应合并为一条。同时归一化多余空白。
 */
export function componentDedupeKey(name: string, _brand?: string): string {
  // 忽略伪品牌：规格名统一小写 + 归一空白，使 "Kingston" / "KINGSTON" 等同归并
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface TemplateRow {
  id: number;
  categoryId: number;
  name: string;
}

export interface TemplateDupGroup {
  key: string;
  canonicalId: number;
  ids: number[];
  names: string[];
}

/**
 * 将设备型号按归并键分组，仅返回重复组（>=2 条）。
 * canonical 选取规则：优先「无 (n) 后缀」的 base，否则取 id 最小者。
 */
export function groupTemplateDuplicates(rows: TemplateRow[]): TemplateDupGroup[] {
  const map = new Map<string, TemplateRow[]>();
  for (const r of rows) {
    const key = templateDedupeKey(r.categoryId, r.name);
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  const groups: TemplateDupGroup[] = [];
  for (const [key, arr] of map) {
    if (arr.length < 2) continue;
    const canonical =
      arr.find((r) => !DUPLICATE_SUFFIX_RE.test(r.name)) ??
      arr.reduce((min, r) => (r.id < min.id ? r : min), arr[0]);
    groups.push({
      key,
      canonicalId: canonical.id,
      ids: arr.map((r) => r.id),
      names: arr.map((r) => r.name),
    });
  }
  return groups;
}

export interface ComponentRow {
  id: number;
  categoryId: number;
  name: string;
  brand: string;
}

export interface ComponentDupGroup {
  key: string;
  canonicalId: number;
  ids: number[];
  names: string[];
  brands: string[];
}

/**
 * 将配件型号按「分类 + 规格名(忽略品牌)」分组，仅返回重复组。
 * canonical 选取规则：优先「无伪品牌/空品牌」者，否则取 id 最小者。
 */
export function groupComponentDuplicates(rows: ComponentRow[]): ComponentDupGroup[] {
  const map = new Map<string, ComponentRow[]>();
  for (const r of rows) {
    const key = `${r.categoryId}::${componentDedupeKey(r.name)}`;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  const groups: ComponentDupGroup[] = [];
  for (const [key, arr] of map) {
    if (arr.length < 2) continue;
    const canonical =
      arr.find((r) => !r.brand || r.brand === "未知") ??
      arr.reduce((min, r) => (r.id < min.id ? r : min), arr[0]);
    groups.push({
      key,
      canonicalId: canonical.id,
      ids: arr.map((r) => r.id),
      names: arr.map((r) => r.name),
      brands: arr.map((r) => r.brand),
    });
  }
  return groups;
}
