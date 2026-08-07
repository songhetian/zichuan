// 设备容量计算工具
// 整机模式下，设备自身不写配件记录，容量来源于模板 BOM。
// 该模块从一组组件（模板 BOM 或设备配件）中汇总内存与硬盘总容量。

export interface BOMComponent {
  modelName: string
  quantity: number
}

export interface AssetCapacities {
  memoryGB: number
  diskGB: number
}

const MEMORY_RE = /(内存|ram|ddr|so-dimm|memory)/i
const DISK_RE = /(硬盘|ssd|hdd|nvme|disk)/i

// 从型号名中提取容量（GB）。支持 GB / TB（1TB = 1000GB）。
export function extractCapacityGB(name: string): number | null {
  if (!name) return null
  const tbMatch = name.match(/(\d+(?:\.\d+)?)\s*TB/i)
  if (tbMatch) {
    return parseFloat(tbMatch[1]) * 1000
  }
  const gbMatch = name.match(/(\d+(?:\.\d+)?)\s*GB/i)
  if (gbMatch) {
    return parseFloat(gbMatch[1])
  }
  return null
}

function isMemory(name: string): boolean {
  return MEMORY_RE.test(name)
}

function isDisk(name: string): boolean {
  return DISK_RE.test(name)
}

// 汇总一组组件的容量。
// 当 assetComponents 提供且非空时，以它为准；否则（为空或未提供）回退到 templateBOM。
export function computeAssetCapacities(
  templateBOM: BOMComponent[],
  assetComponents?: BOMComponent[]
): AssetCapacities {
  const source =
    assetComponents && assetComponents.length > 0 ? assetComponents : templateBOM

  let memoryGB = 0
  let diskGB = 0

  for (const comp of source) {
    const name = comp.modelName ?? ""
    const cap = extractCapacityGB(name)
    if (cap == null) continue
    const qty = comp.quantity ?? 1
    if (isMemory(name)) {
      memoryGB += cap * qty
    } else if (isDisk(name)) {
      diskGB += cap * qty
    }
  }

  return { memoryGB, diskGB }
}
