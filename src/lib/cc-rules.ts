/**
 * 抄送规则（M8，spec §5.1）
 * 节点抄送从单值 ccType 扩展为多规则数组，按规则并集去重解析抄送账号。
 * 兼容策略：ccRules 为有效数组（含空数组 = 显式不抄送）时按规则解析；
 * null / 无效时由调用方回退旧 ccType + ccUserIds 逻辑（历史数据）。
 */

export type CcRule =
  | { type: "INITIATOR" }
  | { type: "DEPT_MANAGER" }
  | { type: "EMP_MANAGER" }
  | { type: "ROLE"; roleKey: string }
  | { type: "USER"; userIds: number[] };

function isCcRule(v: unknown): v is CcRule {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  switch (r.type) {
    case "INITIATOR":
    case "DEPT_MANAGER":
    case "EMP_MANAGER":
      return true;
    case "ROLE":
      return typeof r.roleKey === "string" && r.roleKey.length > 0;
    case "USER":
      return Array.isArray(r.userIds) && r.userIds.every((x) => typeof x === "number");
    default:
      return false;
  }
}

/**
 * 解析节点 ccRules（Json 列读回可能是字符串，防御解析）：
 *   - null/undefined → null（调用方回退旧逻辑）
 *   - 无效内容 → null
 *   - 有效数组（可空）→ 规则数组
 */
export function parseCcRules(raw: unknown): CcRule[] | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  if (!value.every(isCcRule)) return null;
  return value;
}
