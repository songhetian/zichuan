# 批量分配改造方案

> 2026-10-12 定稿。经 15 轮逐项压测确认，**不改数据库 schema**，纯代码改动，三个库均无需 migrate。

## 一、起因：四个现场问题

| # | 现场描述 | 性质 |
|---|---|---|
| 1 | 批量入库后状态为「库存」，库存态设备列表里**无法分配**，只剩报修/报废 | UI 门禁遗漏（后端早已放行） |
| 2 | 批量分配弹窗只能选**一个**员工；无部门搜索、无多选；分配前不知道会不会失败 | UI 能力缺失 + 规则校验时机错位 |
| 3 | 分配弹窗选员工要翻全量列表，很麻烦 | 选人控件无部门维度 |
| 4 | 弹窗样式待优化 | 版式结构性问题 |

## 二、代码勘误（已查实，含两个现存缺陷）

### 2.1 「库存态不能分配」是纯 UI 漏洞

- `src/actions/lifecycle.actions.ts:97` —— `allocateAssets` 的状态白名单本来就是 `["IDLE", "IN_STOCK"]`，**后端一直允许分配库存态设备**。
- `src/app/(main)/assets/asset-list-client.tsx:486` —— 「更多」菜单只在 `asset.status === "IDLE"` 时渲染「分配」。库存态因此只剩「报废」（送修也要求 IDLE/IN_USE）→ 表现为"这批新入库的设备一个能用的操作都没有"。
- 放大体感的入口：批量入库成功后跳 `/assets?status=IN_STOCK`（`stock-in-client.tsx:67`），用户第一眼看到的就是这批设备。

### 2.2 唯一规则在批量路径上**失效**（真实缺陷）

`lifecycle.actions.ts:133` 与 `:333` 检查「目标员工是否已持有该唯一分类设备」时带了 `id: { notIn: assetIds }`，**把本批设备自身排除在外**。

后果：**把 5 台笔记本批量分给同一个人，后端会全部成功** —— 「唯一 = 每人仅限一台」形同虚设。而单台分配时是拦住的（因为 `assetIds` 只有 1 台）。同一规则、两条路径结论相反。`transferAssets` 同款问题。

### 2.3 「分配规则」的实体

设置页「设备分类」的 `AssetCategory.unique` 字段，UI 标签就叫**「分配规则」**：

- `asset-categories-client.tsx:130` 列表表头 = 「分配规则」；`:76` 选项文案 = 「是 - 每人仅限一台」/「否 - 员工可持有多台」。
- 校验语义：目标员工在该分类下已存在 `IDLE | IN_USE | IN_MAINTENANCE` 的设备 → 拒绝。
- 现有实现是**整批事务原子**：任一台冲突 → 全部回滚，只返回一句笼统错误（`UNIQUE_VIOLATION:分类名`）。

## 三、定型决策（15 条）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 库存态可分配 | 是。修 UI 门禁，放开 `IN_STOCK` |
| 2 | 「多选」的含义 | **多选员工**，不是多选设备 |
| 3 | 分配算法 | **均值分配，余数前置**；人数 > 台数直接禁止确认 |
| 4 | 冲突后能否提交 | **跳过冲突，只提交可行的**；确认按钮写明「分配可用的 X 台」 |
| 5 | 预校验覆盖范围 | 设备状态 + 员工历史占用 + **本批内部重复** + 边界情况提示（全选） |
| 6 | 实现路线 | 新增 `precheckAllocation` + `allocateAssetsToEmployees` 两个 action，**规则抽成共用函数**，同时补后端批内校验 |
| 7 | 排序键 | 设备按编号自然序；员工按 部门 → 工号 升序；弹窗内实时显示分配预览 |
| 8 | 多选器形态 | 部门筛选下拉 + 关键字搜索 + 「全选当前结果」+ 复选列表 + 已选 chips |
| 9 | 选人控件铺开范围 | **全部 6 处统一**（抽共享组件） |
| 10 | 唯一规则收紧 | **接受拦截**。"一人多台唯一分类设备"今后永久不可行；需要就改分类为「普通」 |
| 11 | 样式改动范围 | 只重做**分配/调拨这一族**弹窗，不碰全局 `dialog.tsx` |
| 12 | 测试颗粒度 | **算法 + action + 组件 三层** |
| 13 | 交付顺序 | **拆两批，先止血** |
| 14 | 批量调拨 | **保持单选**，仅换上带部门搜索的选择器 |
| 15 | 唯一分类遇到历史占用 | **就地跳过，不重平衡**（不顺延给下一个人） |

### 3.1 决策 3 + 15 的组合语义（最容易被误解，写清楚）

预校验**不做重平衡**。配额槽位是预先算好的固定序列，某个槽位无效时该台设备直接判冲突，**不转给后面还有名额的人**。

```
设备 5 台（笔记本，唯一分类）：D1 D2 D3 D4 D5   （按编号升序）
员工 3 人（部门+工号升序）：   P1 P2 P3
P1 历史已持有 1 台笔记本

① 均分配额      = ⌊5/3⌋ = 1，余数 2 → P1:2  P2:2  P3:1
② 唯一分类封顶   min(配额, 1)                → P1:1  P2:1  P3:1
③ 历史占用作废   P1 已持有 → P1 配额归 0      → P1:0  P2:1  P3:1

槽位序列 = [P1无效, P2, P3]
→ D1 → P1 槽位无效 → 冲突，跳过（不转给 P2）
→ D2 → P2
→ D3 → P3
→ D4、D5 → 无槽位 → 冲突（原因：唯一分类，参与人均已占满）

结果：可分配 2 台，冲突 3 台。
```

> 「唯一分类封顶 1」不是重平衡，而是把「每人仅限一台」这条规则**纳入配额计算**。否则 5 台分给 3 人会得出 2/2/1 的配额，而其中 4 个槽位都是违规的。

## 四、目标态设计

### 4.1 批量分配弹窗（重做）

```
┌────────────────────────────────────────────────────────┐
│ ⤴ 批量分配设备                                    [×]  │
│   将 20 台设备（笔记本）分配给选中的员工                │
├────────────────────────────────────────────────────────┤
│ 设备：20 台  分类：笔记本电脑  编号 DN-0001 ~ DN-0020   │  ← 设备上下文条
│ 规则：笔记本为「唯一」分类，每人仅限一台                │
├──────────────────────────┬─────────────────────────────┤
│ 选择员工                 │ 分配预览                    │
│ [部门 ▼] [🔍 姓名/工号]  │ 李四 · 研发部      1 台     │
│ ☑ 全选当前结果 (5 人)    │ 王五 · 研发部      1 台     │
│ ┌──────────────────────┐ │ 张三 · 研发部      0 台 ⚠   │
│ │ ☑ 李四 · EMP0002 研发 │ │ 赵六 · 市场部      1 台     │
│ │ ☑ 王五 · EMP0003 研发 │ │ 钱七 · 市场部      1 台     │
│ │ ☐ 张三 · EMP0001 研发 │ ├─────────────────────────────┤
│ │ …                    │ │ ✓ 可分配 4 台               │
│ └──────────────────────┘ │ ⚠ 冲突 16 台                 │
│ 已选：李四 ×  王五 ×     │  · 张三 已持有笔记本        │
├──────────────────────────┴─────────────────────────────┤
│                              [取消]  [分配可用的 4 台]  │
└────────────────────────────────────────────────────────┘
```

- 宽度 `max-w-sm` → `max-w-2xl`（需容纳双栏）。
- 顶部**设备上下文条**：台数 / 分类 / 编号区间 / 触发的分配规则（唯一 or 普通）。
- 左栏员工选择器，右栏**分配预览**（谁拿几台，实时联动）。
- `max-h` 滚动区，footer 固定；去掉 `DialogFooter` 自带的那根 `border-t`（局部 `className` 覆盖，不动全局）。
- 冲突逐台可展开查看原因；确认按钮文案随可分配数量实时变化。

### 4.2 单一真相源：`src/lib/allocation.ts`（新增）

纯函数、**不 import prisma**，被服务端 action 与前端预览共用，杜绝规则再漂移出第三份副本。

```ts
export interface AllocationAsset {
  id: number; assetNo: string; status: string;
  categoryId: number; categoryName: string; categoryUnique: boolean;
  employeeId: number | null;
}
export interface AllocationEmployee {
  id: number; name: string; employeeNo: string;
  departmentId: number; departmentName: string;
  ownedUniqueCategoryIds: number[];   // 该员工已持有的唯一分类
}
export interface AllocationPlan {
  assignments: { assetId: number; employeeId: number }[];
  conflicts: { assetId: number; assetNo: string; reason: string }[];
  perEmployee: { employeeId: number; count: number }[];
}
export function planAllocation(
  assets: AllocationAsset[],
  employees: AllocationEmployee[],
  opts?: { enforceUnique?: boolean }   // 默认 true
): AllocationPlan
```

排序：设备 `assetNo.localeCompare(other, undefined, { numeric: true })`（兼容 `{R4}` 随机后缀的编号规则）；员工 `departmentId` → `employeeNo`。

### 4.3 服务端（`src/actions/lifecycle.actions.ts`）

| 变更 | 说明 |
|---|---|
| 新增 `precheckAllocation({ assetIds, employeeIds })` | 读库组装 `AllocationAsset[]` / `AllocationEmployee[]`，调用 `planAllocation` 返回计划。**不写库** |
| 新增 `allocateAssetsToEmployees({ assignments, operator, remark })` | 一次提交多员工映射。内部按 employeeId 分组、逐组校验、共用 `planAllocation` 口径；建议**逐员工独立事务**（放弃整批原子，与"跳过冲突"语义一致） |
| 修 `allocateAssets:133` | 去掉 `id: { notIn: assetIds }`，补批内自冲突校验 |
| 修 `transferAssets:333` | 同上 |
| 保留 `allocateAssets` | 单台分配与既有测试仍走它（`tests/lifecycle.test.ts`、`allocate-return-name.test.ts`） |

系统日志：多员工提交按员工各记一条（语义清晰，比"20 台统一一条"可追溯）。

### 4.4 选人控件：`src/components/ui/employee-picker.tsx`（新增）

```
mode: "single" | "multiple"
employees: { id, name, employeeNo, departmentId, departmentName }[]
departments: { id, name }[]
value / onValueChange
```

内部结构：部门 `SearchableSelect`（复用现有） + 关键字 `Input` + 复选列表 + 已选 chips + 「全选当前结果」。
铺开 6 处替换点见 §5。

> 注意：`page.tsx` 目前只向下传 `{ id, name, departmentName }`，**缺少 `employeeNo` 与 `departmentId`**（排序键与显示都需要）→ 需一并补齐。

### 4.5 其余 5 处选人点

单台分配 / 单台调拨 / 批量调拨 / 详情页调拨（`[id]/asset-detail-client.tsx:518`）/ 标签打印选员工（`settings/labels/labels-client.tsx:376`）→ 统一换成 `mode="single"` 的 EmployeePicker，获得部门筛选 + 关键字，**其余行为不变**。

## 五、分批交付

### 批次 1 —— 止血（低风险，当天可验收）

1. `asset-list-client.tsx:486` 分配入口放开 `IN_STOCK`（**问题 ① 的直接修复**）。
2. 新增 `EmployeePicker`（单选模式）并铺到 6 处。
3. 分配/调拨族弹窗版式统一（宽度、上下文条、头部范式、footer 去横线）。

### 批次 2 —— 核心

4. `src/lib/allocation.ts` 分配算法 + `planAllocation`。
5. `precheckAllocation` / `allocateAssetsToEmployees` 两个 action，规则与前端共用。
6. 批量分配弹窗重做（员工多选 + 分配预览 + 冲突标记 + 「分配可用的 X 台」）。
7. 修 `allocateAssets` / `transferAssets` 的 `notIn` 漏洞（补批内自冲突校验）。

## 六、涉及文件

| 文件 | 批次 | 改动 |
|---|---|---|
| `src/app/(main)/assets/asset-list-client.tsx` | 1、2 | 入口条件、6 处选人替换、批量分配弹窗重做、版式 |
| `src/app/(main)/assets/page.tsx` | 1 | 补传 `employeeNo` / `departmentId` |
| `src/components/ui/employee-picker.tsx` | 1 | **新增** |
| `src/app/(main)/assets/[id]/asset-detail-client.tsx` | 1 | 调拨选人替换 |
| `src/app/(main)/settings/labels/labels-client.tsx` | 1 | 选员工替换 |
| `src/lib/allocation.ts` | 2 | **新增**（规则单一真相源） |
| `src/actions/lifecycle.actions.ts` | 2 | 2 个新 action + 2 处 `notIn` 修复 |

（`src/components/ui/dialog.tsx` 明确**不改**。）

## 七、测试计划（三层）

| 层 | 文件（拟） | 覆盖 |
|---|---|---|
| 纯函数 | `tests/allocation-plan.test.ts` | 均分与余数前置、排序键（编号自然序 / 部门→工号）、唯一分类配额封顶、历史占用作废、就地跳过不顺延、人数 > 台数 |
| 服务端 | `tests/allocation-actions.test.ts`（走隔离测试库） | `precheckAllocation` 判定正确、`allocateAssetsToEmployees` 只落可行子集、**批内自冲突现在被拦截**（回归 2.2）、状态冲突、日志条数 |
| 组件 | `tests/employee-picker.test.tsx`（jsdom） | 部门筛选、关键字搜索、全选当前结果、多选回传、单选回传、已选 chip 移除 |

回归关注：`tests/lifecycle.test.ts`、`tests/allocate-return-name.test.ts`、`tests/batch-stock-in.test.ts`、`tests/searchable-select.test.tsx`、`tests/searchable-select-width.test.tsx`。

## 八、风险与验收点

1. **规则副本风险**（本方案的立项理由之一）：`planAllocation` 必须是唯一规则实现，前端预览与服务端校验只允许通过它判断，禁止在组件里重新写一遍 if。
2. **行为回退需知会**：决策 10 生效后，「一人多台唯一分类设备」永久不可行 —— 这是修正缺陷，但**已有数据可能已存在此种违规记录**（历史通过漏洞写入的），需先查一次真实库确认影响面，必要时清理。
3. **不重平衡的体感**：均值分配 + 唯一分类封顶后，实际可分配台数常低于选中台数。必须靠「分配预览 + 冲突明细」把原因讲透，否则会被误解为"分配坏了"。
4. 无 schema 变更 → 无迁移风险；测试仍走 `asset-manage-test@3306`，涉 DB 脚本必须过 `tests/db-guard.ts` 闸门。

---

## 九、批次 1 交付记录（2026-10-12 完成）

### 9.1 交付内容

| 文件 | 改动 |
|---|---|
| `src/lib/asset-action-availability.ts` | **新增**。`getAvailableActions(status)` 取代原先散落的 5 个 `status === "X"` 判断；`IN_STOCK` 与 `IDLE` 一致地提供「分配」。未知状态 fail-closed |
| `src/lib/asset-selection-summary.ts` | **新增**。`summarizeSelection()` 产出「台数 / 分类 / 编号区间」，编号按自然序 |
| `src/lib/allocation-rule-text.ts` | **新增**。`describeAllocationRule()` 输出「XX 为「唯一」分类：每人仅限一台」 |
| `src/components/ui/employee-picker.tsx` | **新增**。统一选人控件：关键字（姓名/工号/部门）+ 部门 chip 筛选 + `excludeIds`。部门列表由 employees 推导，不收 departments prop |
| `src/components/features/selection-context-bar.tsx` | **新增**。弹窗顶部「设备上下文条」 |
| `src/app/(main)/assets/asset-list-client.tsx` | 4 处选人替换、2 处单台 + 2 处批量弹窗加上下文条与统一版式、行菜单改由 `getAvailableActions` 驱动 |
| `src/app/(main)/assets/page.tsx` | 补传 `employeeNo` / `departmentId` |
| `src/app/(main)/assets/[id]/asset-detail-client.tsx` / `page.tsx` | 调拨选人替换 + 上下文条 + 分类规则 |
| `src/app/(main)/settings/labels/labels-client.tsx` / `page.tsx` | 选员工替换 |

### 9.2 为什么部门筛选没用嵌套下拉

`SearchableSelect` 是 Radix Popover。把它嵌进另一个 Popover 时，内层内容 portal 到 body，会被外层判为「外部点击」而关掉弹窗。因此部门筛选改用 **chip 单行横向滚动 + 关键字（同时匹配部门名）**，零嵌套风险，且「按部门批量选人」只需一次点击。

### 9.3 验证证据

- 全量测试 **60 文件 / 482 用例全绿**（新增 33 个：`asset-action-availability` 7、`asset-row-actions` 5、`employee-picker` 11、`asset-selection-summary` 7、`allocation-rule-text` 3）。
- `tsc --noEmit` 无错误；`npm run build` 成功（所有路由 `ƒ` 动态渲染）。
- 问题① 有**端到端测试锚点**：库存态设备行菜单里必须出现「分配」，且已报废设备菜单里一个操作项都没有。

### 9.4 附带修复：本机数据库枚举漂移（与本次需求无关，但会挡住验证）

| 库 | 位置 | 修正前 | 处理 |
|---|---|---|---|
| `asset-manage`（生产） | 3308 | ✅ 有 `IN_STOCK` | 未动 |
| `asset-manage-test` | 3306 | ❌ 缺 `IN_STOCK`、多了 `RESERVED` | **DROP + 按仓库迁移重建** |
| `asset-manage-dev` | 3306 | ❌ 同上（144 台设备） | 非破坏性 `ALTER` 修 4 列 |
| `asset-manage-verify` | 3306 | ❌ 同上（135 台） | 同上 |
| `asset-manage`（本机旧库） | 3306 | ❌ 同上（137 台） | 同上 |

- 修的 4 列：`Asset.status`、`LifecycleLog.fromStatus`、`LifecycleLog.toStatus`、`StocktakeRecord.expectedStatus`（分配时会写 `fromStatus='IN_STOCK'`，只修 Asset 不够）。三库 `RESERVED` 行数均为 **0**，`ALTER` 后设备数与状态分布完全一致（144/135/137，0 行异常）。
- **根因**：本机 MySQL 被**项目的另一条分支**用过 —— 那几个库的 `_prisma_migrations` 有 **31 条**记录（含 `20260925020000_remove_in_stock_status`），而当前工作区仓库只有 **5 条**迁移。那条线把 `IN_STOCK` 换成了 `RESERVED` 并实现了审批流（m1–m10）。
- ⚠️ **共享同一份本机 MySQL 时要注意**：若在另一份更新的 checkout 里跑 `prisma db push` / `migrate dev`，会把 `IN_STOCK` 再次移出枚举，本次修复即失效。

### 9.5 批次 1 未覆盖（已于批次 2 完成，见 §十）

- `EmployeePicker` 的**多选模式**（批量分配的多选员工、均值分配、分配预览）。
- `precheckAllocation` / `allocateAssetsToEmployees` 两个 action + `src/lib/allocation.ts`。
- `allocateAssets` / `transferAssets` 的 `notIn` 漏洞（批量分配时唯一规则失效）。
- 批量分配弹窗的双栏（员工多选 + 分配预览）与「分配可用的 X 台」。

---

## 十、批次 2 交付记录（2026-10-12 完成）

### 10.1 交付内容

| 文件 | 改动 |
|---|---|
| `src/lib/allocation.ts` | **新增**。`planAllocation` 纯函数 —— 分配规则唯一真相源，前端预览与服务端复核共用 |
| `src/actions/lifecycle.actions.ts` | 修 `allocateAssets` / `transferAssets` 的**批内自冲突**；新增 `allocateAssetsToEmployees` |
| `src/components/ui/employee-picker.tsx` | 新增 `mode="multiple"` 内联多选面板（部门筛选 + 关键字 + 全选当前结果 + 已选 chips）；单选/多选共用同一份过滤逻辑 |
| `src/components/features/allocation-preview.tsx` | **新增**。分配预览（谁拿几台 / 冲突几台 / 按原因归并的明细）+ `buildAllocateSubmitLabel` |
| `src/app/(main)/assets/batch-allocate-dialog.tsx` | **新增**。双栏批量分配弹窗（左多选员工 / 右分配预览），从 `asset-list-client.tsx` 抽出以便测试 |
| `src/app/(main)/assets/asset-list-client.tsx` | 批量分配改为调用新组件；员工选择状态与预览计算移出；补 `employeeOwnedUniqueCategories` 映射 |

### 10.2 `planAllocation` 的实际算法（与 §3.1 的对应）

1. **状态剔除**：不是 `IDLE` / `IN_STOCK` 的设备先摘出来单独判冲突，**不占用配额槽位**（本来就给不了任何人，不该浪费位置）。
2. **按分类分组**，每组独立算配额：`base = ⌊N/M⌋`，前 `N % M` 人各多拿 1 台（余数前置）。
3. **唯一分类**下配额封顶 1；再把「已持有该分类」的员工的槽位**标记为无效但保留站位**。
4. 按槽位序列逐台配对：槽位无效 → 该台判冲突；没有槽位 → 判「名额不足」。**都不顺延给下一个人**。

第 3 步「保留站位」是 §3.1 能成立的关键：槽位按员工顺序连续排列，无效槽位留下的空洞不会被后面的人填上，所以「张三那台」确实是冲突而不是转给李四。

### 10.3 与方案的一处偏差（有意为之）

原计划（§4.3）新增 `precheckAllocation` action 做预校验，**实际没有加**：

- `assets/page.tsx` 已经把**全量**设备（含 `categoryId` / `status` / `employeeId`）和带 `unique` 的分类传给列表页，前端用同一个 `planAllocation` 本地算即可，结果与服务端逐字一致，且避免每次改动选人都走一次网络往返（预览要求「实时联动」）。
- 服务端正确性由 `allocateAssetsToEmployees` 内部**再次调用 `planAllocation`** 保证 —— 规则仍然只有一份实现，不存在「前端说了能分、后端说不能」的口径分裂。
- 少一个 action、少一条数据通路。并发场景（预览时别人抢先分配）由提交时的状态复核兜住，逐台回报为 `skipped`。

### 10.4 两条 `notIn` 漏洞的修法

**没有直接删掉 `notIn`** —— 那样会把「更新后本批已属于该员工」算进来，导致**每次分配都判违规**。正确做法是保留 `notIn`（排除自身）**外加**一层显式批内计数：

```ts
// 批内自冲突：同批里 2 台以上同唯一分类设备 → 必然违规
const batchCountByCategory = new Map<number, number>();
for (const a of assets) {
  const catId = templateToCategory.get(a.templateId);
  if (catId === undefined || !uniqueCategoryIds.has(catId)) continue;
  batchCountByCategory.set(catId, (batchCountByCategory.get(catId) ?? 0) + 1);
}
if ([...batchCountByCategory.values()].some((n) => n > 1)) {
  throw new Error(`UNIQUE_VIOLATION:${names}`);
}
```

`allocateAssets`（单员工批量）与 `transferAssets`（批量调拨）各一份，行为一致。

### 10.5 验证证据

- 新增测试 **29 个**：`allocation-plan`(8)、`employee-picker-multi`(7)、`allocation-actions`(6)、`allocation-preview`(5)、`batch-allocate-dialog`(3)。
- 其中两条是**缺陷回归锚点**：「唯一分类下把两台设备批量分配给同一员工会被拦截」「唯一分类下把两台设备批量调拨给同一员工会被拦截」—— 修之前这两条都是失败的（返回 `true`）。
- `batch-allocate-dialog` 是端到端锚点：多选员工 → 预览「可分配 2 台 / 冲突 1 台」→ 点击「分配可用的 2 台」→ 断言提交的 `assignments` 恰好是 `[DN-0001→李四, DN-0002→王五]`；以及「李四已持有笔记本」时只提交 1 台且**不顺延**。
- **全量测试 65 文件 / 511 用例全绿**（批次 1 的 60/482 之上净增 5 文件 / 29 用例）。
- `tsc --noEmit` 无错误；`npm run build` 成功（所有业务路由均动态渲染）。
- 未改 schema → 三个库都无需 migrate。

### 10.6 遗留

- **存量违规数据**：补上批内校验前，通过漏洞写进去的「一人多台唯一分类设备」记录不会被自动清理。需要时用只读查询统计影响面后再决定是否处理。
- 批量调拨保持单选（决策 14），只换了带部门搜索的选人控件。


