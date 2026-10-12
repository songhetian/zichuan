/**
 * 批量建人时的姓名生成。
 *
 * 规则：`部门名-4 位随机编号`（如「研发部-3721」）。
 * - 带部门名是为了批量造出来的占位员工一眼能认出来自哪个部门；
 * - 用随机编号而不是顺序编号，是为了不必先查库就知道大概范围，
 *   也避免「研发部-1、研发部-2」这类名字在列表里排成一串难以区分；
 * - 仍然会避开已存在的姓名与批内重名，保证名字唯一可辨认。
 */
/** 批量建人的单次上限：避免误填一个数字把库里灌满占位员工 */
export const BATCH_EMPLOYEE_MAX = 50;

export function generateBatchEmployeeNames(
  departmentName: string,
  count: number,
  existingNames: string[] = [],
  rand: () => number = Math.random
): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];

  const prefix = departmentName.trim();
  const taken = new Set(existingNames);
  const names: string[] = [];

  for (let i = 0; i < Math.floor(count); i++) {
    let candidate = "";

    // 最多试 50 次随机号；命中从未使用过的就采用
    for (let attempt = 0; attempt < 50; attempt++) {
      const num = String(Math.floor(rand() * 10000)).padStart(4, "0");
      const next = `${prefix}-${num}`;
      if (!taken.has(next)) {
        candidate = next;
        break;
      }
    }

    // 随机源异常（恒定值）或编号空间被占满时，退化为序号后缀，
    // 保证一定能生成且不与已有/批内重名。
    if (!candidate) {
      let n = 1;
      while (taken.has(`${prefix}-${String(n).padStart(4, "0")}`)) n++;
      candidate = `${prefix}-${String(n).padStart(4, "0")}`;
    }

    taken.add(candidate);
    names.push(candidate);
  }

  return names;
}
