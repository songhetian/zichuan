/**
 * 全站状态 / 语义配色的唯一来源。
 *
 * 约定（2026-09-28 确立，勿再破例）：
 * 1. 业务代码**禁止**硬编码 Tailwind 调色板（`bg-emerald-100` / `text-amber-600` …）。
 *    所有颜色只能走 `globals.css` 的 CSS 变量 token。本项目主题由 class 驱动
 *    （`:root` 亮=默认 / `:root.dark` 暗），硬编码的「浅底 + 深字」组合只对亮色成立，
 *    切到暗色就会失衡。
 * 2. 语义 → 角色（Tone）的判定统一放这里，组件只消费 `TONE_*` 与领域映射表，
 *    避免同一状态在不同页面各写一套颜色（历史上已出现过漂移）。
 * 3. 语义角色只有 6 个：success / warning / danger / info / violet / neutral。
 *    「纯区分」用途（配件分类）走 CATEGORY_DOT，不属于语义。
 */

export type Tone = "success" | "warning" | "danger" | "info" | "violet" | "neutral";

/** 状态胶囊：浅底 + 深字 + 柔和边（需与 `border` 类一起用） */
export const TONE_CHIP: Record<Tone, string> = {
  success: "bg-success-soft text-success-soft-foreground border-success-soft-border",
  warning: "bg-warning-soft text-warning-soft-foreground border-warning-soft-border",
  danger:
    "bg-destructive-soft text-destructive-soft-foreground border-destructive-soft-border",
  info: "bg-info-soft text-info-soft-foreground border-info-soft-border",
  violet: "bg-violet-soft text-violet-soft-foreground border-violet-soft-border",
  neutral: "bg-muted text-muted-foreground border-border",
};

/** 浅底强调块（无边框） */
export const TONE_SOFT: Record<Tone, string> = {
  success: "bg-success-soft",
  warning: "bg-warning-soft",
  danger: "bg-destructive-soft",
  info: "bg-info-soft",
  violet: "bg-violet-soft",
  neutral: "bg-muted",
};

/** 浅底 + 柔边（不含文字色）：用于「圆底 + 内部图标单独着色」两段式结构 */
export const TONE_SOFT_BORDER: Record<Tone, string> = {
  success: "bg-success-soft border-success-soft-border",
  warning: "bg-warning-soft border-warning-soft-border",
  danger: "bg-destructive-soft border-destructive-soft-border",
  info: "bg-info-soft border-info-soft-border",
  violet: "bg-violet-soft border-violet-soft-border",
  neutral: "bg-muted border-border",
};

/** 文字 / 图标着色（实色） */
export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  violet: "text-violet",
  neutral: "text-muted-foreground",
};

/** 实心圆点 / 色条 */
export const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  violet: "bg-violet",
  neutral: "bg-muted-foreground",
};

/** 文字 + 浅底（无边框）：内联小标签 / 表格内的着色文字块 */
export function toneInline(tone: Tone): string {
  return `${TONE_TEXT[tone]} ${TONE_SOFT[tone]}`;
}

// ============================================================
// 领域映射
// ============================================================

/** 资产状态 */
const ASSET_STATUS_TONE: Record<string, Tone> = {
  IDLE: "neutral",
  IN_USE: "success",
  IN_MAINTENANCE: "warning",
  SCRAPPED: "danger",
  RESERVED: "violet",
};

export function assetStatusTone(status: string): Tone {
  return ASSET_STATUS_TONE[status] ?? "neutral";
}

/** 生命周期动作（语义统一：创建/降级=中性，分配/维修完成=成功，归还=信息，调拨/升级=特殊，送修/更换=警告，报废=危险） */
export const LIFECYCLE_ACTION_TONE: Record<string, Tone> = {
  CREATED: "neutral",
  ALLOCATED: "success",
  RETURNED: "info",
  TRANSFERRED: "violet",
  UPGRADED: "violet",
  DOWNGRADED: "neutral",
  SCRAPPED: "danger",
  REPLACED: "warning",
  MAINTENANCE_START: "warning",
  MAINTENANCE_DONE: "success",
};

export function lifecycleActionTone(action: string): Tone {
  return LIFECYCLE_ACTION_TONE[action] ?? "neutral";
}

/** 审批流转时间轴的圆点（边框 / 底 / 光环三件套） */
export function flowDotClass(tone: "start" | "ok" | "fail" | "wait" | "end"): string {
  switch (tone) {
    case "start":
      return "border-primary bg-primary-foreground ring-primary/20";
    case "ok":
      return "border-success bg-success-soft ring-success/20";
    case "fail":
      return "border-destructive bg-destructive-soft ring-destructive/20";
    case "end":
      return "border-primary bg-primary ring-primary/20";
    default:
      return "border-warning bg-warning-soft ring-warning/20";
  }
}

// ============================================================
// 分类标识色（非状态语义）
// ============================================================

/**
 * 配件分类的标识色。仅用于「一眼区分不同分类」的小圆点/色条，
 * 始终与分类名文字同时出现，因此不承载语义、也不参与状态色规则。
 */
const CATEGORY_DOT: Record<string, string> = {
  CPU: "bg-cat-indigo",
  内存: "bg-cat-violet",
  硬盘: "bg-cat-blue",
  显卡: "bg-cat-emerald",
  网卡: "bg-cat-sky",
  主板: "bg-cat-rose",
  电源: "bg-cat-cyan",
  散热: "bg-cat-teal",
  显示器: "bg-cat-purple",
  键盘: "bg-cat-pink",
  鼠标: "bg-cat-fuchsia",
};

export function categoryDotClass(name?: string): string {
  if (!name) return TONE_DOT.neutral;
  return CATEGORY_DOT[name] ?? TONE_DOT.neutral;
}
