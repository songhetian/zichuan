# 雷犀管理系统 · Web 界面设计规范审查报告

> 审查范围：`src/` 全部 UI 代码（约 70 个 `.tsx` + 共享组件）
> 审查依据：WCAG 2.1 AA、响应式设计最佳实践、Apple HIG / Material Design
> 审查日期：2026-09-28
> 方法：全量枚举文件 → 精读基础组件/布局/代表页面 → 全仓 grep 量化系统性问题

---

## 一、总体结论（直接回答你的问题）

**目前不符合 WCAG 2.1 AA 标准，但地基很好。** 这不是"从头烂"，而是"在很扎实的 Radix/shadcn 底座上，漏掉了一批系统性无障碍细节"。

- ✅ **做得好的部分**：表单基础组件（Button/Input/Select/Dialog/Tabs 等）由 Radix 兜底，ARIA/键盘/焦点大部分正确；数据表用了语义化 `<table>` 且外层 `overflow-x-auto`；状态徽标用"中文文字+颜色"而非纯颜色；表格里的图标操作按钮都带了 `aria-label`；响应式栅格（`sm/md/lg/xl`）用得不错。
- ❌ **会被 AA 审计卡住的部分**：表单标签与控件未关联、当前页未向辅助技术标示、可排序列缺 `aria-sort`、仪表盘用 `<div onClick>` 做"假按钮"导致键盘不可操作、错误提示从不被读屏器播报、移动端侧边栏关闭后仍留在 Tab 焦点链中。

**好消息**：这些问题大多集中在少数"共享组件"里（`simple-crud-dialog`、`data-table`、`sidebar`、`page-pagination`、`searchable-select`）。修这几个文件，能一次性改善约 30 个页面。

---

## 二、问题统计

| 严重等级 | 数量 | 说明 |
|---|---|---|
| 🔴 关键（不修不达标 AA） | 7 | 阻断键盘/读屏器使用的硬伤 |
| 🟡 重要（明显体验/合规缺陷） | 5 | 应修，影响可用性与专业度 |
| 🔵 建议（打磨项） | 5 | 进阶优化 |

> 全仓 grep 佐证（"0 处"即代表系统性缺失）：
> - `aria-current`：**0 处** · `aria-sort`：**0 处** · `aria-expanded`：仅 1 处（searchable-select 内部）· `role="alert"`/`aria-live`：**0 处**
> - `<Label>` 出现在 **31 个文件**，但 `htmlFor=` 仅 **10 个文件** → 约 25 个文件的表单标签与控件失联。

---

## 三、详细发现（file:line 定位 + 修复建议）

### 🔴 1. 表单标签与控件未关联（系统性，最高优先级）
控件没有 `id`、`<Label>` 没有 `htmlFor`，读屏器无法把"设备名称"和输入框对应起来。

- 根因（影响所有设置表单）：`src/components/features/simple-crud-dialog.tsx:115` —— `<Label>{field.label}</Label>` 后直接渲染 `Input/Select/SearchableSelect`，三者均无 `id`。
- 资产详情编辑弹窗：`src/app/(main)/assets/[id]/asset-detail-client.tsx:429,438,446,457,538`
- 资产列表编辑/分配/调拨弹窗：`src/app/(main)/assets/asset-list-client.tsx:302,307,311,316,320,615,643,1569,1598`
- 同样模式还出现在：`templates/template-form-dialog.tsx`、`components/component-list-client.tsx`、`components/models/models-client.tsx`、`approvals/new/new-request-client.tsx`、`employees/employee-list-client.tsx`、`settings/account/account-client.tsx`、`settings/settings-client.tsx` 等（grep 命中 31 处 `<Label>`）。

**规范**：WCAG 1.3.1、3.3.2、4.1.2
**修复**：
1. 给 `SearchableSelect` 增加 `id` 入参并透传到 trigger（它已有 `ariaLabel`，但 `htmlFor` 关联更稳）；同步 `Input` 本来就有 `id` 透传能力。
2. `SimpleCrudDialog` 按 `field.key` 生成 `id`，`<Label htmlFor={id}>`；`Input`/`SelectTrigger`/`SearchableSelect` 接同一 `id`。
3. 各弹窗把 `<Label>xxx</Label>` 改成 `<Label htmlFor="xxx">{xxx}</Label>` 并给控件加 `id`。
> 参考样板（你已有的正确写法）：`src/app/login/login-form.tsx:77-83` 的 `htmlFor`+`id` 关联。

### 🔴 2. 当前页面未向辅助技术标示（侧边栏主因）
激活的导航项仅靠"颜色+左侧细条"区分，读屏器不知道"我在哪一页"。

- `src/components/layout/sidebar.tsx`：展开态激活项 `:316-321`、子项 `:287-292` 的 `<Link>` 均无 `aria-current="page"`。
- 全仓 `aria-current` = **0 处**。

**规范**：WCAG 2.4.8（最佳实践）、1.3.1
**修复**：激活 `<Link>` 加 `aria-current={active ? "page" : undefined}`。

### 🔴 3. 移动端侧边栏关闭后仍留在 Tab 焦点链（键盘陷阱）
- `src/components/layout/sidebar.tsx:362-370`：移动抽屉始终渲染，关闭时仅 `translate-x-full`，未加 `hidden`/`inert` → 屏幕外的链接仍可被 Tab 聚焦；打开时也未见焦点陷阱与 Esc 关闭。

**规范**：WCAG 2.1.1、2.4.3
**修复**：`!mobileOpen` 时加 `hidden`（或 `inert` + `aria-hidden`）；打开时聚焦首个菜单项、Esc 关闭、焦点归还触发按钮。

### 🔴 4. 数据表可排序列缺 `aria-sort`
- `src/components/features/data-table.tsx:120-127`：排序按钮只靠箭头旋转指示方向，`<TableHead>` 未设 `aria-sort`；排序方向对读屏器不可见。
- 全仓 `aria-sort` = **0 处**。

**规范**：WCAG 1.3.1
**修复**：根据 `header.column.getIsSorted()` 给 `<TableHead>` 设 `aria-sort="ascending|descending|none"`；并给排序按钮加 `aria-label`（如"按编号排序"）。

### 🔴 5. 用 `<div onClick>` 做"假按钮"（键盘不可操作）
- 仪表盘 KPI 卡片：`src/app/(main)/dashboard/dashboard-client.tsx:96` `<Card onClick={...}>`（以及 `:413` 待办条目）。
- 资产编号预览：`src/app/(main)/assets/asset-list-client.tsx:696` `<div onClick>` 套在 `PopoverTrigger asChild` 里 —— `div` 默认不可聚焦，键盘打不开预览/无法跳转。

**规范**：WCAG 2.1.1、4.1.2
**修复**：改用 `<button>`（或 `<Link>`）；若坚持用 div，至少加 `role="button"` + `tabIndex={0}` + `onKeyDown`（Enter/Space）。Popover 触发器必须是可聚焦元素。

### 🔴 6. 错误/状态提示从不被读屏器播报
- `src/app/login/login-form.tsx:105-107` 错误 `<p>` 无 `role`/`aria-live`，且输入框缺 `autoComplete`。
- 全仓 `role="alert"`/`aria-live` = **0 处** —— 所有表单校验失败、Toast 提示对辅助技术静默。

**规范**：WCAG 4.1.3（状态消息，AA）
**修复**：错误文本加 `role="alert"`（或 `aria-live="assertive"`）；`Toaster` 按 `variant` 对错误设 `role="alert"`；登录输入框补 `autoComplete="username"` / `autoComplete="current-password"`。

### 🟡 7. 折叠态侧边栏导航 + 分区标题的无障碍缺陷
- 折叠态父项按钮 `sidebar.tsx:165`（PopoverTrigger，仅图标）与折叠态单项 `<Link> :210-220`（仅图标）均无 `aria-label` → 读屏器读不出名字。
- 分区标题是"无 onClick 的 `<button>`"：`sidebar.tsx:234-244`（展开）与 `:385`（移动）——可聚焦、可按却无任何作用，应改为 `<h3>`/`<p>`。

**规范**：WCAG 4.1.2、1.3.1
**修复**：折叠态触发器加 `aria-label={item.label}`；分区标题改用非交互标题元素。

### 🟡 8. 可折叠分组缺 `aria-expanded`
- `sidebar.tsx:255` 展开/收起按钮切换 `expandedItems` 但不暴露 `aria-expanded`。全仓仅 1 处 `aria-expanded`（searchable-select 内部，说明你已会写，只是侧边栏漏了）。

**规范**：WCAG 4.1.2
**修复**：`aria-expanded={isExpanded}`。

### 🟡 9. 分页组件缺失 `aria-current` 与页码按钮标签
- `src/components/ui/page-pagination.tsx:94-102` 页码按钮无 `aria-label`、当前页无 `aria-current`；`:132-142` 跳转 `<Input>` 无 label（"跳至/页"是兄弟节点，未关联）。上一页/下一页有 `aria-label`（好）。
- `src/components/ui/pagination.tsx:72,123` "首页/末页"用 `title` 而非 `aria-label`（`title` 不被读屏器可靠播报）。

**规范**：WCAG 1.3.1、4.1.2
**修复**：当前页 `aria-current="page"`；页码按钮 `aria-label={`第 ${page} 页`}`；跳转框用 `<label>` 关联或加 `aria-label`。

### 🟡 10. 命令面板无可见触发按钮 + 搜索框缺 label
- `src/components/features/command-palette.tsx` 仅 Ctrl+K 打开，页面上无按钮 → 不知道快捷键的用户（尤其键盘/辅助技术用户）无法发现。
- `src/components/ui/command.tsx` 的 `CommandInput` 只有 `placeholder`，无 `aria-label`。

**规范**：WCAG 2.1.1、3.3.2、4.1.2
**修复**：在 Header 放一个可见的"搜索"按钮触发面板；给 `CommandInput` 传 `aria-label`。

### 🟡 11. 顶部汉堡按钮与返回按钮缺 `aria-label`
- `src/components/layout/header.tsx:101` 移动端菜单按钮（仅图标）无 `aria-label`。
- `src/components/features/page-header.tsx:21` 返回按钮（仅图标）无 `aria-label`。
> 对比：表格内操作图标按钮都带 `aria-label`（做得对），说明这两处是疏漏。

**规范**：WCAG 4.1.2
**修复**：加 `aria-label="打开菜单"` / `aria-label="返回"`。

### 🔵 12. 色彩对比度需实测校验
- 我无法在源码阶段计算编译后的精确比值。建议用浏览器审计工具校验：`text-muted-foreground` 落在 `bg-muted` / `bg-card/70`（如 header）上的对比度是否 ≥ 4.5:1。状态徽标（深字+浅底）目测达标。

### 🔵 13. ECharts 图表缺文本替代
- `dashboard-client.tsx` 的饼图/柱状图为 `<canvas>`，无 `role`/`aria-label`。好在饼图下方有等价的文字明细网格，已部分缓解。
**修复**：给图表容器加 `role="img"` + `aria-label` 概要。

### 🔵 14. Progress 组件使用时应给可访问名
- `src/components/ui/progress.tsx` 基于 Radix Progress，使用处应补 `aria-label`（如"导入进度"）。

### 🔵 15. 减少用 `title` 充当无障碍名
- 多处用 `title` 提供说明（如分区标题、列设置按钮）。`title` 不被读屏器可靠朗读，关键可交互元素请用 `aria-label`。

---

## 四、做得出色的地方（保持）

- 基础组件全部基于 Radix（Button/Input/Select/DropdownMenu/Tabs/Tooltip/Popover/Checkbox/Dialog），ARIA、键盘、焦点管理由库兜底。
- 数据表语义化 + `overflow-x-auto` 横向滚动（响应式表格）。
- `StatusBadge`（`status-badge.tsx`）用"中文文字+颜色"，不是仅靠颜色区分（满足 WCAG 1.4.1）。
- 表格内图标操作按钮统一带 `aria-label`（`asset-list-client.tsx:509` 等）。
- 命令面板支持 Ctrl+K + 方向键导航（cmdk）。
- 侧边栏用了 `<nav>`，页面用了 `<h1>`，栅格响应式断点一致。
- 加载骨架屏、空状态提示齐全。

---

## 五、修复优先级路线图

**P0（不修即不达标 AA，且多为共享组件，改一处惠及全站）**
1. `simple-crud-dialog.tsx` + `searchable-select.tsx`：补 `id`/`htmlFor` 关联（消灭 #1，约 25 个文件连带修复）。
2. `sidebar.tsx`：加 `aria-current`（#2）、移动端 `hidden`/焦点陷阱（#3）。
3. `data-table.tsx`：加 `aria-sort`（#4）。
4. `dashboard-client.tsx` / `asset-list-client.tsx`：`<div onClick>` → `<button>`/`<Link>`（#5）。
5. 错误提示加 `role="alert"` + 登录框 `autoComplete`（#6）。

**P1（明显体验/合规缺陷）**
6. 侧边栏折叠态 `aria-label` + 分区标题改 `<h3>`（#7）、`aria-expanded`（#8）。
7. `page-pagination.tsx` / `pagination.tsx` 补 `aria-current`/标签（#9）。
8. 命令面板可见触发按钮 + `aria-label`（#10）。
9. Header 汉堡、PageHeader 返回按钮 `aria-label`（#11）。

**P2（打磨）**
10. 对比度实测（#12）、图表 `role="img"`+`aria-label`（#13）、Progress `aria-label`（#14）、清理 `title` 充当无障碍名（#15）。

---

## 六、一句话总结
> 你的页面"看起来专业、用起来顺手"，但**对键盘和读屏器用户还没真正开放**。好在问题高度集中在 5 个共享组件，按 P0 清单改完，整套系统就能从"不符合"跨到"基本符合 WCAG 2.1 AA"。
