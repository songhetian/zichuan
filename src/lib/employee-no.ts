const EMPLOYEE_NO_PREFIX = "EMP";

/**
 * 生成下一个员工工号（如 EMP0001），格式与自动导入一致。
 * 取现有「EMP + 数字」工号中的最大序号 +1；非该前缀的工号（如手工填的）不参与计数。
 */
export function generateEmployeeNo(existingNos: string[]): string {
  let max = 0;
  for (const no of existingNos) {
    if (no.startsWith(EMPLOYEE_NO_PREFIX)) {
      const seq = Number(no.slice(EMPLOYEE_NO_PREFIX.length));
      if (!Number.isNaN(seq) && seq > max) {
        max = seq;
      }
    }
  }
  return `${EMPLOYEE_NO_PREFIX}${String(max + 1).padStart(4, "0")}`;
}
