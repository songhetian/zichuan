/**
 * AssetLabel —— 标签打印页的单个标签视觉（屏幕预览与打印共用同一套结构）。
 *
 * 产品约定（2026-10-14 用户要求）：
 *   - **只显示设备编号**：名称、部门、使用人在设备列表/详情里随时可查，
 *     印到实物标签上只会挤占编号的可读性；
 *   - **内容居中**：标签是小尺寸实物，居中比左对齐更整齐；
 *   - **外层一圈虚线**：虚线是裁切参考线（标签纸的模切边界），
 *     内层实线才是内容框，两者拉开层次；
 *   - **编号要看得清楚**：预览与打印【同尺寸、同字号】，只差描边颜色与圆角，
 *     屏幕上看到的就是打出来的样子。
 *
 * 尺寸与字号不在本文件里拍脑袋，统一来自 lib/label-size.ts；那里同时保证
 * 9 位编号（前缀 + "-" + 6 位随机码）放得下、不会被截断。
 *
 * 2026-10-15：字号改用 cqw —— 外层容器声明 container-type: inline-size，
 * 编号字号取其宽度的固定比例。打印缩放、字体 fallback、不同 DPI 下文字都
 * 与容器同比例伸缩，不会出现「浏览器里放得下、打出来被 truncate」。
 *
 * fontPx 模式：html2canvas（导出 PDF 用）不支持 cqw / 容器查询，导出时
 * 传 fontPx 让编号用固定 px 字号、且不声明 container-type，其余结构不变。
 *
 * 排版：编号是唯一主角 —— 等宽字体（不同编号位数对齐一致）、特粗字重，
 * 整块在标签内水平垂直居中。两层框都只描线、不用色块填充，
 * 这样黑白标签机也能印出同样的效果。
 */
import { LABEL_CODE_FONT_CQW } from "@/lib/label-size";

export interface AssetLabelData {
  id: number;
  assetNo: string;
  /** 故意不渲染：保留字段，方便调用方直接透传 action 返回的 LabelData */
  name?: string;
  /** 故意不渲染：同上 */
  employeeName?: string;
  /** 故意不渲染：同上 */
  departmentName?: string;
}

interface AssetLabelProps {
  label: AssetLabelData;
  /** 打印版：与预览同尺寸同字号，只去掉圆角/阴影、虚线改用黑色 */
  compact?: boolean;
  /**
   * 固定 px 字号（导出 PDF 专用）：传入后不用 cqw，也不声明 container-type。
   * 浏览器打印/屏幕预览不要传 —— cqw 的自适应能力正是防截断的关键。
   */
  fontPx?: number;
}

/**
 * 编号样式：等宽 + 特粗 + 字距收紧；字号按容器宽度自适应（cqw）。
 * 导出供测试断言契约 —— jsdom 的 CSS 解析器不认识 cqw 单位，渲染后的 DOM
 * 上读不到该声明（React 序列化时即被丢弃），只能从样式对象本身验证。
 */
export const CODE_CLASS =
  "font-mono font-black leading-none tracking-tight";
export const CODE_STYLE = { fontSize: `${LABEL_CODE_FONT_CQW}cqw` };

/** 两层框的公共结构：外圈虚线（裁切线）+ 内圈实线（内容框），全部只描线不填色 */
const SHELL_CLASS =
  "flex h-full w-full items-center justify-center overflow-hidden p-[1.5mm] text-center";
const INNER_CLASS =
  "flex h-full w-full items-center justify-center overflow-hidden px-1.5 text-center";

export function AssetLabel({ label, compact = false, fontPx }: AssetLabelProps) {
  // 浏览器渲染管线走 cqw 自适应；html2canvas 管线（导出 PDF）走固定 px。
  // truncate 只用于浏览器端兜底 —— html2canvas 对 text-overflow: ellipsis
  // 的渲染有 bug（会误加省略号），且 fontPx 模式下字号已由数学保证放得下，
  // 所以导出管线不带 truncate。
  const useCqw = fontPx == null;
  const containerType = useCqw ? " [container-type:inline-size]" : "";
  const overflowGuard = useCqw ? " max-w-full truncate" : "";
  const codeStyle = useCqw ? CODE_STYLE : { fontSize: `${fontPx}px` };
  const codeClass = `${CODE_CLASS}${overflowGuard}`;

  if (compact) {
    // 打印版：外圈虚线 = 模切/裁切参考线，内圈实线 = 内容框
    return (
      <div className={`${SHELL_CLASS} border border-dashed border-black/35${containerType}`}>
        <div className={`${INNER_CLASS} border border-black/45 bg-white`}>
          <div className={codeClass} style={codeStyle}>
            {label.assetNo}
          </div>
        </div>
      </div>
    );
  }

  // 屏幕预览：与打印版同一尺寸、同一字号，只多圆角与浅阴影
  return (
    <div className={`${SHELL_CLASS} rounded-lg border-2 border-dashed border-border bg-white${containerType}`}>
      <div className={`${INNER_CLASS} rounded-md border-2 border-border bg-white shadow-sm`}>
        <div className={codeClass} style={codeStyle}>
          {label.assetNo}
        </div>
      </div>
    </div>
  );
}
