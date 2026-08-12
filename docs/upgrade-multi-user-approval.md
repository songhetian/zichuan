# 资产管理系统重构规划 v3：一次性技术栈替换（企业级）

> **决策变更记录**
> - v1：渐进式引入（Next.js 单宿主过渡）
> - v2：企业级功能全景 + 渐进式演进
> - **v3（本版）：一次性整体替换。** 用户明确：不做渐进式共存；新架构一步到位承载全部功能；旧分支冻结，作为对照与兜底；现有 12 个核心模块与近期迭代功能**全部保留**。
>
> 目标技术栈：**refine · Next.js · NestJS · WebSocket(Socket.io) · zustand · zod · Prisma · MySQL · Redis · React Flow**。

---

## 1. 决策摘要（v3 与 v2 的本质差异）

| 维度 | v2（渐进式） | v3（一次性替换） |
|------|--------------|------------------|
| 架构演进 | P1–P3 旧架构，P4 再拆 | **从零搭企业架构，一步到位** |
| 新旧共存 | Web 与 API 并存、逐模块切换 | **不共存**：新架构直接承载全部功能 |
| 旧代码 | 长期维护 | **冻结在旧分支**，仅作对照/兜底/回退 |
| 认证 | 过渡期保留 iron-session | 新架构认证（NestJS 签发会话 + RBAC 基座） |
| 实时 | 先 SSE | **WebSocket（Socket.io 网关）一步到位** |
| 数据 | 现有表不动 | **复用现有 Prisma schema 为基础 + 企业级增量**（表结构迁移一次完成） |

**兜底策略**：旧分支（当前主分支）完整保留，任何时候可切回；新分支以「功能对照表」逐批验收。

---

## 2. 目标架构（终态）

```
┌────────────────────────── Monorepo (pnpm workspace) ──────────────────────────┐
│                                                                               │
│  apps/web (Next.js + refine)       apps/api (NestJS)          apps/worker     │
│  ├─ 页面/SSR/PWA (shadcn/ui)       ├─ REST API (Swagger)     ├─ BullMQ 消费者  │
│  ├─ refine headless 管理框架        ├─ Socket.io 网关          ├─ 通知/邮件/企微  │
│  │   (auth/accessControl/          ├─ 认证 + RBAC(IAM)         ├─ 定时任务/报表  │
│  │    notification provider)       ├─ 审批引擎(服务)           └─ 审计落库       │
│  ├─ zustand 客户端状态             ├─ 资产域服务(迁移自 actions)                │
│  ├─ React Flow 审批画布            ├─ 调度(@nestjs/schedule)                    │
│  └─ ECharts 报表                   └─ 审计日志                                 │
│                                                                               │
│  packages/shared: Prisma Client · DTO(zod) · 权限常量 · 事件协议 · 工具         │
│  中间件: MySQL · Redis(缓存/队列/会话) · 对象存储(可选: 附件/导入文件)            │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈决策表（选型即职责）

| 技术 | 承担职责 | 替换的现有部分 |
|------|----------|----------------|
| **Next.js 14+** | 页面渲染（RSC/SSR）、路由、PWA 宿主 | 保留角色，仍是 web 宿主 |
| **refine** | 管理页框架：`dataProvider`/`authProvider`/`accessControlProvider`/`notificationProvider`，列表-表单-权限-通知的抽象 | 替代大量手写 CRUD 页面与筛选逻辑 |
| **NestJS** | 后端 API（模块化）、认证与会话、权限服务、审批引擎、调度、审计 | 替代全部 Server Actions（`src/actions/*`）与 `middleware.ts` 守卫 |
| **WebSocket (Socket.io)** | 实时通知推送、审批待办实时更新 | 替代无（新增能力） |
| **zustand** | 客户端轻量状态（现有保留，继续使用） | 保留 |
| **zod** | 前后端共享 DTO 校验（`packages/shared` 单一来源） | 现有 zod 用法保留并集中 |
| **Prisma + MySQL** | 数据层：复用现有 schema 为基线 + 企业级增量表 | 保留，一次迁移 |
| **React Flow** | 审批节点拖拽画布 | 新增 |
| **ECharts** | 统计报表可视化 | 保留 |
| **shadcn/ui + Tailwind** | 组件与样式 | 保留 |
| **Redis** | 缓存 / 队列(BullMQ) / 会话 | 新增 |
| **Docker Compose + nginx** | 部署：web/api/worker/mysql/redis | 扩展现有 compose |

---

## 4. 目录结构（pnpm monorepo 草案）

```
zichuan/
├─ apps/
│  ├─ web/                    # Next.js
│  │  ├─ app/(main)/...       # 页面路由（按模块）
│  │  ├─ features/            # 页面级组件（refine 资源页）
│  │  └─ lib/                 # refine provider 装配
│  ├─ api/                    # NestJS
│  │  ├─ src/modules/
│  │  │  ├─ auth/             # 登录/会话/密码/MFA/SSO
│  │  │  ├─ iam/              # 用户/角色/权限/审计
│  │  │  ├─ assets/           # 设备域（迁移自现有 actions）
│  │  │  ├─ components/       # 配件域
│  │  │  ├─ employees/        # 员工/部门
│  │  │  ├─ approval/         # 审批引擎 + 流程设计器服务
│  │  │  ├─ notification/     # 通知 + Socket.io 网关
│  │  │  ├─ finance/          # 折旧/采购/合同/供应商
│  │  │  └─ report/           # 报表
│  │  └─ src/app.module.ts
│  └─ worker/                 # BullMQ 消费者（通知/定时/报表）
├─ packages/
│  ├─ shared/                 # Prisma Client、DTO(zod)、权限常量、类型
│  └─ config/                 # eslint/tsconfig 共享
├─ prisma/                    # schema + migrations（唯一数据源）
├─ docker/                    # compose（web/api/worker/mysql/redis/nginx）
└─ docs/                      # domain.md、ADR、升级规划
```

---

## 5. 一次性替换的迁移方法论（关键）

### 5.1 基线锁定（开工前必须完成）

1. **冻结旧分支**：打 tag（如 `legacy-v1`），任何新改动不再进旧分支；旧分支仅用于对照与兜底。
2. **功能清单基线**：导出 12 模块 + 近期迭代的「功能行为对照表」（功能点 → 旧实现位置 → 验收标准），替换完成后逐项打勾。
3. **数据基线**：生产数据导出快照；替换后跑「对账脚本」（表行数、关键字段抽样一致）。
4. **行为基线**：关键业务规则（编号生成、状态流转、库存扣减、审批语义）以 `domain.md` + Prisma schema 为唯一标准，直接复用到新代码。

### 5.2 移植顺序（M1–M6，见第 8 节）

- 先搭**基座**（monorepo、认证、RBAC、Prisma 迁移）→ 再移植**业务域**（资产/配件/员工）→ 再上**审批与通知** → 最后**平台工程**。
- 每批模块移植后：行为对照表验收 + 全量测试 + `tsc`。

### 5.3 数据兼容

- **复用现有 schema** 作为 `packages/shared/prisma` 的基线（不动既有表结构与约束），一次性叠加企业级增量表（User/Role/Permission/Notification/ApprovalFlow 等）。
- 数据迁移：`Admin → User`、现有 seed 兼容；老数据直接可读（字段名不变）。

### 5.4 回退预案

- 新分支任意里程碑失败 → 旧分支 `legacy-v1` 一键恢复部署（Compose 配置保留旧版）。
- 数据库不做破坏性变更（只增不删），回退时新表可安全忽略。

---

## 6. 企业级功能全景（全部纳入本次替换）

### 6.1 IAM 身份与访问
多账户 + RBAC（权限点 `module:action`）、数据范围（全局/部门/本人）、组织树、**MFA(TOTP)**、**SSO/OIDC**、会话管理（设备列表/强制下线/锁定）、密码策略、登录与权限变更审计（只追加 + 摘要链）。

### 6.2 通用工作流引擎
React Flow 拖拽设计器（开始/审批/会签/条件/并行/结束）；版本管理（草稿/发布/历史）；流转控制（同意/驳回/转交/加签/抄送）；委托与超时催办；业务快照与通过后回调（同事务 + 补偿）。

### 6.3 实时通知（WebSocket 一步到位）
Socket.io 网关（站内实时）+ 邮件（SMTP）+ 企微/钉钉/飞书 Webhook；模板化；订阅偏好；BullMQ 队列可靠投递（重试/死信）。

### 6.4 资产核心域增强
财务折旧（直线/双倍余额）、采购申请审批流、供应商/合同台账、保修预警、扫码盘点（PWA）、自定义报表（Excel/PDF/定时邮件）、数据字典 + i18n。

### 6.5 平台工程
多环境（dev/staging/prod）、CI/CD（GitHub Actions：lint→type→test→build→deploy）、可观测性（Pino 结构化日志 / Prometheus 指标 / Sentry 错误）、安全基线（CSRF/限流/依赖扫描/密钥管理）、备份恢复、API 文档（Swagger）、灰度回滚。

### 6.6 数据治理
导入导出模板与逐行错误报告、报废归档、软删策略、事务一致性评审。

---

## 7. 数据模型（复用 + 增量）

- **基线（现有，原样保留）**：Asset、AssetCategory、DeviceTemplate、ComponentCategory、ComponentModel、ComponentStock、StockLog、Employee、Department、LifecycleLog、SystemLog、Stocktake*、Admin 等。
- **增量（一次迁移新增）**：

```prisma
model User { id Int @id @default(autoincrement()); username String @unique; password String; name String; email String?; isActive Boolean @default(true); mustChangePassword Boolean @default(false); mfaSecret String?; roles UserRole[]; sessions UserSession[]; notifications Notification[]; createdAt DateTime @default(now()) }
model UserSession { id Int @id @default(autoincrement()); userId Int; token String @unique; ip String?; userAgent String?; expiresAt DateTime; lastActiveAt DateTime @default(now()) }
model Role { id Int @id @default(autoincrement()); code String @unique; name String; permissions RolePermission[] }
model Permission { id Int @id @default(autoincrement()); code String @unique; name String; module String }
model UserRole { userId Int; roleId Int; @@id([userId, roleId]) }
model RolePermission { roleId Int; permissionId Int; @@id([roleId, permissionId]) }
model AuditLog { id BigInt @id @default(autoincrement()); userId Int?; action String; module String; detail String?; ip String?; createdAt DateTime @default(now()); @@index([module, createdAt]) }
model NotificationTemplate { id Int @id @default(autoincrement()); code String @unique; titleTemplate String; contentTemplate String }
model Notification { id Int @id @default(autoincrement()); userId Int; channel String @default("inapp"); type String; title String; content String?; link String?; isRead Boolean @default(false); readAt DateTime?; sentAt DateTime?; sendError String?; retryCount Int @default(0); createdAt DateTime @default(now()) }
model ApprovalFlow { id Int @id @default(autoincrement()); code String; name String; version Int @default(1); status String @default("draft"); nodes Json; edges Json; publishedAt DateTime?; updatedAt DateTime @updatedAt; @@unique([code, version]) }
model ApprovalInstance { id Int @id @default(autoincrement()); flowCode String; flowVersion Int; businessType String; businessId Int; businessSnapshot Json; status String; currentNode String?; submitterId Int; priority String @default("normal"); records ApprovalRecord[]; tasks ApprovalTask[]; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt }
model ApprovalRecord { id Int @id @default(autoincrement()); instanceId Int; nodeId String; approverId Int; action String; comment String?; createdAt DateTime @default(now()) }
model ApprovalTask { id Int @id @default(autoincrement()); instanceId Int; nodeId String; assigneeId Int; status String @default("PENDING"); dueAt DateTime?; notifiedAt DateTime?; completedAt DateTime? }
model AssetFinancial { id Int @id @default(autoincrement()); assetId Int @unique; originalValue Decimal; residualValue Decimal; depreciationMethod String; startDate DateTime; monthlyDepreciation Decimal }
model PurchaseRequest { id Int @id @default(autoincrement()); requestNo String @unique; title String; amount Decimal; status String; approvalInstanceId Int?; items Json; createdAt DateTime @default(now()) }
model Supplier { id Int @id @default(autoincrement()); name String; contact String?; phone String?; contracts Contract[] }
model Contract { id Int @id @default(autoincrement()); supplierId Int; title String; amount Decimal?; startDate DateTime; endDate DateTime; warrantyMonths Int?; attachments Json }
```

> 迁移纪律：只增不改；`Admin → User` 一次性脚本；大表加索引评审。

---

## 8. 一次性替换里程碑（M1–M6）

| 里程碑 | 内容 | 交付 | 验收 |
|--------|------|------|------|
| **M1 基座** | Monorepo 骨架（pnpm）；NestJS 启动 + 健康检查；Prisma 迁移（复用现有表 + 增量表）；Next.js + refine 装配（auth/dataProvider/accessControl）；Socket.io 网关就绪 | 新架构可登录、可跑通一个 demo 列表页 | 登录/列表/登出 OK；旧数据可读 |
| **M2 认证 + RBAC** | User/Role/Permission 管理与迁移（Admin→User）；`requirePermission` 服务端守卫；用户/角色管理页（refine） | 多账户、角色分配、无权限被拒 | 权限矩阵测试全绿 |
| **M3 资产核心域移植** | 12 模块业务逻辑从 `src/actions/*` 迁到 NestJS 模块；页面迁到 refine；Excel 导入导出；ECharts 报表 | 资产/配件/员工/分配/归还/调拨/维修/盘点/统计/设置/日志 全部可用 | **行为对照表逐项打勾**；对账脚本通过 |
| **M4 审批 + 拖拽** | 审批引擎（纯函数 + NestJS 服务）；React Flow 设计器；实例/任务/记录；接入报废/调拨/采购 | 拖拽发布 → 提交 → 多级审批 → 通过后执行业务 | 引擎单测 + 端到端手测 |
| **M5 实时通知** | Socket.io 推送 + 邮件/企微通道 + 模板 + BullMQ 队列；顶栏通知中心 | 审批/分配等实时通知、未读、跳转 | 双端实时收到；重试机制生效 |
| **M6 平台工程 + 业务增强** | 财务折旧、采购/合同/供应商、保修；MFA/SSO、会话管理；CI/CD、Sentry/Prometheus、安全基线、备份；PWA 扫码盘点、i18n；Swagger API 文档 | 企业级闭环 | 安全扫描通过；备份恢复演练；CI 全绿 |

---

## 9. 测试与质量体系

- **单测**：审批引擎、权限判定、折旧计算、编号生成（纯函数）。
- **组件**：refine 页面交互（jsdom，mock API）。
- **集成**：NestJS 模块测试 + 本地 MySQL（沿用 `vitest.config.ts` 模式或 jest 按 NestJS 惯例）。
- **E2E**：Playwright（登录 → 建资产 → 审批 → 通知）。
- **契约**：Swagger 自动生成 + zod DTO 前后端共享（`packages/shared`）。
- **覆盖率门槛**：核心域（引擎/权限/财务）≥ 80%，CI 强制。
- 旧分支测试套件作为**迁移验收基准**：新实现必须通过对应行为断言。

---

## 10. 安全基线（企业级）

1. 认证：argon2/bcrypt、登录失败锁定、MFA(TOTP)、会话轮换与强制下线。
2. 授权：服务端 `requirePermission` 强制校验（前端仅体验层）。
3. 输入：zod 全局 DTO 校验；Prisma 参数化（无 SQL 拼接）。
4. 传输：生产 HTTPS（nginx TLS 终止）。
5. 防护：CSRF（同源校验）、速率限制（@nestjs/throttler）、XSS 白名单。
6. 供应链：npm audit / Snyk 定期扫描。
7. 密钥：一律环境变量/密钥管理，不入库不入码。
8. 审计：AuditLog 只追加 + 摘要链。

---

## 11. 部署与运维

- **Docker Compose**：`web` + `api` + `worker` + `mysql` + `redis` + `nginx`（反向代理 + TLS 终止）。
- 健康检查端点（web/api）、Prometheus 指标、告警规则。
- 备份：每日逻辑备份 + 保留 30 天 + 月度恢复演练（脚本固化）。
- 规模化后可迁 K8s / 云托管（MySQL、Redis、对象存储）。

---

## 12. 风险与对策（含一次性替换特有风险）

| 风险 | 对策 |
|------|------|
| 一次性替换范围大、周期长 | 里程碑分批验收 + 行为对照表；旧分支 `legacy-v1` 全程兜底 |
| Server Actions → REST 迁移漏逻辑 | 以 actions 文件清单驱动迁移，每个 action 对应一个服务方法 + 测试 |
| refine dataProvider 学习成本 | M1 先跑通一个 demo 资源页验证装配，再铺开 |
| 审批通过 → 业务执行失败 | 同事务 + 补偿/重试 + 状态机幂等 |
| 拖拽画布复杂度过高 | M4 先顺序链 + 单人/会签，条件/并行 M5 后 |
| 数据迁移出错 | 只增不改 + 对账脚本 + 备份快照 |
| 局域网 HTTP 阶段安全弱 | 记录已知项，M6 上 HTTPS |

---

## 13. 建议新增 ADR（按项目惯例留痕）

- `0008-multi-user-rbac`（User 替代 Admin、权限点规范）
- `0009-approval-engine`（状态机、节点模型、业务钩子）
- `0010-real-time-websocket`（Socket.io 网关、通知可靠性）
- `0011-monorepo-nestjs`（一次性替换架构决策，推翻渐进式）
- `0012-refine-adoption`（headless 模式、dataProvider 对接 REST）
- `0013-legacy-freeze`（旧分支冻结与回退策略）

---

## 附：现有功能保留清单（迁移时逐项打勾）

- 设备管理（列表/筛选/详情/编辑/状态变更/导入导出）· 设备模板/BOM · 配件分类/型号/库存/流水 · 员工/部门（工号自动生成、部门可搜索下拉）· 分配/归还/调拨（同步设备名）· 维修/升级 · 库存盘点 · 统计报表 · 系统设置（标签打印）· 系统日志
- 近期迭代：首页模块切换 + 部门×分类图（分类筛选）、状态枚举中文、可搜索下拉、SimpleCrudDialog 修复
- 测试体系：TDD 双配置模式延续到新架构（14 个测试文件 41 用例作为迁移验收基准之一）
