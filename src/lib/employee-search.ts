/**
 * 员工搜索匹配（纯函数，无 DB / 无 React）
 *
 * 员工管理页的搜索框除「姓名 / 工号」外，还需支持「设备编码」——
 * 输入资产编号即可定位到正在使用该设备的员工。
 *
 * 口径与员工列表「在用设备数」列一致：设备范围 = 该员工名下的全部设备
 * （`Asset.employeeId = 员工 id`，不过滤状态），与 `getEmployeeAssets` 同源。
 */

export interface EmployeeSearchTarget {
  name: string;
  employeeNo: string;
  /** 该员工名下设备的资产编码；缺省视为无设备 */
  assetNos?: readonly string[] | null;
}

export type EmployeeMatch =
  | { by: "name" }
  | { by: "employeeNo" }
  | { by: "asset"; assetNo: string };

/**
 * 关键词是否命中该员工，并说明命中的来源。
 *
 * 未命中返回 `null`；命中设备编码时回传具体那一台（供列表标出「匹配设备」）。
 * 命中优先级为 **姓名 → 工号 → 设备编码**：姓名本身长得像设备编码时，
 * 不应额外标一个「匹配设备」标签。
 * 空 / 纯空白关键词匹配一切（`includes("")` 恒真），即列表缺省态不过滤。
 */
export function findEmployeeMatch(
  target: EmployeeSearchTarget,
  keyword: string
): EmployeeMatch | null {
  const q = keyword.trim().toLowerCase();

  if (target.name.toLowerCase().includes(q)) return { by: "name" };
  if (target.employeeNo.toLowerCase().includes(q)) return { by: "employeeNo" };

  const assetNo = (target.assetNos ?? []).find((no) => no.toLowerCase().includes(q));
  return assetNo ? { by: "asset", assetNo } : null;
}
