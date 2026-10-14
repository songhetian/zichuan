/**
 * AssetLabel —— 标签打印页的单个标签视觉（屏幕预览与打印共用同一套结构）。
 *
 * 产品约定（2026-10-14 用户要求）：
 *   - **只显示设备编号**：名称、部门、使用人在设备列表/详情里随时可查，
 *     印到 80×40mm 的实物标签上只会挤占编号的可读性；
 *   - **内容居中**：标签是小尺寸实物，居中比左对齐更整齐；
 *   - **外层一圈虚线**：虚线是裁切参考线（标签纸的模切边界），
 *     内层实线才是内容框，两者拉开层次；
 *   - 屏幕预览与打印只差字号与圆角，结构一致，避免「预览和实物不一样」。
 *
 * 排版：编号是唯一主角 —— 等宽字体（不同编号位数对齐一致）、特粗字重、
 * 超大字号，整块在标签内水平垂直居中。两层框都只描线、不用色块填充，
 * 这样黑白标签机也能印出同样的效果。
 */

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
  /** 打印版：按 80×40mm 实物尺寸排的字号 */
  compact?: boolean;
}

/** 编号样式：等宽 + 特粗 + 字距收紧，字号由调用处按预览/打印分别指定 */
const CODE_CLASS =
  "max-w-full truncate font-mono font-black leading-none tracking-tight";

export function AssetLabel({ label, compact = false }: AssetLabelProps) {
  if (compact) {
    // 打印版：80×40mm 实物尺寸。
    // 外圈虚线 = 模切/裁切参考线；内圈实线 = 内容框
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden border border-dashed border-black/35 p-[1.5mm] text-center">
        <div className="flex h-full w-full items-center justify-center overflow-hidden border border-black/45 bg-white px-2 text-center">
          <div className={`${CODE_CLASS} text-[38px]`}>{label.assetNo}</div>
        </div>
      </div>
    );
  }

  // 屏幕预览：结构与打印版一致，只是字号更大、带圆角与浅阴影
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border bg-white p-2.5 text-center">
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-md border-2 border-border bg-white px-4 text-center shadow-sm">
        <div className={`${CODE_CLASS} text-[46px] text-foreground`}>
          {label.assetNo}
        </div>
      </div>
    </div>
  );
}
