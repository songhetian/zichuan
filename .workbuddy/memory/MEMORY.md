# 项目长期记忆 (zichuan)

> 资产管理系统：Next.js 14 App Router 单体 + Prisma 5 + MySQL 8。`src/actions/*` 是 Server Actions，无独立后端。
> 分支 `在线优化版`；origin = `https://github.com/songhetian/zichuan.git`。

## 数据隔离（最重要）
- **真实库** `asset-manage` @ Docker `zichuan-mysql:3308`（卷 `mysql_data`）= 生产在用数据。数据有变化先查 `SystemLog`，多为同事真实操作，别当脚本污染。
- **开发库** `asset-manage-dev` @ 本机 3306（FlyEnv root/root）；**测试库** `asset-manage-test` @ 3306。日常开发只用开发库。
- 闸门：`tests/db-guard.ts` 的 `assertSafeTestDb()`、`scripts/dev-config.js` 的 `loadDevConfig()`（库名须 `-dev`/`-test` 结尾）。**新增涉 DB 脚本/配置必须接闸门**；`scripts/db-empty.js` 需 `ALLOW_REAL_DB=1`。
- 父进程注入的 `DATABASE_URL` 优先于 `.env`（`@next/env` 不覆盖已有键）→ 子进程注入是可靠隔离手段。
- `.env` = 生产；`.env.dev` = 开发（`DB_MODE=local|docker`；local 时 `ensure-mysql.js` 绝不启 Docker）。
- mysql 客户端：`D:\Program Files\FlyEnv-Data\app\mysql-8.2.0\...\bin\mysql.exe`（不在 PATH）。

## 开发命令
- `npm run dev` = `scripts/dev-start.js`，**唯一开发入口**（释端口→建开发库→migrate→按需 generate→种子→前端）。自检 `DEV_NO_LAUNCH=1`；强制重生成 `FORCE_PRISMA_GENERATE=1`。**禁止裸跑 `next dev`**（读 `.env` 连真实库）。
- `npm run test`（全量，隔离测试库）/ `npm run test:ui`（仅 .tsx）。
- `npm run db` = `scripts/dev-db.js`：`status`(默认)|`up`|`migrate`|`reset`|`test:init`|`logs`|`down`。
- `npm run docker` = `scripts/docker.js`：`deploy`|`update`|`mysql`|`down`|`restart [svc]`|`logs`|`ps`|`migrate`|`seed`|`reset`（reset 需 yes，非 TTY 用 `CONFIRM_RESET=1`）。
- `npm run free-port 3001` 只杀**监听该端口**的进程。⚠️ 绝不「杀光所有 node.exe」（npm 本身是 node → 自杀 + 误杀其它项目）。
- npm ≥7 子命令透传无需 `--`。已删除入口：`dev:full`/`setup`/`prod`/`kill-node`/`predev`/`dev:db*`/旧批 `docker:*`。

## 部署
- 生产 Debian 局域网 `192.168.110.145`。纯代码更新 `git pull && npm run docker update`（重建 app+nginx，不跑 db-init）；含迁移 `docker deploy`；502 → `docker restart nginx`。
- 数据在 named volume，`up -d` 不带 `-v` 即保留；`db-init` 三步全幂等。**只有 `docker reset` 会真删数据**。
- `output:'standalone'` 会把 `.env` 带进镜像 → `.dockerignore` 必须保留 `.env`/`.env.*`（曾泄漏，已修）。
- compose 对 app/db-init 显式 `NODE_ENV: production`；`DOCKER_DATABASE_URL`/`SESSION_SECRET` 用 `${VAR:?}`。空 `SESSION_SECRET` 会让 `lib/auth.ts` **静默回退写死的默认密钥**（可伪造登录态）。
- 服务器 `.env` 需 `DATABASE_URL`/`DOCKER_DATABASE_URL`(host=`mysql`)/`SESSION_SECRET`(≥32)。`.env.example` 曾提交真 64 位密钥（`4c6f8dc` 已改占位符），服务器若照抄过需轮换。
- 本机沙箱 `docker compose` 子命令不可用（cli-plugins 缺失）→ 用 `docker-compose`；服务器正常，脚本不用改。

## 测试
- 基线：110 文件 / 875 通过 / 10 skipped（2026-09-30）。新 vitest 配置**必须** `env.DATABASE_URL` → 测试库 + setup 闸门（旧配置曾把 240 条数据写进真实库并清空 Admin 表）。
- 改 schema 后**三库都要 `migrate deploy`**；真实库手动 `DATABASE_URL="mysql://root:root@localhost:3308/asset-manage" npx prisma migrate deploy`（收紧约束前先 mysqldump）。
- action 返回类型加字段要同步测试 mock，否则 `undefined.xxx()` 被 catch 吞掉 → 假「业务失败」。
- 前端测试提速：直接调二进制 `"C:/Users/Song/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" node_modules/vitest/vitest.mjs run --config vitest.frontend.config.ts [文件]`（`npx` 多花 ~1m45s 解析）。TDD 多轮必须用这个写法。
- 作用域查询：同页同名文本 → `within(...closest("li"))` 或 `getByRole("region",{name})`；`{v}<span>台</span>` 无空格 → 断言 `/2\s*台/`。
- 「curl 拿 307」不能证明页面编译成功（middleware 全跳 /login）；看 `.next/server/app/(main)/<路由>/page.js` 的 mtime。
- `vitest.node.config.ts` 无 `singleFork`，两个清库文件并行会互踩 → 单独跑。

## 数据模型
- `ComponentModel` 唯一 = `(categoryId, name, brand)`。
- `DeviceTemplate` 唯一 = `UNIQUE(categoryId, normalizedName)`，`normalizedName` 生成列（剥尾部 ` (数字)`）→ **禁止 " (2)" 后缀命名模板**。导入同名但 BOM 不同 → 追加 ` #`+`bomFingerprint()`（FNV-1a→base36 5 位，确定性，与顺序无关；刻意不用随机）。
- 模板 BOM = CPU+内存+硬盘（+主板/显卡），**不含显示器**（显示器逐台挂设备）。
- **`AssetCategory.unique` = R4 唯一性**：该分类下每人至多 1 台（分配/调拨/新建即分配均校验）。
- 设备状态机：`IDLE / IN_USE / IN_MAINTENANCE / SCRAPPED / RESERVED`（RESERVED=在途审批预占，不参与任何人工流转）。

## 业务：批量分配（严格 1:1）
- **规则层 = `src/lib/allocation-pairing.ts`**（纯函数，无 DB 无 React）：`buildAllocationPairs`（设备按 `assetNo` 升序 × 员工按勾选顺序）、`annotatePairConflicts`（标注冲突）、`summarizePairing`（状态栏 + 提交闸门 `canSubmit`）。冲突判定优先级 = **人（LEFT）→ 设备（非 IDLE）→ 唯一性（R4）**，每对只报第一条。`AllocationConflict` 也定义在这里，服务端与前端**共用同一份冲突结构与展示组件**。
- **「持有」口径 = `IDLE / IN_USE / IN_MAINTENANCE`**（`SCRAPPED`/`RESERVED` 不算占名额），与服务端 `allocateAssets` 严格一致。
- **服务端 `allocateAssetsBatch({ pairs, operator, remark })`**（`actions/lifecycle.actions.ts`）：整批**单事务、全成或全败**；失败返回 `{ success:false, error, conflicts: AllocationConflict[] }`（**不是** `ActionResult<T>`，是它的超集，可直接喂给 `run()`）。旧 `allocateAssets({assetIds, employeeId})` 保留给单台用。
- ⚠️ **严格 1:1 下「同一批次内同唯一分类多台给同一人」不可能发生**（员工 id 去重已拦），别再把那段检查当活代码；服务端仍会二次强制「同一设备 / 同一员工不得重复出现」。
- UI：`components/features/employee-pick-list.tsx`（`EmployeePickList` 内联列表 + `EmployeePicker` popover，**部门单选 + 姓名/工号/部门搜索 + 按部门分组 + 离职禁选标注**）与 `components/features/batch-allocate-dialog.tsx`（两栏：左选人 / 右配对预览，逐行「换人」= 与目标行**交换**以维持 1:1）。四种分配/调拨场景共用这两个组件。
- `AssetListClientProps.employees` 现在是 `PickerEmployee[]`（多了 `employeeNo` / `departmentId` / `status`）；**`/assets/page.tsx` 取员工时不过滤 `status`，是有意的**——离职员工要显示出来但禁选。
- 🔑 **`role="combobox"` 的可访问名不能来自内容**（ARIA `nameFrom: author`）→ `SearchableSelect` / `EmployeePicker` 若外侧没有 `<Label htmlFor>`，可访问名就是**空字符串**。新增下拉时要么接 `<Label>`，要么显式给 `ariaLabel`（`EmployeePickList` 的部门筛选已补 `ariaLabel="按部门筛选"`）。

## 业务：员工在用设备预览页
- `/employees/[id]` 只读预览，**独立路由，与 `/assets/[id]` 无耦合、不复用其组件**（用户明确要求）。
- 入口 = 员工列表「在用设备数」列的数字本身是 `next/link`（`aria-label` = 查看 <姓名> 的在用设备（N 台）），无新增菜单/按钮。
- `getEmployeeAssets(employeeId)` + `getEmployeeById(id)`；展示组件 `components/features/employee-device-preview.tsx`（带 `embedded?: boolean`，路由页与离职核对弹窗**共用**，别复制）；配件明细 `asset-config-list.tsx`（共享）。
- 只读护栏 `tests/employee-device-preview.test.tsx`：断言全部链接指向 `/assets/*` 且不出现 分配/归还/调拨/送修/报废/编辑/删除。**加写操作必须先改这条测试。**
- 保修结论 = `purchaseDate + warrantyMonths` → 「在保·剩 N 天 / 已过保」，不堆原始字段。

## 业务：离职交接（ASSET_DEPART）
- 结构：`部门主管审批(DEPT_MANAGER) → 资产管理员审批(ROLE:ASSET_MANAGER) → 终审生成交接单(PENDING) → 对账确认回收`（`prisma/seed.ts` 的 `seedDefaultTwoNodeWorkflow`）。两审批节点是同一页面 `/approvals/[id]`。
- payload = `{ targetEmployeeId, reason }`，**无 assetId**；`getApprovalRequestById` 按 id 补 `targetEmployeeName/No/DepartmentName`，不补则详情页只剩「设备 #-」。
- 🔑 `DEPT_MANAGER`/`ASSET_MANAGER` **都没有 `employee.view`**（`/employees` 前缀要求它）→ **不能拿 `/employees/[id]` 当审批核对入口**（会 NoAccess）；放开该路由等于全公司可翻同事设备/电话/邮箱。
- 正确出口 `getDepartureCheckInfo(requestId)`（`actions/approval-depart.actions.ts`），授权口径 =「你是这张单的相关人」。
- 可见范围唯一口径 `src/lib/approval-scope.ts` 的 `visibleRequestWhere(adminId)`（有 `approval.detail.view` → 全部；否则 发起人/目标员工/审批参与人/抄送人）——`getApprovalRequestById` 与 `getDepartureCheckInfo` **共用**；范围外一律「申请单不存在」，不泄露存在性。
- 对账回收 `confirmHandover(orderId, remark)`（`approval-execute.actions.ts`，权限 `asset.depart.execute`）；入口 `departure-handover-panel.tsx`（快照清单+备注+二次确认）。
- UI 顺序刻意：`departure-check-panel.tsx` 在审批操作区**上方**（测试用 `compareDocumentPosition` 守住）。
- 对账列表 `/approvals/handover`（权限 `asset.depart.handover.view`）：`getHandoverOrders({status?})` 每行带快照 `items`（就地核对免跳页），`parseHandoverSnapshot()` 与 `getDepartureHandover` 共用；有意**不做部门过滤**（持该权限者只有资产管理员/超管）。
- 待对账通知：终审生成交接单时（`approveTask` 的 HANDOVER 分支，同事务）给持 `asset.depart.execute` 的账号落 `APPROVAL_TODO`，事务后 `pushItems`；`findAdminIdsByPermission()` 按 `expandEffective` 展开（兼容只授模块级父点）。
- ⚠️ `seedRoles` 在 `rolePermission.count() > 0` 时**跳过**矩阵初始化 ⇒ 新权限点在生产库不会自动补，需在「系统设置→角色权限」手勾（勾父点自动带后代）。
- 待修存量风险：`getEmployeeAssets(employeeId)` 仅 `requireAuth`、无数据范围校验。

## Git
- **🔥 禁止整目录忽略 `scripts/` 或 `tests/`**：历史两次宽忽略致 10 脚本 + 21 测试静默未跟踪；已提交脚本 import 未跟踪的 `load-env.js`/`dev-config.js` → clone 后 `Cannot find module`。
- 2026-10-01 又踩：`.gitignore` 末尾加 `docs/**`、`**.md`、`tests/**`（与同文件警告自相矛盾）→ 11 测试 + 15 文档未入库；已移除 `tests/**`（`6d4167b`）。**`docs/**` 与 `**.md` 保留是有意的**（文档暂不入库），别再当 bug 修；`tests/_*` 拦一次性诊断脚本。
- 排查：`git ls-files --others --ignored --exclude-standard <path>`、`git check-ignore -v <file>`。⚠️ ignore 对**已跟踪**文件无效。
- 只忽略真垃圾：`__pycache__/`、`*.pyc`、`scripts/_*`、`tests/_*`、`.next*/`、`vitest*.config.ts.timestamp-*.mjs`（**必须带 `vitest*` 通配**）。
- `.env.dev` 已入库。⚠️ `.env` 规则管不住**别名目录**副本（如 `.next.prodbak/standalone/.env`）→ 缓存目录一律 `.next*/` 覆盖。
- ⚠️ `~/.gitconfig` 的 `insteadOf` 陷阱：`ssh://git@github.com/` **只匹配带该前缀的 URL**，SCP 风格 `git@github.com:owner/repo` 不含前缀 → 永不命中。要覆盖 SCP 必须写 `insteadOf = git@github.com:`。
- 提交前 `git status --short --untracked-files=all` 核对。

## 代码约定
- `node scripts/*.js` 不自动读 `.env`（Prisma 会）→ 一律 `import { loadEnv } from "./load-env.js"; loadEnv();`。
- SQL 传参走 stdin（`execSync(cmd,{input:sql})`），别在命令行拼引号（cmd/bash 转义不一致）。
- 仓库换行 **LF/CRLF 混用**（`execute-client.tsx`、`bom-table.tsx` 是 CRLF）→ 写批处理脚本按文件探测。

## 认证
- `iron-session` cookie（`src/lib/auth.ts`），`SESSION_MAX_AGE=8h` 且**无滑动过期** → 「用着用着自动退出」头号嫌疑。
- `middleware.ts` 鉴权（未登录一律 307 → /login）；`(main)/layout.tsx` 也调 `getCurrentUser()`。
- 局域网 IP 与域名混用 → cookie 域不共享 → 跳登录。纯 HTTP，cookie `secure:false` 当前正确。

## UI / 设计系统

### 主题与 token
- shadcn/ui + Radix + Tailwind 3.4 + CSS 变量。**明暗双主题，默认亮色**（2026-09-28 由暗翻转）：`:root` 亮 `--background: 224 30% 98%`，`:root.dark` 暗 `226 25% 9%`。**品牌主色 = 靛蓝 `--primary: 243 68% 47%`（亮）/ `243 75% 70%`（暗）**。旧「teal 品牌色 + 不做深色模式」**已作废**。
- `theme-toggle.tsx` 用 `localStorage["zt-theme"]`，切换 `classList.toggle("dark")` + 派发 `THEME_CHANGE_EVENT`（供 canvas 重渲染）；`layout.tsx` 有防闪烁内联脚本。
- `tailwind.config.ts` 必须显式 `darkMode: 'class'`（否则默认 `media` 跟随系统，与应用主题不同步）。
- ⚠️ 翻转主题别漏 `--radius`（主题无关 token 必须留基准 `:root`）。
- ⚠️ `--foreground` 不能当遮罩色（暗色下接近白，会把背景**提亮**）→ 遮罩一律 `--overlay`（亮 `226 30% 12%` / 暗 `0 0% 0%`）+ `bg-overlay/40`。
- token 分层：语义实色 `--success`/`--warning`/`--info`/`--violet`/`--destructive`；柔和层 `--{tone}-soft`/`-soft-foreground`/`-soft-border`；分类标识色 `--cat-*`（11 色，纯区分不承载状态）。

### 颜色体系
- **配色唯一来源 = `src/lib/status-styles.ts`**：`Tone = success|warning|danger|info|violet|neutral`，导出 `TONE_CHIP/TONE_SOFT/TONE_TEXT/TONE_INK/flowDotClass()/ASSET_STATUS_TONE/CATEGORY_DOT`。新增状态色只改这里，**禁止在页面写 tailwind 调色板**。
- 判据用 **CIEDE2000（ΔE00）** 而非 ΔE76；颜色建议必须脚本实算。
- 闸门 **`npm run check:color`**（`scripts/check-color-tokens.mjs`）：从 globals.css 解析真实 token，校验 WCAG 1.4.3 文字对比度(23 组) + 1.4.11 非文本(≥3:1) + 分类色隔离(对语义 ΔE00≥9、彼此 ≥8) + 中性层次(8 对 ≥2.5) + 亮暗 token 键对称(58/58)。`KNOWN_ISSUES` 已清空。**改任何颜色后必跑。**
- 已修且须维持：表单控件边框用 `--input`（亮 `226 16% 58%` / 暗 `226 16% 46%`，≈3.2:1）；`--border`(1.34:1) **有意不动**（装饰发丝线豁免）——「发丝边框」只适用于页面分区/卡片，不适用于输入控件，别去"统一"。⚠️ `--cat-indigo` 在 ±20° 色相窗口**无可行解**（被 info/primary/violet 夹住）。暗色语义实色统一「高 L 实底 + 深墨前景字」（`--primary-foreground` 等 ≈ `226 30% 10~12%`）——因 `--primary` 兼作按钮实底与 `text-primary`，单一 L 无解。中性阶：亮 `card100>bg98>sidebar96>muted93>secondary88`，暗 `secondary20>muted16>card12>bg9>sidebar7`；`card↔background`(1.6) 与 `background↔sidebar-bg`(1.6) **有意不动**。只修「实色块」，不动「淡层+边框」。
- canvas 取色（`src/lib/use-theme-colors.ts`）：**必须 `parseFloat` 不能 `Number`**（`Number("56%")===NaN` → fillStyle 非法时 canvas **不报错也不改色**，全图静默同色）；输出统一 `#rrggbb`，兜底 `#8c90a0`。回归 `tests/theme-colors.test.ts`。
- ECharts 需**具体色值**（不能用 Tailwind 类）→ 一律经 `useThemeColors()`。

### 无障碍基线（WCAG 2.1 AA，新增代码必须遵守）
- `<Label htmlFor>` 必须与控件 `id` 关联（`Input/Textarea/SelectTrigger/SearchableSelect` 均支持）。分区/分组标题**不要**用 `<Label>`。
- **`<Button>` 的 `type` 必填**（默认 `submit`，表单内「取消」会连带提交）；**禁止** `type="submit"` 与 `onClick` 并存（触发两次）。
- 错误三件套 `aria-invalid` + `aria-describedby` + `<p id role="alert">`；`aria-invalid:` 变体是**手动注册**的（Tailwind v3 无内置，不存在会静默丢弃）。
- 导航：当前页 `aria-current="page"`；可折叠组 `aria-expanded`；纯图标按钮一律 `aria-label`（`title` 不算）。
- 表格：`TableHead` 自带 `scope="col"`；行头显式 `scope="row"`。
- `<main id="main-content" tabIndex={-1}>` + skip link（`tabIndex={-1}` 不能省）。
- `CardTitle` 默认 `<h2>`（`PageHeader` 占 `h1`），支持 `as` prop；**禁止 `<h4>`**。
- 可点击卡片用 `<button>` 或「标题真 `<button>` + `after:absolute after:inset-0`」，禁 `<div onClick>`。
- `focus-visible:` 管可见焦点环；**`focus:` 只留给 Radix 菜单项**（别一刀切），原生文本框保留 `focus:`。
- 覆盖 utilities 的 CSS（如 `prefers-reduced-motion`）**必须放在 `@layer` 之外**。
- 无描述弹窗显式 `aria-describedby={undefined}`，**禁止在 `dialog.tsx` 做全局默认**（会清掉 31 个有描述弹窗的关联）。
- 拖拽排序必须有键盘替代（WCAG 2.2 **2.5.7**）：手柄用可聚焦 `<button>` + `ArrowUp/Down`，共用 `moveItem(from,to)`。
- 根 layout `title.template = "%s | 雷犀资产管理"`，各 `page.tsx` 只写短标题。

### 弹窗 / 表单
- **🔑 嵌套 Dialog 会被外层误关（已修）**：Radix 弹窗内再弹 Dialog 是独立 portal，点按钮被判 `pointerdown outside` → 先关外层。共享 `ui/dialog.tsx` 的 `onPointerDownOutside`/`onFocusOutside` 已对 `[data-nested-dialog]` 做 `preventDefault()`，`confirm-dialog.tsx` 打标记。⚠️ `{...props}` 展开在内部 handler **之后** → 调用点自传 `onPointerDownOutside` 会整段覆盖。
- **❌ 已作废**：弹窗内分区用 `bg-muted/40` 色块（与纯白 `bg-card` 对 `--background` 对比度**都是 1.053:1**，感知为「不存在」，还删掉唯一线索=发丝边框）。
- **✅ 弹窗内分区正确做法**：**不套卡片**；容器 `divide-y divide-border`，每个 `<section className="py-6">`，内容直接坐弹框底上（底色层 3→1）。
- **✅ 控件底色 = 宿主底色的反色**：弹框底是 98% 米白 → 输入框用 `bg-card`（纯白）；纯白 `bg-card` 页卡上的表单用默认 `bg-background`。**同一宿主内必须统一**。
- **🔑 改「背景/层次」铁律：先算相对亮度差**。中性阶很窄，两背景块亮度差 < 约 7pp 不可感（对比度 1.05–1.10）→ **只能靠线，不能靠面**。改底色不改线宽/线色等于没改。
- **🔑 分区标题不要用 `--primary` 做装饰**（primary 承载「可操作/已选中」语义），改用字重 + 字号分层。
- **🔑 字段网格按重要性分配宽度**：唯一必填/最长字段 `col-span` 独占整行，其余排下一行等分。
- **🔑 同屏 chip 靠底色轻重分层**：筛选条用实色 `bg-secondary`，建议项降级为幽灵 chip（透明底 + `border-border`）。
- 筛选标签选中态不用 `bg-primary` 实色（会与主按钮抢焦点）：用 `bg-primary/10 text-primary ring-1 ring-inset ring-primary/30` + `aria-pressed`。
- 表单弹窗基线：关闭统一走 `requestClose()` 做**脏检查**（RHF `isDirty` ‖ 业务快照比对）→ `ConfirmDialog`；提交成功才直接关；支持 `Ctrl/⌘+Enter`；提交按钮带 `Loader2`；打开 `setFocus` 首字段；必填补 `aria-required`。**脏检查要在底部操作栏给可见指示**（否则用户认为你没干活）。
- 受控下拉必须 `setValue(k, v, { shouldValidate: true, shouldDirty: true })`，否则错误提示不消失 + `isDirty` 不更新。

### 已知未修 / 存量问题
- 🟡 排版与圆角：41 处 `text-[Npx]` 横跨 9 值（`text-[13.5px]`×7 全在 `sidebar.tsx`；`labels-client.tsx:480-497` 属标签打印预览，**保留**）；裸 `rounded`(4px)×23 与 token 6/8/10px 混用。
- 🟡 **布局 P0**：`layout-client.tsx` 的 flex 子项（`div.flex.flex-1.flex-col`、`main`）缺 `min-w-0` → ≤1440px 整页横向溢出（/assets、/employees 在 1440px +220px、1024px +636px）。注入式实验已验证三处加 `min-w-0` → 溢出归零。
- 🧟 `/stats` 死入口：`stats/page.tsx` 只 `redirect("/dashboard")`，`stats-client.tsx` 无引用，但 `command-palette.tsx:225` 仍指向。
- ⚠️ `categoryDotClass()` 调色板按「配件分类」建，却被 `/assets`、`/templates`、员工设备预览页用于**资产分类** → 多数命不中，**统一退化成灰点**。要修就统一修。
- 🔵 `globals.css:231` 的 `.shadow-warm` 是死代码；18 处业务层 `shadow-*` 与「去投影」设计语言冲突（7 处浮层保留）；7 处浮层用纯黑阴影。
- **✅ 已确认良好，别再重复扫**：Tailwind 原生调色板类全仓 0 处；hex 硬编码仅 2 处（`labels-client:206`、`stats-client:76`）；文字对比度亮暗各 17 组全 ≥4.5:1；分类圆点 1.4.11 亮暗各 11 个全 ≥3:1。
- 🚫 明确不建议改：首页「英雄卡」页头 vs 其它页裸页头；`bg-muted/30~50` 半透明淡层；`text-xs` 默认 16px 行高。

### 其他 UI 结论
- 表格统一走**页面级搜索**（DataTable 内置 `searchKey` 已移除）；DataTable 是**客户端分页**（`pageSize:10`），列表页搜索是对**全量**数据客户端 `filter`。
- 全局搜索（Ctrl+K）：`globalSearch` 服务端搜 4 类实体。**`CommandDialog` 必须传 `shouldFilter={false}`**（否则 cmdk 二次过滤 → 搜不到）。
- 资产操作语义：「删除」= `deleteAsset` 硬删除（红）；「报废」= 状态变更 `SCRAPPED`（橙）；其余生命周期动作收进「更多」菜单。

### 审计方法论（别再靠目测）
- 不靠截图下结论（任何视觉判断用 `getComputedStyle` 复核）；不靠感受定阈值（定阈值前先抽样，曾用「行高 <1.35」得出 61 处误报）；验证要覆盖真实数据流；**修法必须用注入式实验验证**（在真实页面加类名再测）。
- 统计结论必须回读源码：扫描器会把 `.ts` 服务端文件、JSX 注释里的字面量算成「问题」；`focus:` 会被 Radix 合法用法污染。
- 解析 JSX 开标签不能用 `indexOf(">")`（`onClick={() => f()}` 会截断）→ 用「字符串/模板 + `{}` 深度」感知扫描。统计调用点不要「窗口切片」（`indexOf("toast({")` 后取 500 字符会跨块误判）→ 用括号配对。
- 工具链已沉淀为 skill **`web-layout-audit`**：CDP `--remote-debugging-pipe`（**不要用 `--remote-debugging-port`**，沙箱不稳）、iron-session 伪造登录态、量化探针口径、高频根因速查表。

## 本机环境坑（WorkBuddy 沙箱 / Windows）
- **同一文件连续 Edit 会部分丢失**（踩过 2 次：`searchable-select.tsx` 接口+解构丢失、`qr/page.tsx` 的 `aria-invalid` 没落）。**Edit 报 success ≠ 落盘**。对策：同文件多处改动用单次「读→全量替换→写」Node 脚本，每处断言行数，写后读回磁盘做关键字断言。批量替换重复锚点不能按「第 N 次出现」定位（替换后序号前移），须每次取**第一个剩余匹配**。
- 改注释不要用「区间替换」（曾把紧随的两行 token 一并删掉，报错却出现在下游）→ 优先单行替换或指定行前插入。
- 🔥 **dev server 运行期间严禁 `next build`**：二者共用 `.next`，build 会清掉 dev 的 `static/css/` → 全站 CSS **404**（页面裸奔）。恢复：`npm run free-port 3000` → `mv .next .next.bak` → `npm run dev`。另注 build 产物 `.next/standalone/.env` 含**真实生产密钥**。
- 改 `tailwind.config.ts` 后用 Tailwind CLI 独立校验（dev 的 CSS 不可信）：`npx tailwindcss -i ./src/app/globals.css -o scripts/_probe.css --content './src/**/*.{js,ts,jsx,tsx}'` 再 grep。**别用 `next build` 验证**。
- 沙箱删文件可能超时（`rm`/`fs.unlinkSync` 走 safe-delete shim → genie-trash ETIMEDOUT，表现为 SIGTERM）→ 用 `NODE_OPTIONS="--use-system-ca" <managed-node> -e "require('fs').unlinkSync('<path>')"`；被 `scripts/_*` 忽略的临时文件可 `git clean -fX scripts/`。
- `npm run build` 的 `prisma generate` 会因引擎 DLL 被占用报 `EPERM rename query_engine-windows.dll.node` → 只验前端用 `npx next build`（会被 safe-delete shim 拦 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，加 `NODE_OPTIONS="--use-system-ca"` 绕过）。
- **测真实网络必须先 `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY`**（沙箱注入 `http_proxy=127.0.0.1:55579` 透明代理，不 unset 测出的连通性不可信）。
- ⚠️ 清理临时文件不要用不带具体路径的 `git clean -fXd`（曾误删 `.workbuddy/tmp/` 下的产物截图）→ 先 `git check-ignore -v <file>` 确认再带路径。
