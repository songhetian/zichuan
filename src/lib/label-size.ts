/**
 * 标签尺寸与编号字号的唯一真相源。
 *
 * 背景：一张标签只印设备编号（见 components/features/asset-label.tsx）。
 * 系统里的编号长度是固定的 —— 2 位分类前缀 + "-" + 6 位随机码 = 9 字符
 * （`AssetCategory.numberingRule = "{prefix}-{R6}"`），所以标签尺寸和字号
 * 可以一次算清，不需要运行时测量文字宽度。
 *
 * 硬约束：编号必须【完整可见且足够大】。缩字或裁掉一位，实物标签就没用了。
 * 因此把「标签多宽 → 文字可用多宽 → 9 位编号要多少像素」固化成常量与纯函数，
 * tests/label-size.test.ts 会在尺寸被改坏时立刻失败。
 *
 * 2026-10-15：字号改用 cqw（容器宽度的百分比）而非固定 px。原因：真实打印
 * 环境（打印缩放 / 字体 fallback / DPR）与浏览器预览存在差异，固定 px 的
 * 余量被吃掉后编号会被 truncate 成 "DN-DN8…"（用户实拍复现）。cqw 让字号
 * 与容器宽度联动，容器怎么缩放文字都同比例跟随，结构上不可能溢出。
 */

/** 标签物理宽度（mm）—— 预览与打印共用同一尺寸，所见即所得 */
export const LABEL_WIDTH_MM = 75;

/** 标签物理高度（mm）—— 预览与打印共用同一尺寸 */
export const LABEL_HEIGHT_MM = 35;

/** CSS 中 1mm 对应的像素数（96dpi ÷ 25.4） */
export const PX_PER_MM = 96 / 25.4;

/** mm → px（浏览器 CSS 标准 96dpi） */
export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

// ============================================================
// 导出 PDF 的排版几何
//
// 导出与打印必须是同一套视觉（两列、75×35mm、编号完整）。html2canvas
// 不支持 cqw / 容器查询，无法复用屏幕预览的渲染结果，因此导出时在
// 离屏容器里以固定 px 重新渲染（AssetLabel 的 fontPx 模式），再按
// px→mm 精确映射贴入 A4。这里的常量把「一页放多少、sheet 多大」
// 固化成可测事实，超页会被 tests/label-size.test.ts 挡住。
// ============================================================

/** A4 页边距（mm）—— 与浏览器打印默认边距一致 */
export const EXPORT_PAGE_MARGIN_MM = 10;

/** 标签行列间距（mm）—— 用户要求加大方便裁剪（≥8mm，剪刀有余量） */
export const EXPORT_GAP_MM = 8;

/** sheet 内边距（mm） */
export const EXPORT_SHEET_PADDING_MM = 2;

/**
 * 每页行数：间距 8mm 时 A4 可打印高 277mm 只放得下 6 行
 * （6×35 + 5×8 + 2×2 = 254mm ≤ 277；7 行需 297mm 会超页），
 * 一页 2×6 = 12 个。
 */
export const EXPORT_ROWS_PER_PAGE = 6;

/** 导出 sheet 净宽（mm）：2 列标签 + 1 个列距 + 左右内边距 = 158 */
export const EXPORT_SHEET_WIDTH_MM =
  2 * LABEL_WIDTH_MM + EXPORT_GAP_MM + 2 * EXPORT_SHEET_PADDING_MM;

/** 导出 sheet 净高（mm）：6 行标签 + 5 个行距 + 上下内边距 = 254 */
export const EXPORT_SHEET_HEIGHT_MM =
  EXPORT_ROWS_PER_PAGE * LABEL_HEIGHT_MM +
  (EXPORT_ROWS_PER_PAGE - 1) * EXPORT_GAP_MM +
  2 * EXPORT_SHEET_PADDING_MM;

/** 按「每页 2 列 × EXPORT_ROWS_PER_PAGE 行」切分标签列表 */
export function paginateForExport<T>(items: T[]): T[][] {
  const pageSize = EXPORT_ROWS_PER_PAGE * 2;
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}

/**
 * 编号字号（cqw，container query width）—— 占标签容器宽度的比例。
 * 运行时真正生效的就是这个值；固定 px 的 LABEL_CODE_FONT_PX 只是它的推导，
 * 用于几何验证与测试锚点，两者永远联动。
 */
export const LABEL_CODE_FONT_CQW = 14;

/**
 * 设计基准字号（px）= cqw 比例 × 容器宽度。
 * 75mm 容器 ≈ 283px → 约 39.7px，比上一版（60mm/34px）明显更大。
 */
export const LABEL_CODE_FONT_PX = (LABEL_CODE_FONT_CQW / 100) * (LABEL_WIDTH_MM * PX_PER_MM);

/**
 * 等宽字体单字符宽度上限（em）：Consolas ≈ 0.55、Menlo/Monaco = 0.6。
 * 取 0.6 做保守估算，保证在任何平台都不会溢出。
 */
export const MONO_ADVANCE_EM = 0.6;

/** 以下四项与 asset-label.tsx 的类名一一对应，改样式时需同步 */
const OUTER_PADDING_PX = 1.5 * PX_PER_MM; // 外圈 p-[1.5mm]
const OUTER_BORDER_PX = 2; // 外圈 border-2
const INNER_PADDING_PX = 6; // 内框 px-1.5
const INNER_BORDER_PX = 2; // 内框 border-2

/** 标签内真正能放文字的宽度（px）：扣掉两层框的内缩 */
export const LABEL_TEXT_WIDTH_PX =
  LABEL_WIDTH_MM * PX_PER_MM -
  2 * (OUTER_PADDING_PX + OUTER_BORDER_PX + INNER_PADDING_PX + INNER_BORDER_PX);

/** 编号的渲染宽度（px，保守估算） */
export function codeWidthPx(assetNo: string, fontPx: number = LABEL_CODE_FONT_PX): number {
  return assetNo.length * MONO_ADVANCE_EM * fontPx;
}

/** 编号在标签里是否放得下（放不下就会被截断，实物标签即失效） */
export function codeFitsLabel(assetNo: string, fontPx: number = LABEL_CODE_FONT_PX): boolean {
  return codeWidthPx(assetNo, fontPx) <= LABEL_TEXT_WIDTH_PX;
}
