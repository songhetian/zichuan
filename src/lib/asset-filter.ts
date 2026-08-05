// 配件容量提取与汇总（内存 / 硬盘）
// 供设备列表的「配置摘要」与「容量筛选」共用，确保两者口径一致：
// 以「配件分类名」为主判定（内存 / 硬盘），型号名关键词仅作兜底，
// 避免仅按型号名关键词判定导致大量内存条 / 硬盘被漏掉。

export function extractCapacityGB(name: string): number | null {
  if (!name) return null;
  const gbMatch = name.match(/(\d+(?:\.\d+)?)\s*GB/i);
  if (gbMatch) {
    return parseFloat(gbMatch[1]);
  }
  const tbMatch = name.match(/(\d+(?:\.\d+)?)\s*TB/i);
  if (tbMatch) {
    return parseFloat(tbMatch[1]) * 1000;
  }
  return null;
}

export interface CapacityComponent {
  categoryName: string;
  modelName: string | null;
  quantity: number;
}

export function getMemoryGB(components: CapacityComponent[]): number {
  let total = 0;
  for (const comp of components) {
    const isMemory =
      comp.categoryName === "内存" ||
      /内存|ddr|ram|so-dimm/i.test(comp.modelName ?? "");
    if (!isMemory) continue;
    const cap = extractCapacityGB(comp.modelName ?? "");
    if (cap != null) {
      total += cap * comp.quantity;
    }
  }
  return total;
}

export function getDiskGB(components: CapacityComponent[]): number {
  let total = 0;
  for (const comp of components) {
    const isDisk =
      comp.categoryName === "硬盘" ||
      /硬盘|ssd|hdd|nvme/i.test(comp.modelName ?? "");
    if (!isDisk) continue;
    const cap = extractCapacityGB(comp.modelName ?? "");
    if (cap != null) {
      total += cap * comp.quantity;
    }
  }
  return total;
}
