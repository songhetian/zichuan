/**
 * 用户可见错误文案卫生化（兜底层）。
 *
 * 目标：任何经服务端/客户端冒泡到用户提示的错误，绝不能出现机器编码或英文系统校验文案
 * （例如 `STOCK_INSUFFICIENT`、`Invalid enum value. Expected 'UPGRADE'|'DOWNGRADE'` 之类）。
 *
 * 原则：
 *  - 已含中文的文案原样通过（业务错误多是通顺中文，不得误伤）；
 *  - 明确命中「机器编码 / 英文校验文案」形态的 → 替换为一条通用专业中文；
 *  - 其余（数字、简短符号、正常数据串）原样保留。
 */

/** 纯大写机器编码：STOCK_INSUFFICIENT / COMPONENT_NOT_FOUND / UNIQUE_VIOLATION:CPU 等 */
const MACHINE_CODE = /^[A-Z][A-Z0-9_:.]{2,}$/;

/** 英文系统/zod 校验文案开头（常见形态在前，避免误匹配普通英文数据） */
const ENGLISH_VALIDATION = /^(Invalid|Expected|Required|Please|Cannot|Can't|Must|Should|String\b|Number\b|Value\b|Input\b|Type\b|"String"|The (string|number|value))/i;

export const GENERIC_ERROR = "操作失败，请稍后重试";

export function cleanErrorMessage(msg: unknown): string {
  if (typeof msg !== "string") return GENERIC_ERROR;
  const s = msg.trim();
  if (s === "") return GENERIC_ERROR;
  // 含中文 → 已通顺，原样通过
  if (/[\u4e00-\u9fff]/.test(s)) return s;
  // 机器编码或英文校验文案 → 通用中文
  if (MACHINE_CODE.test(s) || ENGLISH_VALIDATION.test(s)) return GENERIC_ERROR;
  return s;
}