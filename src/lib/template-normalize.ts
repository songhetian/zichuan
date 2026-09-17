// 模板/配件型号归一化纯函数（TDD: tests/template-normalize.test.ts）

/**
 * 从「电脑主机 (i5-6400 / 16GB / 238GB / SSD)」拆出 CPU 档基础名「电脑主机 (i5-6400)」。
 * 仅对电脑主机生效；其它模板原样返回。
 */
export function cpuBaseName(name: string): string {
  const m = name.match(/^(电脑主机)\s*\(([^/]+?)(?:\s*\/.*)?\)$/);
  if (m) return m[1] + " (" + m[2].trim() + ")";
  return name;
}

/** 是否为电脑主机模板（合并范围限定） */
export function isComputerHostTemplate(name: string): boolean {
  return name.startsWith("电脑主机");
}

/**
 * 从「465GB HDD (Colorful)」拆出 { spec: "465GB HDD", brand: "Colorful" }。
 * 无品牌后缀返回 null。
 */
export function extractBrandFromName(
  name: string,
): { spec: string; brand: string } | null {
  const m = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  return { spec: m[1].trim(), brand: m[2].trim() };
}

/** 模板重名时区分性后缀的分隔符 */
export const BOM_SUFFIX_SEPARATOR = " #";

/**
 * BOM 指纹：由「配件组成」派生出的短码，**与配件顺序无关**。
 *
 * 为什么不用真随机数：同一份配置重复导入必须收敛到同一个模板。
 * 若每次随机，导入两次就会新建两个模板，正是要去掉的重复来源。
 * 所以这里做的是「确定性短码」——看起来像随机后缀，但同配置恒定。
 *
 * salt 用于极端情况下的二次避让（短码相撞时递增）。
 */
export function bomFingerprint(
  entries: Array<{ modelId: number; quantity: number }>,
  salt = "",
): string {
  const raw =
    entries
      .map((e) => `${e.modelId}x${e.quantity}`)
      .sort()
      .join("|") + (salt ? `#${salt}` : "");

  // FNV-1a 32 位散列 → base36 大写，取 5 位
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0)
    .toString(36)
    .toUpperCase()
    .padStart(5, "0")
    .slice(-5);
}
