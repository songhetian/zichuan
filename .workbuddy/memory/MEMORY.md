# zichuan 长期记忆

> 资产管理系统：Next.js 14 App Router 单体 + Prisma 5 + MySQL 8，`src/actions/*` 即后端（Server Actions）。
> 分支 `在线优化版`；origin `github.com/songhetian/zichuan.git`。细则见 `.workbuddy/memory/YYYY-MM-DD.md` 日志。

## 数据隔离（最重要）
- 真实库 `asset-manage` @ Docker `zichuan-mysql:3308`（卷 `mysql_data`）= 生产在用；数据有变化先查 `SystemLog`，多是同事真实操作，别当脚本污染。
- 开发库 `asset-manage-dev` / 测试库 `asset-manage-test` @ 本机 3306（FlyEnv root/root）；日常只用开发库。
- 闸门 `tests/db-guard.ts#assertSafeTestDb()`、`scripts/dev-config.js#loadDevConfig()`（库名须 `-dev`/`-test` 结尾）；**新增涉 DB 脚本/配置必须接闸门**；`scripts/db-empty.js` 需 `ALLOW_REAL_DB=1`。
- `.env`=生产、`.env.dev`=开发（`DB_MODE=local|docker`，local 时 `ensure-mysql.js` 绝不启 Docker）。父进程注入的 `DATABASE_URL` 优先于 `.env`。
- mysql 客户端不在 PATH：`D:\Program Files\FlyEnv-Data\app\mysql-8.2.0\...\bin\mysql.exe`。

## 命令 / 部署
- `npm run dev`（`scripts/dev-start.js`）**唯一开发入口**（释端口→建库→migrate→generate→种子→前端）。**禁止裸跑 `next dev`**（读 `.env` → 连真实库）。
- `npm run test`（全量/测试库）｜`test:ui`（仅 .tsx）｜`db <status|up|migrate|reset|test:init|logs|down>`｜`docker <deploy|update|mysql|down|restart|logs|ps|migrate|seed|reset>`（reset 非 TTY 用 `CONFIRM_RESET=1`）｜`check:color`。
- `npm run free-port 3001` 只杀监听该端口的进程；⚠️ 绝不「杀光所有 node.exe」（npm 本身是 node）。
- 生产 Debian `192.168.110.145`：纯代码 `git pull && npm run docker update`（重建 app+nginx，不跑 db-init）；含迁移 `docker deploy`；502 → `docker restart nginx`。数据在 named volume，`up -d` 不带 `-v` 即保留；**只有 `docker reset` 会真删数据**。
- `output:'standalone'` 会把 `.env` 带进镜像 → `.dockerignore` 必须保留 `.env`/`.env.*`（曾泄漏）。⚠️ 空 `SESSION_SECRET` → `lib/auth.ts` 静默回退写死默认密钥（可伪造登录态）；三项必填、密钥 ≥32。
- 本机沙箱 `docker compose` 子命令不可用 → 用 `docker-compose`；服务器正常，脚本不改。

## 测试
- 新 vitest 配置**必须** `env.DATABASE_URL` → 测试库 + setup 闸门（旧配置曾把 240 条写进真实库）。
- 改 schema 后**三库都要 `migrate deploy`**；测试库落后报 `table does not exist` 时：`DATABASE_URL="mysql://root:root@localhost:3306/asset-manage-test" node node_modules/prisma/build/index.js migrate deploy`（`npm run db test:init` 沙箱会 EBUSY）。
- 前端测试提速：`"C:/Users/Song/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" node_modules/vitest/vitest.mjs run --config vitest.frontend.config.ts [文件]`（别用 npx，多花 ~1m45s）。
- 🔑 状态更新排进微任务时（TanStack `resetPageIndex` 等）同步断言**假通过** → 断言前 `await act(async () => {})`。
- action 返回类型加字段要同步测试 mock，否则 `undefined.xxx()` 被 catch 吞 → 假「业务失败」。
- 作用域查询：同页同名文本用 `within(...closest("li"))`；`{v}<span>台</span>` 无空格 → 断言 `/2\s*台/`。
- 「curl 拿 307」不能证明页面编译成功（middleware 全跳 /login）→ 看 `.next/server/app/(main)/<路由>/page.js` mtime。
- `vitest.node.config.ts` 无 `singleFork`，两个清库文件并行互踩 → 单独跑。

## 数据模型
- `ComponentModel` 唯一 = `(categoryId, name, brand)`。
- `DeviceTemplate` 唯一 = `UNIQUE(categoryId, normalizedName)`；`normalizedName` 生成列剥尾部 ` (数字)` → **禁止 " (2)" 后缀命名模板**。导入同名但 BOM 不同 → 追加 ` #`+`bomFingerprint()`（FNV-1a→base36 5 位）。
- 模板 BOM = CPU+内存+硬盘（+主板/显卡），**不含显示器**。
- **`AssetCategory.unique` = R4 唯一性**：该分类下每人至多 1 台（分配/调拨/新建即分配均校验）。
- 状态机：`IDLE / IN_USE / IN_MAINTENANCE / SCRAPPED / RESERVED`（RESERVED = 在途审批预占，不参与人工流转）。

## 业务：批量分配（严格 1:1）
- 规则层 `src/lib/allocation-pairing.ts`（纯函数）：`buildAllocationPairs`（设备按 assetNo 升序 × 员工按勾选顺序）、`annotatePairConflicts`（冲突优先级 人→设备→唯一性，每对只报第一条）、`summarizePairing`；`AllocationConflict` 服务端/前端共用。
- 「持有」口径 = `IDLE / IN_USE / IN_MAINTENANCE`（SCRAPPED/RESERVED 不占名额）。
- 服务端 `allocateAssetsBatch({pairs, operator, remark})`：整批单事务、全成或全败，失败返回 `{success:false, error, conflicts}`；旧 `allocateAssets` 保留给单台。
- UI：`employee-pick-list.tsx`（部门单选 + 搜索 + 分组 + 离职禁选）与 `batch-allocate-dialog.tsx`（两栏，逐行「换人」= 与目标行**交换**）。四种分配/调拨场景共用。
- `/assets/page.tsx` 取员工不过滤 `status` 是有意的——离职员工显示但禁选。
- 🔑 `role="combobox"` 可访问名不能来自内容 → 要么接 `<Label htmlFor>`，要么显式 `ariaLabel`。

## 业务：员工页搜索 / 设备预览 / 批量生成
- 批量生成临时员工：`createEmployeesBatch({departmentId, count(1-100)})`，姓名=`部门名-随机4位`（同批去重）、工号自动递增、事务内同步建账号（初始密码 123456）；入口 = 新建员工弹窗「批量生成」Tab。用途：先建人、后绑设备。
- 员工表列宽已收紧（账号管理态总宽 1220 ≤ 一屏），账号列单行只显 username（displayName 放 title）；姓名旁不渲染「设备 XXX」标签（用户明确移除）。回归：`tests/employee-table-style.test.tsx`。
- `src/lib/employee-search.ts#findEmployeeMatch(target, keyword)`：优先级 姓名→工号→设备编码，返回 `{by, assetNo?} | null`。
- 「在用设备」口径 = `Asset.employeeId = 员工 id` 全部设备，不过滤状态。
- `assetNos` 仅由 `getEmployees` 带出（include.assets），**不要**另开 action 查资产（会脱离 `resolveEmployeeScope`）。
- ⚠️ `handleLocalEdited` 合并必须 `updated.x ?? e.x`；`phone`/`email` 例外（null 是合法清空值）。
- `/employees/[id]` 只读独立路由（用户明确要求，与 `/assets/[id]` 不复用组件）；`employee-device-preview.tsx`（embedded?）路由页与离职核对弹窗共用；只读护栏 `tests/employee-device-preview.test.tsx`，加写操作必须先改测试。

## 业务：离职交接（ASSET_DEPART）
- 结构 `部门主管审批 → 资产管理员审批 → 终审生成交接单(PENDING) → 对账确认回收`；payload = `{targetEmployeeId, reason}` 无 assetId。
- 🔑 `DEPT_MANAGER`/`ASSET_MANAGER` 都没有 `employee.view` → **不能拿 `/employees/[id]` 当审批核对入口**；正确出口 `getDepartureCheckInfo(requestId)`。
- 可见范围唯一口径 `src/lib/approval-scope.ts#visibleRequestWhere(adminId)`，与 `getDepartureCheckInfo` 共用；范围外一律「申请单不存在」。
- 对账回收 `confirmHandover(orderId, remark)`（权限 `asset.depart.execute`）；对账列表每行带快照 `items`，`parseHandoverSnapshot()` 共用，有意不做部门过滤。
- ⚠️ `seedRoles` 在 `rolePermission.count() > 0` 时跳过 ⇒ 新权限点需在「系统设置→角色权限」手勾。
- 待修：`getEmployeeAssets(employeeId)` 仅 requireAuth，无数据范围校验。

## 表格与分页（DataTable）—— 🔥 已全量修复，别回退
- 客户端分页（`data-table.tsx`，`pageSize:10`）；`hidePagination` 用于服务端分页页（lifecycle / approvals cc·done）。
- 🔥 **`data` 引用一变 → TanStack `autoResetPageIndex`（默认开）打回第 1 页**。触发源：toast 自动关闭、权限后置加载、RSC 对比刷新。
- **全部 13 个调用点已审计修复（2026-10-12）**：`/assets`、`/components`、`/models` 内联 filter/map 已包 `useMemo`；`_categories` 渲染上下文从行对象摘到 columns 闭包（`createColumns(categories)` 工厂）；员工页同款已修。`/stock`、`/logs`、`/templates` 本就 memo 化；`/purchase` 双层分页（外层 PagePagination = React state，内层只装 ≤10 条单页）天然安全；`/stocktake` props 直传；`/lifecycle`、approvals cc·done 走 `hidePagination`。
- 回归测试：`tests/pagination-stability.test.tsx`（9 条，覆盖 assets/components/models/purchase 四页）+ `tests/employee-pagination.test.tsx`（3 条）。新页面若把派生数组传 DataTable 必须包 `useMemo` 并加同类测试。
- 🔑 **修正：TanStack `memo` 对 deps 是逐项 `Object.is`（`deps[index] !== dep`），不做内容比较** —— data 数组引用一变必重算并触发 reset，与行对象扁平与否无关。`/assets` 因此上了**两层缓存**（2026-10-12）：① `stableAssets` 按内容签名（`JSON.stringify`）复用旧行对象（行含 components 嵌套数组，浅比较无法识别「新对象、同内容」）；② `filteredAssets` 结果数组浅等（逐元素 `===`）时复用上一次的数组引用。真变的数据正常重算回第 1 页（有守卫测试防缓存吞更新）。
- 员工页分页稳的真实原因：`employeeData = useState(employees)` **挂载后不消费新 props**（本地增删改走 setEmployeeData）→ props 引用怎么变都无感；这也意味着 `router.refresh()` 不会刷新员工列表（既有行为，非本次引入）。
- 语义：引用稳定 = 「结果集真的变了」；筛选变化回第 1 页是正确行为，**别关 `autoResetPageIndex`**（会停在空页）。行对象只装行自身字段，渲染上下文从 columns 闭包取。

## Git
- **🔥 禁止整目录忽略 `scripts/` 或 `tests/`**（历史两次致 10 脚本 + 21 测试静默未跟踪）。`docs/**` 与 `**.md` 保留忽略是有意的，别当 bug 修。
- 只忽略：`__pycache__/`、`*.pyc`、`scripts/_*`、`tests/_*`、`.next*/`、`vitest*.config.ts.timestamp-*.mjs`。排查：`git check-ignore -v`、`git ls-files --others --ignored --exclude-standard`；ignore 对已跟踪文件无效；提交前 `git status --short --untracked-files=all`。
- ⚠️ `~/.gitconfig` 的 `insteadOf`：`ssh://git@github.com/` 不匹配 SCP 风格 `git@github.com:owner/repo`；覆盖 SCP 必须写 `insteadOf = git@github.com:`（曾因此把 SSH 悄悄改写成 HTTPS）。已配 `~/.ssh/config`：`ssh.github.com:443` + connect.exe 走 Clash 7897。

## 代码约定
- `node scripts/*.js` 不自动读 `.env` → 一律 `import { loadEnv } from "./load-env.js"; loadEnv();`。
- SQL 传参走 stdin（`execSync(cmd,{input:sql})`），别在命令行拼引号。
- 仓库换行 LF/CRLF 混用 → 批处理脚本按文件探测。

## 认证
- `iron-session` cookie（`src/lib/auth.ts`），`SESSION_MAX_AGE=8h`；`getCurrentUser` 滑动过期。
- 🔑 **`requireAuth()` 会话失效 → `redirect("/login")`，不抛 UNAUTHORIZED**（客户端导航复用缓存 layout 不重跑守卫，action 抛错 = 整页 Error）。要返回 `{success:false}` 的 action 用 `requireAuthSafe`/`withAuth`。
- `middleware.ts` 与 `getCurrentUser` 同口径：`userId` 与 `username` **都要有**才放行。
- ⚠️ `requireAuth` 抛 NEXT_REDIRECT，**不能放 `try` 块内**；`(main)/layout.tsx` 也调 `getCurrentUser()`。

## UI / 设计系统
### token 与颜色
- shadcn/ui + Radix + Tailwind 3.4 + CSS 变量；明暗双主题默认亮色；品牌主色 = 靛蓝 `--primary`；`darkMode:'class'`；`theme-toggle.tsx` 用 `localStorage["zt-theme"]` + `THEME_CHANGE_EVENT`。
- `--foreground` 不能当遮罩色 → 遮罩一律 `--overlay`。
- **配色唯一来源 = `src/lib/status-styles.ts`**（TONE_CHIP/TONE_SOFT/TONE_TEXT 等），禁止页面写 tailwind 调色板。
- 判据用 CIEDE2000；闸门 **`npm run check:color`**，改任何颜色后必跑。`--border`(1.34:1) 有意不动（发丝线豁免，不适用于输入控件，控件用 `--input`）。
- canvas 取色（`use-theme-colors.ts`）必须 `parseFloat` 不能 `Number`（`Number("56%")=NaN` → canvas 静默不改色）。

### 无障碍基线（WCAG 2.1 AA）
- `<Label htmlFor>` 必须关联控件 id；`<Button>` 的 `type` 必填，禁止 `type="submit"` 与 onClick 并存。
- 错误三件套 `aria-invalid` + `aria-describedby` + `<p role="alert">`；纯图标按钮一律 `aria-label`。
- `<main id="main-content" tabIndex={-1}>` + skip link；`CardTitle` 默认 h2，禁 `<h4>`；可点击卡片用 `<button>`，禁 `<div onClick>`。
- `focus-visible:` 管焦点环；`focus:` 只留给 Radix 菜单项；覆盖 utilities 的 CSS 放 `@layer` 之外。
- 无描述弹窗显式 `aria-describedby={undefined}`，禁止在 dialog.tsx 做全局默认；拖拽排序必须有键盘替代（手柄可聚焦 `<button>` + 方向键）。

### 弹窗 / 表单
- 🔑 嵌套 Dialog 会被外层误关（已修）：`ui/dialog.tsx` 对 `[data-nested-dialog]` preventDefault；⚠️ `{...props}` 展开在内部 handler 之后，同名 handler 会被覆盖。
- 弹窗内分区不套卡片：`divide-y divide-border` + `<section className="py-6">`；控件底色 = 宿主底色反色。
- 🔑 改「背景/层次」先算亮度差：<7pp 不可感，只能靠线不能靠面；分区标题不用 `--primary` 做装饰。
- 表单弹窗基线：`requestClose()` 脏检查 → ConfirmDialog；Ctrl/⌘+Enter；setFocus 首字段；受控下拉 `setValue(k,v,{shouldValidate,shouldDirty})`。

### 存量问题（已知，勿重复扫）
- 🟡 `layout-client.tsx` flex 子项缺 `min-w-0` → ≤1440px 横向溢出（已验证加 `min-w-0` 可修，未落）。
- 🟡 41 处 `text-[Npx]` 跨 9 值；`labels-client.tsx` 打印预览的保留。
- 🧟 `/stats` 死入口（page 只 redirect）；`command-palette.tsx:225` 仍指向。
- ⚠️ `categoryDotClass()` 按配件分类建，却被用于资产分类 → 多数退化灰点。
- ✅ 已确认良好别再扫：tailwind 调色板类全仓 0 处、hex 仅 2 处、文字对比度全达标。🚫 不建议改：英雄卡页头、`bg-muted/30~50`、`text-xs` 行高。
- 审计方法论：不靠截图、修法用注入式实验验证；工具链沉淀在 skill `web-layout-audit`。

## 本机环境坑（WorkBuddy 沙箱 / Windows）
- 🔥 同一文件连续 Edit 会部分丢失（踩过 2 次），Edit 报 success ≠ 落盘 → 多处改动用单次「读→全量替换→写」`scripts/_*.mjs`（必须 .mjs），写后读回断言。
- 🔥 dev server 运行期间严禁 `next build`（共用 `.next` → 全站 CSS 404）。恢复：`free-port 3000` → `mv .next .next.bak` → `npm run dev`。
- 沙箱删文件走 safe-delete shim 可能 ETIMEDOUT → `NODE_OPTIONS="--use-system-ca" <managed-node> -e "fs.unlinkSync(path)"`；`scripts/_*` 临时文件可 `git clean -fX scripts/`。
- 测真实网络必须先 `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY`（沙箱注入透明代理）。
- 清理临时文件不要用不带路径的 `git clean -fXd`（曾误删 .workbuddy/tmp 产物）→ 先 `git check-ignore -v` 再带路径。
