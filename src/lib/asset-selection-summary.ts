// 选中设备的摘要文案。
//
// 用于分配/调拨弹窗顶部的「设备上下文条」：光有一个下拉、看不出正在操作哪台设备
// 是这批弹窗原本最大的问题（尤其单台分配，点错了也不知道）。
// 抽成纯函数以便测试，也避免 4 个弹窗各写一份区间拼接逻辑。

export interface SelectionAsset {
  assetNo: string;
  categoryName: string;
}

export interface SelectionSummary {
  count: number;
  /** 单一分类时为分类名；多分类为「首个分类 等 N 类」；空选为空串 */
  categoryText: string;
  /** 「最小编号 ~ 最大编号」；单台为自身编号；空选为空串 */
  assetNoRange: string;
}

/** 编号按自然序比较（DN-0009 应排在 DN-0010 之前；兼容带随机后缀的编号） */
function byAssetNo(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function summarizeSelection(assets: SelectionAsset[]): SelectionSummary {
  if (assets.length === 0) {
    return { count: 0, categoryText: "", assetNoRange: "" };
  }

  const categoryNames = [...new Set(assets.map((a) => a.categoryName))];
  const categoryText =
    categoryNames.length === 1 ? categoryNames[0] : `${categoryNames[0]} 等 ${categoryNames.length} 类`;

  const sorted = assets.map((a) => a.assetNo).sort(byAssetNo);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const assetNoRange = first === last ? first : `${first} ~ ${last}`;

  return { count: assets.length, categoryText, assetNoRange };
}
