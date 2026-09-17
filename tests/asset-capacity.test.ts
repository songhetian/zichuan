import { describe, it, expect } from "vitest"
import { computeAssetCapacities, type BOMComponent } from "@/lib/asset-capacity"

const cpu: BOMComponent = { modelName: "i7-12700F", quantity: 1 }
const mem8: BOMComponent = { modelName: "8GB DDR4 3200", quantity: 2 }
const mem16: BOMComponent = { modelName: "16GB DDR4", quantity: 1 }
const ssd512: BOMComponent = { modelName: "512GB NVMe SSD", quantity: 1 }
const hdd2tb: BOMComponent = { modelName: "2TB HDD", quantity: 1 }

describe("computeAssetCapacities 容量计算", () => {
  it("汇总内存总容量（8GB x2 + 16GB = 32GB）", () => {
    const result = computeAssetCapacities([cpu, mem8, mem16, ssd512])
    expect(result.memoryGB).toBe(32)
  })

  it("汇总硬盘总容量（512GB + 2TB = 2512GB）", () => {
    const result = computeAssetCapacities([cpu, mem8, ssd512, hdd2tb])
    expect(result.diskGB).toBe(2512)
  })

  it("无内存/硬盘时返回 0", () => {
    const result = computeAssetCapacities([cpu])
    expect(result.memoryGB).toBe(0)
    expect(result.diskGB).toBe(0)
  })

  it("设备自身配件为空时回退到模板 BOM", () => {
    // 整机模式：asset.components 为空，容量来自模板 BOM
    const result = computeAssetCapacities([cpu, mem8, ssd512], [])
    expect(result.memoryGB).toBe(16)
    expect(result.diskGB).toBe(512)
  })
})
