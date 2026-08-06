// 列表页通用文本搜索工具
// 供「设备模板 / 配件型号 / 库存流水 / 部门 / 设备分类 / 配件分类」等列表页
// 在页面层过滤数据后传给表格组件，统一搜索体验，且逻辑可单测。

function normalizeQuery(query: string): string {
  return (query ?? "").trim().toLowerCase();
}

/**
 * 按文本过滤列表。
 * @param items     原始数据
 * @param query     搜索关键字
 * @param getText   取可搜索文本：返回字符串（单字段）或字符串数组（多字段任一匹配即可）
 * @returns         过滤后的列表；query 为空时原样返回（不创建新数组）。
 */
export function filterItemsByText<T>(
  items: T[],
  query: string,
  getText: (item: T) => string | string[],
): T[] {
  const q = normalizeQuery(query);
  if (!q) return items;
  return items.filter((item) => {
    const text = getText(item);
    const parts = Array.isArray(text) ? text : [text];
    return parts.some((p) => (p ?? "").toLowerCase().includes(q));
  });
}

/**
 * 过滤树形（扁平 parentId 结构）列表，匹配节点时保留其祖先链，
 * 使 TreeTable 仍能还原完整树结构。
 * @returns 过滤后的扁平节点列表（parentId 不变）；query 为空时原样返回。
 */
export function filterTreeByText<T extends { id: number; parentId: number | null }>(
  nodes: T[],
  query: string,
  getName: (node: T) => string = (node) => (node as unknown as { name?: string }).name ?? "",
): T[] {
  const q = normalizeQuery(query);
  if (!q) return nodes;

  const byId = new Map<number, T>();
  for (const n of nodes) byId.set(n.id, n);

  const matched = new Set<number>();
  for (const n of nodes) {
    if (getName(n).toLowerCase().includes(q)) matched.add(n.id);
  }

  // 为每一个命中节点补齐其祖先，保证树结构完整
  for (const id of Array.from(matched)) {
    let cur = byId.get(id);
    while (cur && cur.parentId != null) {
      if (matched.has(cur.parentId)) break;
      matched.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }

  return nodes.filter((n) => matched.has(n.id));
}
