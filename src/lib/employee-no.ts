const EMPLOYEE_NO_PREFIX = "EMP";

/** 「EMP + 数字」工号里的最大序号；非该前缀的工号（如手工填的）不参与计数。 */
function maxEmployeeSeq(existingNos: string[]): number {
  let max = 0;
  for (const no of existingNos) {
    if (no.startsWith(EMPLOYEE_NO_PREFIX)) {
      const seq = Number(no.slice(EMPLOYEE_NO_PREFIX.length));
      if (!Number.isNaN(seq) && seq > max) {
        max = seq;
      }
    }
  }
  return max;
}

function formatEmployeeNo(seq: number): string {
  return `${EMPLOYEE_NO_PREFIX}${String(seq).padStart(4, "0")}`;
}

/**
 * 生成下一个员工工号（如 EMP0001），格式与自动导入一致。
 * 取现有「EMP + 数字」工号中的最大序号 +1。
 */
export function generateEmployeeNo(existingNos: string[]): string {
  return formatEmployeeNo(maxEmployeeSeq(existingNos) + 1);
}

/**
 * 一次生成 `count` 个连续工号（批量建人用）。
 * 必须一次算出来：逐个调用 `generateEmployeeNo` 会因为「还没落库」而都返回同一个号。
 */
export function generateEmployeeNos(existingNos: string[], count: number): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const base = maxEmployeeSeq(existingNos);
  return Array.from({ length: Math.floor(count) }, (_, i) => formatEmployeeNo(base + 1 + i));
}
