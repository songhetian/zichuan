# 前端整体视觉改造：暖纸·精密台账

## Context（背景与目标）

现有系统（Next.js 14 + Tailwind + shadcn/ui 的企业资产管理系统）采用"暖米白 + 青色"的常规后台风格。用户希望彻底推翻重做，但保留现有布局与操作结构，安全换装。

用户已确认两个方向：
1. **视觉风格**：暖纸·精密台账 —— 保持暖色方向，但做更高阶的"纸感台账"编辑风：暖纸背景、深墨文字、松墨绿主色 + 铜色点缀、衬线标题、细发丝边框、密度适中。
2. **布局/操作**：保持整体布局（侧边栏 + 顶栏 + 页面结构），全面换装视觉与细节，不改变操作入口与组件 API。

**核心技术手段是"换装不改骨"**：主要通过重写 `globals.css` 的 CSS 变量实现全局换色（所有 shadcn 组件通过 `var(--xx)` 自动跟随），再对少量硬编码颜色 / 版式做定点替换。组件 API 与测试断言的文字、对齐 class 保持原样，可在不破坏后端与测试的前提下完成换装。

## 新配色体系（写入 globals.css `:root`）

| 变量 | 值 | 说明 |
|---|---|---|
| `--background` | 40 10% 95% | 暖纸底色 |
| `--foreground` | 30 18% 9% | 深墨（近棕黑）文字 |
| `--card` | 42 16% 98% | 暖象牙白卡片，从纸底浮现 |
| `--card-foreground` | 30 18% 9% | |
| `--popover` / fg | 42 16% 98% / 30 18% 9% | |
| `--primary` | 160 40% 26% | 松墨绿（主操作键） |
| `--primary-foreground` | 40 30% 96% | |
| `--secondary` / fg | 38 14% 92% / 30 18% 15% | 暖灰 |
| `--muted` / fg | 38 14% 92% / 30 8% 42% | |
| `--accent` / fg | 160 30% 92% / 160 45% 22% | 松绿点缀 |
| `--destructive` / fg | 8 60% 44% / 40 30% 96% | 砖红（贴合暖调） |
| `--border` | 32 12% 84% | 暖细发丝 |
| `--input` | 32 12% 84% | |
| `--ring` | 160 40% 26% | |
| `--radius` | 0.375rem | 略锐角，台账精密感 |
| `--sidebar-bg` | 40 14% 91% | 侧边栏暖纸（较主底略深） |
| `--sidebar-fg` | 30 18% 25% | |
| `--sidebar-active` | 160 40% 26% | |
| `--sidebar-active-fg` | 40 30% 96% | |

## 字体策略（改为系统字体栈，去 Inter）

- 现 `src/app/layout.tsx` 依赖 `next/font/google` 的 **Inter**（通用、且构建需网络，不利于 docker/离线）。
- 改为：body 用系统中文写栈「PingFang SC / Microsoft YaHei / Noto Sans CJK SC / sans-serif」；标题/品牌用衬线栈「Noto Serif SC / Songti SC / STSong / SimSun / serif」。
- 通过 globals.css 提供的 `.font-display`（衬线）工具类在**品牌名、PageHeader 标题、CardTitle、登录标题**上使用衬线，形成"台账/印刷"编辑感；正文保持无衬线保证长文可读性。

## 纸感细节

- 卡片/面板：细发丝边框 + 极轻暖阴影（`shadow-[0_1px_2px_rgba(70,50,20,0.06)]` 级别），去掉纯灰硬阴影。
- 表格：表头暖灰底、行间细发丝分隔、hover 松绿淡化，保持现有对齐 class 与文字。
- 焦点 ring、选区、滚动条微调配色贴合暖调（在 globals.css 做 selection/scrollbar 定制）。
- 状态徽章：把现有 emerald/amber/red/slate 硬色改为贴合暖纸的更柔和、带暖调油灰的版本（标签文字不变 → status-labels 测试安全）。

## 待修改文件清单

**主题与基础**
1. `src/app/globals.css` — 重写 `:root` 变量；调整 base isolation；新增 `.font-display`、selection、scrollbar 等 utilities。
2. `src/app/layout.tsx` — 移除 Inter 依赖，body 用系统字体栈。
3. `tailwind.config.ts`（可选）— 如需 `font-display`/radius 精细 token 再补 fontFamily 扩展。

**核心 UI 组件（只改 class，不改 API）**
4. `src/components/ui/button.tsx` — 主键阴影 / hover 微调，贴合暖纸。
5. `src/components/ui/card.tsx` — 暖卡片表面 + 柔和阴影 / 发丝边框；`CardTitle` 用衬线。
6. `src/components/ui/badge.tsx`、`input.tsx`、`select.tsx`、`dialog.tsx`、`tabs.tsx`、`table.tsx`、`toaster.tsx` — 主要经变量自动换装，个别微调（如 badge、focus ring、卡片圆角）。

**业务/通用组件**
7. `src/components/features/status-badge.tsx` — 状态色与暖纸协调（标签文字不变）。
8. `src/lib/constants.ts` — `ASSET_STATUS_BADGE_MAP` 与 `ASSET_STATUS_COLOR_MAP`（ECharts 图表色）换为暖色系。
9. `src/components/features/page-header.tsx` — 标题衬线化 + 细节。
10. `src/components/features/data-table.tsx` — 表头/行发丝分隔 + hover 松绿，保持对齐 class 与列结构。
11. `src/components/features/lifecycle-timeline.tsx`、`tree-table.tsx`、`filter-bar.tsx` — 点缀色统一为松绿/铜色。

**布局 & 登录**
12. `src/components/layout/sidebar.tsx` — 暖纸侧边栏（非深色）、衬线品牌、激活/悬停精修；**保持导航结构与行为不变**。
13. `src/components/layout/header.tsx` — 暖纸顶栏、用户/铃铛/退出视觉精修；行为不变。
14. `src/app/login/login-form.tsx` — 暖纸登录卡 + 衬线品牌 + 轻微纸纹/装饰；表单文字与按钮文本保持原样。

**仪表盘**
15. `src/app/(main)/dashboard/dashboard-client.tsx` — 统计卡与图表颜色自动跟随变量 + 图表色来自 constants；做少量点缀精修。

> 说明：其余业务页面（配件/员工/审批/通知/设置/盘点等）几乎全部由 `ui/*` 组件 + `globals.css` 变量 + `features/*` 组成，换装后会自动统一跟进，无需逐个大改。

## 验收方式（视觉只改，逻辑不动）

- `npx tsc --noEmit` — 0 错误（确认组件 API/class 未破坏类型）。
- `npm run test:ui` — 前端组件测试全绿（断言文字、对齐 class 均未改动）。
- `npm run dev` 冒烟：登录页 → 首页仪表盘 → 设备列表/详情 → 审批流程页面 → 系统设置，肉眼确认换装统一、无错位、字体/配色正常。
- 数据库/后端动作与 `npm run test`（DB 用例）不受影响，可选择性跑。

## 风险与规避
- Inter 移除会影响构建字体加载，改用系统字体栈后不依赖外部网络（利于 docker 离线部署）。
- 组件全用 `cn()` 类合并 + CSS 变量，改动集中在 class 字符串，API 与 props 不变 → 现有测试、类型、后端调用均不受影响。