// 系统日志「模块」列展示文案映射。
//
// 生产代码写入的 module 取值：
//   分配 / 归还 / 调拨 / 升级 / 报废 / 送修 / 维修完成 / 配置变更（设备生命周期，均为中文）
//   入库（配件库存，中文）
//   asset（批量导入写入，英文）
// 历史遗留数据可能出现 "A" / "B" 等字母值（已无意义，统一显示为「其他」）。
//
// 这里只映射需要中文化的非中文取值；中文值走默认（原样返回）。

export const MODULE_LABEL_MAP: Record<string, string> = {
  asset: "资产导入",
  A: "其他",
  B: "其他",
};

/** 把模块原始值转换为展示用中文文案；未收录的值原样返回。 */
export function moduleLabel(module: string): string {
  if (!module) return module;
  return MODULE_LABEL_MAP[module] ?? module;
}
