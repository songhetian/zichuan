// 分类分配规则的中文说明。
//
// 「分配规则」= AssetCategory.unique（设置页 UI 标签就叫「分配规则」）。
// 分配/调拨弹窗把它写在设备上下文条上，让用户在提交前就知道这条限制，
// 而不是提交后被一句笼统的唯一性错误顶回来。

export interface AllocationRuleCategory {
  name: string;
  unique: boolean;
}

/** 返回该分类的分配规则说明；分类未知时返回 undefined（省略该行） */
export function describeAllocationRule(
  category: AllocationRuleCategory | undefined
): string | undefined {
  if (!category) return undefined;
  return category.unique
    ? `${category.name}为「唯一」分类：每人仅限一台`
    : `${category.name}为普通分类：每人可持有多台`;
}
