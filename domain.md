# domain.md — 资产管理系统 领域与规范文档

> 本文件是项目的**权威领域与规范文档**。原始需求见 `功能.txt`，技术实现见 `src/`。
> 本文件与原始开发文档共同构成后续所有**诊断 / 重构 / 优化**的**唯一标准**。

---

## 0. 最高约束（治理规则）

1. **唯一标准**：后续所有诊断、重构、优化操作，必须严格以本文件 + 原始开发文档（`功能.txt`、`CONTEXT.md`、Prisma schema、ADR）为唯一依据。
2. **文档高于代码**：当**代码与文档冲突**时，**以文档为准**，不得按代码意图擅自"修正"文档。
3. **禁止私自变更**：未经用户明确确认，不得修改以下三类内容：
   - 业务逻辑（状态流转、库存扣减、编号生成等规则）
   - 数据库表结构（表、字段、类型、约束、索引）
   - 接口出入参（Server Action 公开方法的参数与返回结构）
4. **偏离须确认**：任何与上述任一条冲突的改动，必须先向用户说明并获确认后再执行。

---

## 1. 项目概述

- **名称**：资产管理系统（资产数字化管理平台）
- **定位**：公司内部**电子设备固定资产**的全生命周期管理 Web 应用
- **目标形态**：Next.js 全栈 Web 应用，Docker 容器化部署
- **界面范式**：左侧导航菜单 + 右侧内容区，浏览器访问
- **原始需求文档**：`功能.txt`（6 大功能模块要求）
- **领域语言**：`CONTEXT.md`（实体、状态、动作的统一命名）

---

## 2. 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 开发语言 | TypeScript 5.5+ | 严格模式 |
| 框架 | Next.js 14 (App Router) | Server Components + Server Actions |
| 前端 | React 18 + Tailwind CSS 3 + shadcn/ui | 服务端组件优先 |
| 数据库 | MySQL 8.0 | 生产库 `asset-manage`，测试库 `asset-manage-test` |
| ORM | Prisma 5 | `schema.prisma` 为 schema 权威来源 |
| 认证 | iron-session | Cookie-based session，bcryptjs 密码哈希 |
| 表单 | React Hook Form + Zod | 前端校验 + Server Action 校验 |
| 状态管理 | Zustand (客户端) + React Query (服务端) | |
| 表格 | @tanstack/react-table | 分页、排序、筛选 |
| 图表 | ECharts + echarts-for-react | 仪表盘/统计页 |
| 导出 | xlsx | Excel 读写 |
| 测试 | Vitest + Testing Library | 单元测试 + 集成测试 |
| 部署 | Docker Compose (Nginx 反向代理) | 本地容器化部署 |

**视觉规范**：主色 `#0d9488`（teal-600），字体 `PingFang SC, Microsoft YaHei`，组件库 shadcn/ui + Tailwind。

---

## 3. 分层规范（架构与目录约定）

```
├── prisma/
│   ├── schema.prisma          # 数据库 schema（权威来源）
│   ├── seed.ts                # 种子数据
│   └── migrations/            # 迁移历史
├── src/
│   ├── app/                   # Next.js App Router（路由 + 页面）
│   │   ├── (main)/            # 认证路由组（需登录）
│   │   │   ├── layout.tsx     # 主布局（侧栏 + 内容区）
│   │   │   ├── dashboard/     # 仪表盘
│   │   │   ├── assets/        # 设备档案
│   │   │   ├── components/    # 配件管理
│   │   │   ├── employees/     # 员工管理
│   │   │   ├── stats/         # 统计报表
│   │   │   ├── stocktake/     # 盘点
│   │   │   ├── logs/          # 系统日志
│   │   │   ├── templates/     # 设备模板
│   │   │   └── settings/      # 系统设置
│   │   └── login/             # 登录页（公开）
│   ├── actions/               # Server Actions（业务逻辑层）
│   │   ├── asset.actions.ts
│   │   ├── lifecycle.actions.ts
│   │   ├── component-stock.actions.ts
│   │   ├── component-model.actions.ts
│   │   ├── component-category.actions.ts
│   │   ├── asset-category.actions.ts
│   │   ├── device-template.actions.ts
│   │   ├── employee.actions.ts
│   │   ├── department.actions.ts
│   │   ├── stocktake.actions.ts
│   │   ├── stats.actions.ts
│   │   ├── auth.actions.ts
│   │   ├── system-log.actions.ts
│   │   ├── search.actions.ts
│   │   ├── label.actions.ts
│   │   ├── excel.actions.ts
│   │   └── auto-import.actions.ts
│   ├── components/            # 共享 UI 组件
│   │   ├── ui/                # shadcn/ui 基础组件
│   │   ├── layout/            # 布局组件（sidebar, header）
│   │   └── features/          # 业务组件（data-table, filter-bar, etc.）
│   ├── lib/                   # 工具库
│   │   ├── auth.ts            # 认证（session, requireAuth, withAuth）
│   │   ├── prisma.ts          # Prisma 客户端单例
│   │   ├── types.ts           # ActionResult 类型
│   │   ├── constants.ts       # 状态/动作标签映射
│   │   └── utils.ts           # 通用工具函数
│   ├── hooks/                 # 自定义 React Hooks
│   └── store/                 # Zustand 客户端状态
├── middleware.ts              # Next.js 中间件（路由保护）
├── docker-compose.yml         # Docker 编排
├── Dockerfile                 # 应用镜像
└── tests/                     # 测试文件
```

**分层规则（必须遵守）**：
- **Server Actions 唯一性**：所有数据库写操作集中在 `src/actions/`；客户端组件通过 `"use server"` 导入调用。
- **认证守卫**：所有写操作必须调用 `requireAuth()`；读操作同理。
- **事务安全**：生命周期操作（分配、归还、调拨、报废、送修、维修完成）必须在 `$transaction` 内执行原子状态检查（`updateMany` + 条件过滤 + affected rows 检查）。
- **库存原子性**：所有库存扣减必须使用 `updateMany` + `gte` 条件模式，禁止 `findUnique` + `update` 的读-改-写模式。
- **命名约定**：Action 以动词开头（`create`/`get`/`update`/`delete`/`allocate`/`return`/`transfer`/`scrap`）。
- **返回格式**：所有 Action 返回 `ActionResult<T>`。

---

## 4. 数据库表结构（权威 = Prisma schema）

> 权威 schema 来源为 `prisma/schema.prisma`。下表为概要。

### 4.1 设备分类与模板
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `AssetCategory` | id, name(UNIQUE), code(UNIQUE), is_unique, parentId | 两级分类，code 为编号前缀 |
| `DeviceTemplate` | id, name, categoryId(FK) | 设备 BOM 模板，`@@unique([categoryId, name])` |
| `TemplateComponent` | id, templateId(FK), modelId(FK), quantity | 模板配件清单，`@@unique([templateId, modelId])` |

### 4.2 配件模块
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `ComponentCategory` | id, name(UNIQUE), parentId | 两级配件分类 |
| `ComponentModel` | id, name, brand, categoryId(FK) | `@@unique([categoryId, name, brand])` |
| `ComponentStock` | id, modelId(UNIQUE, FK), quantity | 一对一型号库存 |
| `ComponentStockLog` | id, modelId(FK), type(Enum), quantity, operator | 库存流水，正数入库/负数出库 |

**StockLogType**：`PURCHASE_IN`（采购入库）、`UPGRADE_RETURN`（升级退回）、`ASSET_BUILD`（组装出库）、`UPGRADE_USE`（升级使用）

### 4.3 设备与生命周期
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `Asset` | id, assetNo(UNIQUE), name, templateId(FK), status(Enum), employeeId(FK?) | 设备实体 |
| `AssetComponent` | id, assetId(FK), modelId(FK), quantity | 设备当前配件配置，`@@unique([assetId, modelId])` |
| `LifecycleLog` | id, assetId(FK), action(Enum), fromStatus, toStatus, employeeId, fromEmployeeId, operator | 生命周期日志 |

**AssetStatus**：`IDLE`（闲置）、`IN_USE`（在用）、`IN_MAINTENANCE`（维修中）、`SCRAPPED`（报废）

**LifecycleAction**：`CREATED`、`ALLOCATED`、`RETURNED`、`TRANSFERRED`、`UPGRADED`、`MAINTENANCE_START`、`MAINTENANCE_DONE`、`SCRAPPED`

### 4.4 员工与组织
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `Department` | id, name(UNIQUE) | 部门 |
| `Employee` | id, employeeNo(UNIQUE), name, departmentId(FK), phone, email | 员工 |

### 4.5 系统模块
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `Admin` | id, username(UNIQUE), password(bcrypt) | 管理员账号 |
| `SystemLog` | id, module, action, detail, operator | 系统操作日志 |
| `StocktakeSession` | id, name, status(Enum), startedAt, completedAt | 盘点任务 |
| `StocktakeRecord` | id, sessionId(FK), assetId(FK), expectedStatus, actualStatus(Enum) | 盘点明细，`@@unique([sessionId, assetId])` |

**StocktakeStatus**：`OPEN`（进行中）、`COMPLETED`（已完成）
**StocktakeResult**：`NORMAL`（正常）、`MISSING`（盘亏）、`EXTRA`（盘盈）

---

## 5. 统一返回格式 / 接口规范

### 5.1 ActionResult 统一类型
```typescript
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```
所有 Server Action 必须返回 `ActionResult<T>`。

### 5.2 Server Action 公开方法清单（接口出入参，禁止擅自改）

**设备**：`createAsset`、`getAssets`、`getAssetById`、`updateAsset`、`deleteAsset`
**生命周期**：`allocateAssets`、`returnAssets`、`transferAssets`、`upgradeAssetComponent`、`scrapAssets`、`maintenanceStart`、`maintenanceComplete`、`adjustAssetComponents`
**配件**：`purchaseStockIn`、`upgradeReturnStockIn`、`assetBuildStockOut`、`upgradeUseStockOut`、`batchStockOut`、`getStockByModelId`、`getAllStocks`、`getStockLogs`
**配件型号**：`createComponentModel`、`updateComponentModel`、`deleteComponentModel`、`getComponentModels`
**配件分类**：`createComponentCategory`、`updateComponentCategory`、`deleteComponentCategory`、`getComponentCategories`
**设备分类**：`createAssetCategory`、`updateAssetCategory`、`deleteAssetCategory`、`getAssetCategories`
**设备模板**：`createDeviceTemplate`、`updateDeviceTemplate`、`deleteDeviceTemplate`、`getDeviceTemplates`
**员工**：`createEmployee`、`updateEmployee`、`deleteEmployee`、`getEmployees`、`getEmployeeById`
**部门**：`createDepartment`、`updateDepartment`、`deleteDepartment`、`getDepartments`
**盘点**：`createStocktakeSession`、`getStocktakeSessions`、`getStocktakeSessionById`、`updateStocktakeRecord`、`completeStocktakeSession`
**认证**：`login`、`logout`、`changePassword`、`getCurrentUser`
**统计**：`getDashboardStats`、`getAssetStats`、`getLifecycleTrends`
**其他**：`getSystemLogs`、`searchAssets`、`generateLabel`、`exportAssets`、`importAssets`、`autoImportAssets`

### 5.3 认证守卫
- **路由级**：`middleware.ts` 拦截所有非公开路由，无 session → 重定向 `/login`
- **API 级**：每个 Server Action 调用 `requireAuth()`，未认证抛出 `UNAUTHORIZED`
- Session 使用 iron-session，cookie 名 `zichuan_session`，有效期 8 小时

---

## 6. 错误处理

- Action 层：`try/catch` → 返回 `{ success: false, error: "..." }`
- 前端：`toast` 组件显示错误信息
- 事务错误：Prisma 异常在 catch 中按错误类型分类返回中文错误消息
- 无数字错误码体系

---

## 7. 校验规则

| 对象 | 规则 |
|------|------|
| 设备创建 | `name` 必填；`templateId` 必填且存在；`assetNo` 自动生成 |
| 设备编辑 | `name` 可改；`location`/`purchaseDate`/`warrantyMonths`/`notes` 可选 |
| 员工 | `name` 必填；`employeeNo` 自动生成；`departmentId` 必填 |
| 配件型号 | `name` 必填；`categoryId` 必填且存在；同分类下 `name + brand` 唯一 |
| 配件入库 | `quantity` 必须为正整数 |
| 分配 | 仅 `IDLE` 状态可分配；员工必须存在；唯一分类下每人只能有一台设备 |
| 归还 | 仅 `IN_USE` 状态可归还 |
| 调拨 | 仅 `IN_USE` 状态可调拨；目标员工必须存在 |
| 送修 | 非 `SCRAPPED` 且非 `IN_MAINTENANCE` 状态可送修 |
| 维修完成 | 仅 `IN_MAINTENANCE` 状态可完成 |
| 报废 | 非 `SCRAPPED` 状态可报废；报废后配件不回库 |
| 删除部门 | 存在关联员工则禁止 |
| 删除分类 | 存在关联资产或模板则禁止 |
| 登录 | 用户名 + bcrypt 密码比对 |

---

## 8. 业务约束（领域规则 — 禁止擅自改）

### 8.1 设备状态机（四态）
`IDLE` → `IN_USE` → `IDLE`（归还）/ `SCRAPPED`（报废）
`IDLE` / `IN_USE` → `IN_MAINTENANCE`（送修）→ `IDLE`（维修完成）
任意非 `SCRAPPED` 状态 → `SCRAPPED`（报废）

| 动作 | 状态变化 | 附带操作 |
|------|----------|----------|
| 分配 `allocateAssets` | `IDLE` → `IN_USE`，`employeeId=目标员工` | 生命周期日志 + 系统日志 |
| 归还 `returnAssets` | `IN_USE` → `IDLE`，`employeeId=NULL` | 生命周期日志 + 系统日志 |
| 调拨 `transferAssets` | `IN_USE` → `IN_USE`，`employeeId=目标员工` | 生命周期日志 + 系统日志 |
| 送修 `maintenanceStart` | `IDLE`/`IN_USE` → `IN_MAINTENANCE` | 生命周期日志 + 系统日志 |
| 维修完成 `maintenanceComplete` | `IN_MAINTENANCE` → `IDLE` | 生命周期日志 + 系统日志 |
| 报废 `scrapAssets` | 任意非 `SCRAPPED` → `SCRAPPED`，`employeeId=NULL` | 生命周期日志 + 系统日志 |

### 8.2 配件变更与库存
- 组装设备出库：按 BOM 模板扣减库存（`ASSET_BUILD`）
- 升级替换：新配件扣减库存（`UPGRADE_USE`），旧配件回库（`UPGRADE_RETURN`）
- 配置调整：增加配件扣减库存（`UPGRADE_USE`），减少配件回补库存（`UPGRADE_RETURN`）
- 报废：配件不回库（ADR 0007）

### 8.3 编号生成规则
- 设备编号：`{分类 code}-{4位自增序号}`（如 `DN-0001`），事务内原子生成
- 工号：`EMP` + 当日 `yyyymmdd` + 4 位自增序号

### 8.4 唯一性约束
- 设备分类可标记 `is_unique`：该分类下每人只能拥有一台设备
- 约束检查范围：`IDLE`、`IN_USE`、`IN_MAINTENANCE` 状态（不含 `SCRAPPED`）

### 8.5 系统日志
- 所有生命周期操作（分配、归还、调拨、报废、送修、维修完成、升级、配置调整）写入 `SystemLog`
- 采购入库写入 `SystemLog`
- 模块名使用中文：分配、归还、调拨、报废、送修、维修完成、升级、配置变更、入库

### 8.6 认证与权限
- 单账号模式（单人本地使用）
- 初始账号通过 seed.ts 创建
- 密码使用 bcryptjs 哈希存储
- 支持修改密码

---

## 9. 模块映射（路由 → 页面）

| 路由 | 页面 | 说明 |
|------|------|------|
| `/login` | 登录页 | 公开路由 |
| `/dashboard` | 仪表盘 | 概览统计 + 最近活动 |
| `/assets` | 设备列表 | 搜索、筛选、批量操作 |
| `/assets/[id]` | 设备详情 | 履历、配件配置、配置编辑器 |
| `/components` | 配件列表 | 型号管理 |
| `/components/stock` | 库存管理 | 入库/出库/流水 |
| `/components/models` | 型号管理 | 型号 CRUD |
| `/employees` | 员工管理 | 员工 CRUD |
| `/stats` | 统计报表 | 状态/分类/部门/员工/趋势 |
| `/stocktake` | 盘点列表 | 盘点任务管理 |
| `/stocktake/[id]` | 盘点详情 | 逐条标记设备状态 |
| `/templates` | 设备模板 | BOM 管理 |
| `/logs` | 系统日志 | 操作审计 |
| `/settings` | 系统设置 | 分类/部门/账号管理 |
| `/settings/account` | 账号设置 | 修改密码 |
| `/settings/asset-categories` | 设备分类 | 分类管理 |
| `/settings/component-categories` | 配件分类 | 分类管理 |
| `/settings/departments` | 部门管理 | 部门 CRUD |
| `/settings/labels` | 标签打印 | 设备标签生成 |

---

## 10. 部署

### 10.1 Docker 部署
```
docker compose up -d --build   # 一键部署
```

服务组成：
- `mysql`：MySQL 8.0，端口 `${MYSQL_HOST_PORT:-3308}`
- `app`：Next.js 应用（standalone 模式）
- `db-init`：数据库初始化（迁移 + 种子数据），一次性运行
- `nginx`：反向代理，端口 `${NGINX_HOST_PORT:-80}`

### 10.2 环境变量
`.env` 文件管理：
- `DATABASE_URL`：本地开发数据库连接
- `DOCKER_DATABASE_URL`：Docker 内部数据库连接
- `SESSION_SECRET`：iron-session 加密密钥（≥32 字符）
- `MYSQL_HOST_PORT`：MySQL 宿主机端口（默认 3308）
- `NGINX_HOST_PORT`：Nginx 宿主机端口（默认 80）

### 10.3 本地开发
```
npm run dev:full    # 初始化数据库 + 启动开发服务器
npm run dev         # 启动开发服务器（需要已有数据库）
```

---

## 11. 已知问题

> 以下为当前代码已知问题，仅供诊断/重构定位；**不改变上述规范**，修复须先与用户确认。

1. **测试隔离问题**：多个测试文件共享数据库，`beforeEach` 清库后部分测试存在外键/唯一约束冲突（如 `stocktake.test.ts`、`lifecycle.test.ts` 与其他测试文件并行运行时失败）。
2. **`getAssets` 分类筛选在内存中执行**：`categoryId` 筛选加载全部资产后在 JS 中过滤，未在数据库层完成。
3. **无分页**：`getAssets` 返回全部资产，大数据量时可能性能不足。
4. **`middleware.ts` session 处理**：`getIronSession` 在 middleware 中使用 `NextResponse.next()` 可能无法正确传播 session cookie；且 catch 块静默重定向到登录。
5. **`auth.actions.ts` 中 `getCurrentUser` 不需要 `requireAuth`**：`getCurrentUser` 被 `requireAuth` 内部调用，但自身也调用 `requireAuth()`（已在上层调用处处理）。

---

*生成依据：`prisma/schema.prisma`、`src/actions/`、`src/app/`、`CONTEXT.md`、`docs/adr/`、`middleware.ts`、`docker-compose.yml`。*
*治理规则（§0）为项目最高约束，优先于本文件其余任何条款。*