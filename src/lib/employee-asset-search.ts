/**
 * 「按设备编码找使用人」——员工管理页的设备编码搜索。
 *
 * 纯函数：不 import prisma，前端实时过滤与服务端（如需）共用同一口径。
 */
export interface EmployeeWithAssetCodes {
  /** 该员工名下（`Asset.employeeId` 指向他）的全部设备编码 */
  assetNos?: string[] | null
}

/**
 * 按设备编码查出「谁在用」。
 *
 * - 空查询（或只有空白）视为「不过滤」，返回全部员工、不标匹配；
 * - 匹配方式为**包含**且忽略大小写：用户常常只记得后几位，或直接粘贴时带空格；
 * - 一个员工持有多个命中编码时，`matchedAssetNos` 全部列出（按原顺序）。
 */
export function findEmployeesByAssetCode<T extends EmployeeWithAssetCodes>(
  employees: T[],
  query: string
): { employee: T; matchedAssetNos: string[] }[] {
  const q = query.trim().toLowerCase()

  if (!q) return employees.map((employee) => ({ employee, matchedAssetNos: [] }))

  const result: { employee: T; matchedAssetNos: string[] }[] = []
  for (const employee of employees) {
    const matchedAssetNos = (employee.assetNos ?? []).filter((no) =>
      no.toLowerCase().includes(q)
    )
    if (matchedAssetNos.length > 0) result.push({ employee, matchedAssetNos })
  }
  return result
}
