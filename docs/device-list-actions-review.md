# 设备列表操作按钮布局评估与优化建议

> 审查对象：`src/app/(main)/assets/asset-list-client.tsx`（设备/资产管理列表页）
> 审查依据：Web Interface Guidelines — WCAG 2.1 AA（1.4.10 Reflow、2.4 可操作、2.5.8 目标尺寸）、响应式表格最佳实践、TanStack Table `table-fixed` 行为。
> 结论：**需要优化**；根因在共享 `DataTable` 层，应在共享层修复（覆盖约 10 个列表页），而非只改设备列表页。

---

## 一、问题定位（根因）

设备上"操作"列（`asset-list-client.tsx:833-841`）是 11 列中**最靠右**的一列，固定 `size: 176 / minSize: 168`。操作按钮在 `ActionButtons`（`asset-list-client.tsx:507`）里用 `flex items-center gap-0.5` 横向排布，最多 4 个图标按钮（IN_USE 行：归还 + 调拨 + 送修 + 更多），内容硬宽约 **134px**，且**无 `flex-wrap`、无 `min-w`**。

但 `minSize: 168` 实际是**失效**的：

- `src/components/features/data-table.tsx:41-50` 的 `getColStyle` 只为单元格写入 `width: Xpx` 与 `maxWidth`（仅当显式设 `maxSize`），**完全没有把列的 `minSize` 转成 CSS `min-width`**。
- 由于表格是 `table-fixed w-full`（`data-table.tsx:107-108`），当视口宽度放不下所有列时，浏览器**按比例压缩**每一列，操作列被压到 168px 以下 → 134px 的内容溢出单元格 → 图标按钮被裁切/溢出，用户感觉"按钮被隐藏、要滚动才看全"。

> 视口测算（默认隐藏序列号列）：列宽合计约 `1376px`。在 1366px 笔记本、减去侧栏(~240)+页边距(~48) 后内容区仅 ~1078px，操作列被压到 `176 × 1078/1376 ≈ 138px`，IN_USE 行 4 按钮已临界；开启序列号列合计 ~1526px 时直接跌破 134px → 溢出。这正是用户反馈的来源。

---

## 二、对"整体扩大显示区域"方案的可行性评估

**结论：不可行，也不应作为主方案。**

| 维度 | 评估 |
|------|------|
| 屏幕宽度有界 | 内容容器已是 `w-full` 占满可用宽；"扩大显示区域"只能去掉侧栏/出血，但屏幕物理宽度有上限，小屏笔记本 / 平板依旧会溢出，只是把临界点往后挪，**未解决根因**。 |
| 信息密度 | 本系统是数据密集型内部管理系统，11 列同屏是本意；全局放大→要么列更宽（更空）、要么减少列，都会损害密度或可用性。 |
| 波及面 | "所有页面统一扩大"等于对所有表格改布局，回归风险高，且与"只解决操作按钮可见性"的目标不匹配。 |
| 根因未动 | 真正缺陷是操作列**无最小宽度兜底 + 无冻结**，与总宽度无关；不补这两点，放大后问题换种形态仍在。 |

**建议**：把"扩大显示区域"降级为"确保表格容器已用满可用宽度（当前已满足）"这一既成事实，不作为优化动作。真正的修复是**给操作列加最小宽度兜底 + 冻结（sticky）**，使数据列可滚动、操作列始终可见。

---

## 三、优化范围

**结构性弱点全网共用，应在共享 `DataTable` 层修复；设备列表只是最突出的表现。**

实测证据：
- `DataTable` 被约 10 个列表页共用（grep `DataTable`）：assets、employees、templates、stocktake、lifecycle、components/models/component-list、stock/log、purchase、approvals/done、approvals/cc。
- 其中至少 8 个定义了 `actions` 操作列（`grep id: "actions"` / `header: "操作"`）。
- 员工列表页 `employee-list-client.tsx:921-984` 的 `actions` 列同样是 `flex` 横排、无 `minSize`（仅 `size: 340`）、无冻结 → 在 `table-fixed` 下会被同样压窄，且它放的是**文字按钮**（数据范围/重置密码/启用停用），溢出更严重。

| 范围选项 | 评价 |
|----------|------|
| A. 只改设备列表页 | ❌ 临时止血，但员工页等仍坏，且两页行为不一致，不推荐作为终态 |
| B. 所有页面统一"扩大" | ❌ 见第二节，错误方向 |
| **C. 在共享 `DataTable` 层修复（冻结操作列 + 尊重 minSize），各页补 `minSize`** | ✅ **推荐**：一处修改惠及全部列表页，且每页按自身内容声明合适的 `minSize`，行为一致 |

---

## 四、具体优化建议（代码级，未改动源码）

### 建议 1（关键，系统性根因修复）— `getColStyle` 补发 `min-width`

`src/components/features/data-table.tsx:41-50`：把列定义的 `minSize` 输出为 CSS `min-width`，使声明的下限真正生效。

```ts
function getColStyle<TData, TValue>(column: Column<TData, TValue>): CSSProperties {
  const size = column.getSize() ?? DEFAULT_COLUMN_SIZE
  const minSize = column.columnDef.minSize
  const maxSize = column.columnDef.maxSize
  const style: CSSProperties = { width: `${size}px` }
  // 新增：尊重声明的最小宽度，防止 table-fixed 在窄视口下把列压到内容以下
  if (typeof minSize === "number" && minSize > 0 && minSize < 100000) {
    style.minWidth = `${minSize}px`
  }
  if (typeof maxSize === "number" && maxSize < 100000) {
    style.maxWidth = `${maxSize}px`
  }
  return style
}
```

效果：操作列有了 `min-width` 兜底后，`table-fixed w-full` 在放不下时会让表格**宽于容器 → 触发已有的 `overflow-x-auto` 横向滚动**，数据列可滚动，操作列不再被压没。

### 建议 2（关键，可见性）— 把操作列冻结在右侧（sticky）

在 `DataTable` 渲染时，对"操作列"（约定 `id === "actions"` 或 `meta.sticky === "right"`）的表头与单元格加 `sticky right-0` + 背景，使其横向滚动时**始终可见**。

`data-table.tsx` 表头（`TableHead`）与单元格（`TableCell`）渲染处加判断（示意）：

```tsx
{headerGroup.headers.map((header) => {
  const isActions = header.column.id === "actions" || (header.column.columnDef.meta as any)?.sticky === "right"
  const stickyCls = isActions ? "sticky right-0 z-20 bg-secondary/80 backdrop-blur-md" : ""
  return (
    <TableHead ... className={`... ${stickyCls}`}>
      ...
```

```tsx
{row.getVisibleCells().map((cell) => {
  const isActions = cell.column.id === "actions" || (cell.column.columnDef.meta as any)?.sticky === "right"
  const stickyCls = isActions ? "sticky right-0 z-10 bg-card" : ""
  return (
    <TableCell ... className={`py-2.5 align-middle ${alignClass} ${stickyCls}`}>
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  )
})}
```

注意：冻结列需要背景色遮挡下方滚动内容（表头用 `bg-secondary/80`、单元格用 `bg-card`），否则文字会穿透。已确认当前表头有 `bg-secondary/80 backdrop-blur-md`，单元格补 `bg-card` 即可。

### 建议 3（各页补 `minSize`）— 按内容声明操作列下限

- 设备列表 `asset-list-client.tsx:836`：`minSize: 168` 已存在，配合建议 1 即生效（4 图标 ≈134px < 168，安全）。可顺手把 `ActionButtons` 行容器加 `flex-nowrap` 明确不换行。
- 员工列表 `employee-list-client.tsx:924`：当前 `size: 340` 但**无 `minSize`** → 补 `minSize: canManageAccounts ? 360 : 120`，否则文字按钮照样溢出。
- 其它含 `actions` 列的页面：按各自按钮数补一个合理的 `minSize`。

### 建议 4（建议，降密度风险）— 窄屏自动收起低频列

当前已有"列设置"弹层（默认隐藏序列号）。可进一步：在 `< lg` 断点默认再收起 1–2 个低频列（如品牌/型号），为操作列腾出空间，减少触发横向滚动的概率。属体验增强，非必需。

---

## 五、无障碍与规范核对

- ✅ 图标按钮 `32×32px`（`size="icon" h-8 w-8`）≥ WCAG 2.5.8 目标尺寸下限 24×24 CSS px，无目标尺寸问题。
- ⚠️ 当前"操作列被压没"违背 **WCAG 1.4.10 Reflow** 精神（控件应无需二维滚动即可触达）与 **2.4 可操作**原则。建议 1+2 的组合（最小宽度兜底 + 冻结列）是表格类界面容纳多列同时保证操作可达的标准解法。
- ✅ 图标按钮已带 `title` + `aria-label`（`asset-list-client.tsx:509-536`），无障碍语义本身没问题，问题仅在空间可见性。

---

## 六、严重等级汇总

| 等级 | 问题 | 位置 |
|------|------|------|
| 🔴 关键 | 操作列无生效的最小宽度（`minSize` 未被输出为 CSS `min-width`）+ 无冻结，窄视口下按钮溢出/被裁切，需横向滚动才看全 | `data-table.tsx:41-50`、`asset-list-client.tsx:507,833-841` |
| 🟡 重要 | "整体扩大显示区域"不可行/不应作主方案（屏幕有界、损害密度、不动根因） | 方案层面 |
| 🔵 建议 | 各页操作列按内容补 `minSize`；窄屏默认收起低频列 | 多页 `actions` 列 |

---

## 七、落地顺序建议

1. `data-table.tsx`：`getColStyle` 补 `min-width`（建议 1）。
2. `data-table.tsx`：操作列 `sticky right-0` 冻结（建议 2）。
3. 设备列表确认 `minSize:176` 足够；员工列表补 `minSize`（建议 3）。
4. （可选）窄屏默认收起低频列（建议 4）。
5. 跑 `npm run test` 与 `tsc --noEmit` 验证无回归；真实浏览器在 1280/1366/768 宽度下核对操作列始终可见。
