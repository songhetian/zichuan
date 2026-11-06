import { randomInt } from "node:crypto";
import { pinyin } from "pinyin-pro";

/**
 * 工号格式：姓名拼音首字母（最多 4 位，小写）+ 4 位随机字符（如 张三 → zsk3f9）。
 * 工号同时是登录账号（Admin.username = 工号），随机段天然抗重名冲突；
 * 删除员工后账号按设计保留（孤儿占号），靠 taken 列表（工号 + 账号名并集）避开。
 * 随机字符集剔除易混淆的 0/o/1/l/i，方便口头传达和纸质登记。
 */
const RANDOM_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_INITIALS = 4;
const RANDOM_LEN = 4;

/** 姓名转拼音首字母（小写、只留字母、最多 4 位）。非中文按原字符取字母，全非字母时返回空串。 */
export function employeeNoInitials(name: string): string {
  const letters = pinyin(name ?? "", {
    pattern: "first",
    type: "array",
    toneType: "none",
  })
    .join("")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return letters.slice(0, MAX_INITIALS);
}

function randomChars(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += RANDOM_CHARS[randomInt(RANDOM_CHARS.length)];
  }
  return s;
}

/**
 * 生成不冲突的新工号。taken 为「现有工号 ∪ 登录账号名」的并集（两处唯一约束都要避开）。
 * 随机空间 31⁴ ≈ 92 万，正常一次命中；连撞兜底时随机段加倍。
 */
export function generateEmployeeNo(name: string, taken: string[]): string {
  let prefix = employeeNoInitials(name);
  if (prefix.length < 2) {
    // 中文名不足 2 个首字母（单字名/纯外文/空）时用随机字母补齐，保证最小长度
    prefix += randomChars(2 - prefix.length);
  }
  const takenSet = new Set(taken);
  for (let i = 0; i < 10; i++) {
    const no = prefix + randomChars(RANDOM_LEN);
    if (!takenSet.has(no)) return no;
  }
  return prefix + randomChars(RANDOM_LEN + 4);
}
