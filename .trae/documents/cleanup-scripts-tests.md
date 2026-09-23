# 清理 scripts/ 与 tests/ 目录

## Context（背景）

用户反映：
1. scripts/ 目录 39 个条目太杂，希望只保留核心命令链（一键开发、一键生产、查看日志、热更新），不需要那么多文件。
2. tests/ 目录 60+ 文件很乱，很多没用，需要清理。

已与用户确认的三组决策：
- **Python 硬件扫描工具整组删除**（hardware_scanner.py 等 + build/dist/__pycache__ + 测试用 xlsx）
- **两个必然失败的测试删除**（prisma-stability.test.ts 检查 Windows DLL、deploy-config.test.ts 读不存在的 .env）
- **一次性运维脚本全部删除**（db-empty.js、dedupe-data.mjs、health-check.js 等 9 个）
- **根目录杂项一并删除**（_fmt_test.xlsx、query）

## 删除清单

### 1. scripts/ — 删除（24 项）

**Python 硬件扫描工具组（10 项）**
- `scripts/hardware_scanner.py`
- `scripts/hardware_utils.py`
- `scripts/generate_multi_hw_test.py`
- `scripts/generate_multi_test.py`
- `scripts/generate_test_excel.py`
- `scripts/hardware_scanner.spec`
- `scripts/硬件扫描工具.spec`
- `scripts/build/`（整个目录，PyInstaller 产物）
- `scripts/dist/`（整个目录，含 .exe 和 asset_import.xlsx）
- `scripts/__pycache__/`（整个目录）

**测试用 Excel（6 项）**
- `scripts/_test_normal.xlsx`
- `scripts/asset_import.xlsx`
- `scripts/测试导入_6人3部门.xlsx`
- `scripts/测试导入_多内存多硬盘.xlsx`
- `scripts/测试导入_多行数据.xlsx`
- `scripts/田鹤松_硬件信息.xlsx`

**一次性运维脚本（9 项）**
- `scripts/db-empty.js`
- `scripts/dedupe-data.mjs`
- `scripts/health-check.js`
- `scripts/add-dynamic-export.cjs`
- `scripts/cleanup-test-data.cjs`
- `scripts/normalize-templates-and-components.mjs`
- `scripts/restore-bom.sql`
- `scripts/test-db.js`
- `scripts/test-real-import.ts`

### 2. tests/ — 删除（5 项）

- `tests/prisma-stability.test.ts`（检查 `query_engine-windows.dll.node`，本机是 Mac 必然失败；且引用将被删除的 health-check.js）
- `tests/deploy-config.test.ts`（读取被 gitignore 的 `.env`，本机不存在）
- `tests/hardware-scanner-excel.test.ts`（引用被删的 scripts/asset_import.xlsx 等）
- `tests/script-excel-import.test.ts`（引用被删的 scripts/测试导入_*.xlsx）
- `tests/test_hardware_utils.py`（Python unittest，引用被删的 scripts/hardware_utils.py）

### 3. tests/dev-isolation.test.ts — 修改（1 处）

删除 [dev-isolation.test.ts](file:///Users/song/projects/zichuan/tests/dev-isolation.test.ts#L72-L78) 中 "db-empty.js 必须有安全闸门" 这个 `it` 块（引用将被删除的 db-empty.js），其余保留。

### 4. src/test/ — 删除（2 项）

- `src/test/improvements.test.ts`（遗留的旧"12项优化功能测试"，与 tests/ 目录功能重复，属于目录混乱的一部分）
- `src/test/setup.ts`（仅 `import '@testing-library/jest-dom'`，tests/setup.ts 已有等价功能）

### 5. 根目录 — 删除（2 项）

- `_fmt_test.xlsx`（导入格式测试文件）
- `query`（内容只有 "mysql"，疑似误建文件）

## 保留清单（不动）

**scripts/ 核心命令链（12 项）**
- `prisma-generate.js`（install）、`dev-start.js`（dev）、`dev-db.js`（db）、`free-port.js`（free-port，被 dev-start 引用）、`docker.js`（docker）
- 被上述引用的辅助：`load-env.js`、`dev-config.js`、`compose.js`、`ensure-mysql.js`、`db-init.js`、`test-db-init.js`、`docker-init.cjs`（Dockerfile/docker-compose 引用）

**tests/ 其余约 50 个测试**：引用的 @/actions、@/lib、@/components 模块均存在，保留。

**package.json**：scripts 字段不变，核心命令（dev/build/start/test/db/docker/free-port）全部保留。

## 注意事项

- `prisma/schema.prisma` 和 `prisma/migrations/.../migration.sql` 注释里提到 `scripts/dedupe-data.mjs` 是历史说明，不改（迁移文件不可动）。
- `.gitignore` 已有 `scripts/_*`、`tests/_*`、`__pycache__/` 规则，无需改动。
- 删除均通过 DeleteFile 工具逐个执行，涉及目录用 Shell `rm -rf`（build/、dist/、__pycache__/ 含大量文件）。

## 验证

1. 删除后 `git status` 确认无意外改动（仅删除）。
2. `npm run test:ui`（前端组件测试，不连库）确认测试仍能收集并运行、无报错。
3. 全量 `npm run test` 需 MySQL（本机 3306/3308 当前均未监听），若 MySQL 未启动则跳过，说明原因。
4. `node scripts/dev-start.js` 仅做环境自检有副作用（会建库），改为确认 `npx prisma generate` 仍可运行（核心脚本链未被破坏）。
