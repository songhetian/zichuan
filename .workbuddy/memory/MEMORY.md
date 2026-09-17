# 项目长期记忆 (zichuan)

> 资产管理系统：单体 Next.js 14 App Router + Prisma 5 + MySQL 8。`src/actions/*` 是 Server Actions，无独立后端。

## 数据隔离（最重要，务必遵守）
- **真实库/生产数据**：`asset-manage` @ Docker `zichuan-mysql`(3308)，卷 `mysql_data`。只有生产容器与 docker 脚本该碰它。
- **开发库**：`asset-manage-dev` @ 本机 MySQL 3306（FlyEnv，root/root）。日常开发一律用它。
- **测试库**：`asset-manage-test` @ 本机 3306；`tests/setup.ts` 每测清空所有表。
- **安全闸门**：`tests/db-guard.ts` 的 `assertSafeTestDb()`、`scripts/dev-config.js` 的 `loadDevConfig()`（库名须以 `-test`/`-dev` 结尾）。新增涉 DB 的脚本/配置必须接闸门。
- **环境变量优先级（实测）**：父进程注入的 `DATABASE_URL` 高于 `.env`（`@next/env` 不覆盖已存在的键）→「`.env.dev` 覆盖 + 子进程注入」是可靠隔离手段。
- `.env` = 生产配置；`.env.dev` = 开发配置（`DB_MODE=local|docker`）。`DB_MODE=local` 时 `ensure-mysql.js` 只探测本机，**绝不启 Docker**。
- 本机 3306 的 `zichuan` 库是早期残留（3 资产），非真实数据。本机 mysql 客户端在 `D:\Program Files\FlyEnv-Data\app\mysql-8.2.0\mysql-8.2.0-winx64\bin\mysql.exe`（不在 PATH）。

## 开发命令（2026-09-17 精简为 9 条）
- `npm run dev` = `node scripts/dev-start.js`：**唯一开发入口**。释放 3000 端口 → 检查/建开发库 → `migrate deploy` →（schema 未变则跳过）`prisma generate` → 种子 → 启动前端。自检 `DEV_NO_LAUNCH=1`；强制重生成 `FORCE_PRISMA_GENERATE=1`。约 26s（Prisma CLI / tsx 冷启动占大头）。**禁止裸跑 `next dev`**（会读 `.env` 连真实库）。
- `npm run build` / `npm run start`（⚠️ `start` 读 `.env` 连真实库，属生产形态，与 docker 生产一致，有意保留）。
- `npm run test`（全量，隔离测试库）/ `npm run test:ui`（仅 .tsx，12 文件）。
- `npm run db` = `node scripts/dev-db.js`，子命令：`status`(默认) | `up` | `migrate`（在开发库建新迁移，已注入 `.env.dev`）| `reset` | `test:init` | `logs` | `down`。
- `npm run docker` = `node scripts/docker.js`，子命令：`deploy` | `update` | `mysql`（只起生产 MySQL，备份/导出用）| `down` | `restart [服务]` | `logs [服务]` | `ps` | `migrate` | `seed` | `reset`（⚠️ 需输入 yes；非 TTY 需 `CONFIRM_RESET=1`）。
- `npm run free-port 3001`：只终止**监听该端口**的进程（已合并原 `kill-node`）。⚠️ **绝不「杀光所有 node.exe」**——npm 自身就是 node.exe，会自杀并断掉命令链，还会误杀其它项目（如 3001）。
- **已删除的入口**：`dev:full`（dev 形态+真实库）、`setup`（裸 `prisma migrate dev` 默认打真实库、漂移时会交互式重置）、`prod`、`kill-node`、`predev`（无条件 generate，白等 ~8s）、`dev:db*`、`test:db:init`、`test:frontend` 及十余个 `docker:*`。
- npm ≥7 支持子命令直接透传：`npm run db status`，**无需 `--`**。
- ⚠️ `scripts/db-empty.js` 会清空全部业务表，已加闸门（库名须 `-dev`/`-test` 结尾，`ALLOW_REAL_DB=1` 才放行）。
- 真实库是**在用生产数据**：数据有变化先查 `SystemLog`，多为用户/同事的真实业务操作，不要当成脚本污染。

## 配件型号与模板命名（定型）
- `ComponentModel` 唯一约束 = `(categoryId, name, brand)`（保留品牌维度）。
- `DeviceTemplate` 唯一约束 = DB 层 `UNIQUE(categoryId, normalizedName)`，`normalizedName` 为生成列（剥掉尾部 ` (数字)`）→ **禁止用 " (2)" 后缀命名模板**。
- 导入重名模板：同名但 BOM 不同 → 追加 ` #` + `bomFingerprint()`（FNV-1a → base36 5 位，**确定性**，与配件顺序无关）。刻意不用真随机——否则同一份 Excel 每次导入都新建模板。
- 模板 BOM = CPU + 内存 + 硬盘（+ 主板/显卡），**不含显示器**（显示器逐台挂到设备）。

## 部署
- 生产：Debian 局域网 `192.168.110.145`。纯代码更新 `git pull && npm run docker update`（重建 app+nginx，**不跑 db-init**）；含迁移 `npm run docker deploy`；502 → `npm run docker restart nginx`。
- **数据安全**：数据在 named volume，`up -d` 不带 `-v` 即保留。`docker deploy` 的 db-init 三步全幂等（`CREATE DATABASE IF NOT EXISTS` / `migrate deploy` / seed 每段有 `count()===0` 守卫）。⚠️ 只有 `npm run docker reset` 会真删数据（含 `down -v`，已加 yes 确认闸门）。
- **镜像不含密钥**：`output:'standalone'` 会把 `.env` 复制进 `.next/standalone/`，而 Dockerfile `COPY --from=builder /app/.next/standalone ./` → `.dockerignore` 必须保留 `.env` / `.env.*`（2026-09-17 实测确认曾泄露，已修）。
- compose 对 `app`/`db-init` 显式 `NODE_ENV: production`（否则 `env_file: .env` 的 development 会覆盖 Dockerfile 的 ENV）；`DOCKER_DATABASE_URL`/`SESSION_SECRET` 用 `${VAR:?}` 缺失即失败——空 `SESSION_SECRET` 会让 `src/lib/auth.ts` **静默回退到代码里写死的默认密钥**（任何人可伪造登录态）。
- 服务器 `.env` 必须含：`DATABASE_URL`、`DOCKER_DATABASE_URL`(host 写服务名 `mysql`)、`SESSION_SECRET`(≥32 随机)。`.env` 不入库 → 全新 clone 须 `cp .env.example .env` 后填密钥（`.env.example` 已入库且是空占位符）。
- ⚠️ 历史泄露：`.env.example` 曾被提交一个真实 64 位 `SESSION_SECRET`（提交 `4c6f8dc`，现已改占位符）。若服务器 `.env` 照抄过该模板，需轮换密钥（会使现有登录态失效，可接受）。
- 本机 WorkBuddy 沙箱局限：`docker compose` 子命令不可用（cli-plugins 缺失），用 `docker-compose`；服务器正常，`package.json` 脚本不用改。

## 测试
- `npm test` = 全量（含清库），指向 `asset-manage-test@3306`；2026-09-17 起 **54 文件 / 438 用例全绿**。
- `npm run test:ui` = 仅 UI 组件（jsdom，`tests/**/*.test.tsx`）。旧配置曾把 240 条测试数据写进真实库并清空 Admin 表——**任何新 vitest 配置必须有 `env.DATABASE_URL` 指向测试库 + setup 中的安全闸门**。
- 改 schema 后**三个库都要 `migrate deploy`**：开发库/测试库由 `npm run dev` / `npm run db test:init` 自动；真实库需手动：`DATABASE_URL="mysql://root:root@localhost:3308/asset-manage" npx prisma migrate deploy`（收紧约束前先 mysqldump）。
- action 返回类型新增字段（如 `createdAt`）时同步更新测试 mock，否则 `undefined.xxx()` 被 catch 吞掉、表现为"业务返回失败"的假象。

## .gitignore 约定
- **🔥 禁止整目录忽略 `scripts/` 或 `tests/`**。历史上两条宽忽略导致 10 个脚本 + 21 个测试（含 `db-guard.ts`）静默未跟踪；更隐蔽的是已提交的 `db-init.js`/`kill-node.js` import 了未跟踪的 `load-env.js`/`dev-config.js`/`free-port.js` → clone 后 `npm run kill-node`/`setup` 直接 `Cannot find module`。
- 只忽略真垃圾（`__pycache__/`、`*.pyc`、`scripts/_*`、`tests/_*`）。`.env.dev` 已入库（仅 DB_MODE + DATABASE_URL，本地 root/root 无敏感信息）。
- 排查手法：`git ls-files --others --exclude-standard`（**必须带 `--exclude-standard`**，否则不套用 gitignore）、`git ls-files --error-unmatch <file>`。

## 脚本约定
- `node scripts/*.js` 不会自动读 `.env`（Prisma 会），一律先 `import { loadEnv } from "./load-env.js"; loadEnv();`。
- 涉及 SQL 传参走 stdin（`execSync(cmd, { input: sql })`），不要在命令行拼反引号/引号——cmd 与 bash/sh 转义规则不一致。

## 认证机制
- `iron-session` cookie session（`src/lib/auth.ts`），`SESSION_MAX_AGE=8h` 且**无滑动过期**（活跃也不续期）→ "用着用着自动退出"的头号嫌疑。
- 无 middleware；`(main)/layout.tsx` 每次服务端渲染调 `getCurrentUser()`，null 即 `redirect("/login")`。
- 局域网 IP 与域名混用访问 → cookie 域不共享 → 跳登录（局域网典型坑）。
- 部署为纯 HTTP，故 cookie `secure:false` 当前正确。

## UI / 设计系统（当前结论）
- 底座 shadcn/ui + Radix + Tailwind + CSS 变量 token；品牌色 teal `173 80% 40%`，背景暖米白 `40 5% 98%`，侧栏固定深色。
- **不做深色模式**（2026-08-07 用户拍板，勿再主动提）。
- 表格：统一走**页面级搜索**（DataTable 内置 `searchKey` 已移除）；模板/型号/库存流水有「重置筛选」；DataTable 支持 `defaultSorting`（时间倒序）。
- 资产操作语义：「删除」=`deleteAsset` 硬删除（垃圾桶图标，红色破坏性确认）；「报废」=状态变更 `SCRAPPED`（`Ban` 图标，橙色）；其余生命周期动作（分配/归还/调拨/送修/维修完成）收进「更多」菜单。状态色见 `status-badge.tsx` 的 `getStatusStyle()`。
- 遗留小项：表格行内 icon-only 按钮只有 `title`，建议补 `aria-label`。
