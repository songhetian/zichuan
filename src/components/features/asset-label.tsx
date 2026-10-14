/**
 * AssetLabel —— 标签打印页的单个标签视觉（屏幕预览与打印共用同一套结构）。
 *
 * 产品约定：
 *   - **不显示部门**：部门在设备列表里可查，印到实物标签上只是噪声；
 *   - **内容居中**：标签是小尺寸实物（80×40mm），居中比左对齐更整齐；
 *   - 屏幕预览与打印只差字号，结构保持一致，避免「预览和实物不一样」。
 */

export interface AssetLabelData {
  id: number;
  assetNo: string;
  name: string;
  employeeName: string;
  /** 故意不渲染：保留字段以便调用方直接传 action 返回的 LabelData */
  departmentName?: string;
}

interface AssetLabelProps {
  label: AssetLabelData;
  /** 打印版：按 80×40mm 实物尺寸排的字号 */
  compact?: boolean;
}

export function AssetLabel({ label, compact = false }: AssetLabelProps) {
  if (compact) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center overflow-hidden px-2 py-1 text-center"
        style={{ boxSizing: "border-box" }}
      >
        {/* 编号：最大最醒目 */}
        <div className="max-w-full truncate font-mono text-[18px] font-black leading-none tracking-tight text-foreground">
          {label.assetNo}
        </div>

        {/* 设备名：第二层级 */}
        <div className="mt-1 max-w-full truncate text-[11px] font-medium text-foreground/80">
          {label.name}
        </div>

        {/* 分隔线 + 使用人 */}
        <div className="mt-1 w-full border-t border-border/60 pt-1">
          <span className="block truncate text-[10px] text-muted-foreground">
            {label.employeeName || "未分配"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-md border border-border/80 bg-white px-4 py-3 text-center shadow-sm">
      <div className="max-w-full truncate font-mono text-2xl font-black tracking-tight text-foreground">
        {label.assetNo}
      </div>

      <div className="mt-1 max-w-full truncate text-sm font-medium text-foreground/80">
        {label.name}
      </div>

      <div className="mt-2 w-full border-t border-border/60 pt-2">
        <span className="block truncate text-xs text-muted-foreground">
          {label.employeeName || "未分配"}
        </span>
      </div>
    </div>
  );
}
