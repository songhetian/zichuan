# 多用户在线审批流改造方案 v1（渐进式）

> **决策状态**：已确认（2026-09-19，grilling 逐项确认）
> **路线**：渐进式改造，沿用现有 Next.js + Server Actions + Prisma + MySQL 架构，不做整体替换。
> **关联草案**：[prisma/approval-flow.draft.prisma](../prisma/approval-flow.draft.prisma)（数据模型蓝本，本方案基于它落地）

---

## 1. 背景与目标

当前系统为**单人操作**的本地应用（单管理员账号，无角色权限、无审批流、无实时通知）。目标改造为**在线多用户**系统：

- 全员可登录（142 名员工都有账号）
- 审批流：申请 → 逐节点审批（通过/拒绝）→ 全部通过后自动执行业务动作
- 每个节点产生**通知**，并支持**抄送**（只读知会，不参与审批）
- 实时性：Socket.io 站内推送 + toast 链接跳转

首批只接入一种业务：**申请升级配件**（跑通全链路后再横向扩展）。

## 2. 关键决策记录（本版已确认）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 改造路线 | **渐进式**：现有架构上加审批流，不换框架、不动现有 12 模块 |
| 2 | 技术栈 | 只新增 **Socket.io**；react-query/zod/radix-toast 已具备；**不引入 Redis**（数据量小） |
| 3 | 节点配置方式 | **简单顺序审批链**：后台表单/列表配置节点顺序，不用 React Flow 画布 |
| 4 | 审批人解析 | **组织动态解析**：先补齐部门主管数据（`Department.managerId`），节点按「部门主管/角色/指定人」解析 |
| 5 | 权限模型 | **可配置权限点**（Role/Permission 三表），默认内置四角色：超管/资产管理员/部门主管/普通员工 |
| 6 | 抄送 | **节点级配置抄送**（固定人/部门主管/直属主管），发起人无需自选 |
| 7 | 首批业务 | 仅「申请升级配件」；后续业务扩展枚举即可 |
| 8 | 驳回策略 | **驳回即终态 REJECTED**，发起人改单重新提交走新流程 |
| 9 | 通知渠道 | **站内通知 + Socket.io 实时推送**；不接邮件/企微/飞书 |
| 10 | 默认流程模板 | 员工 → 部门主管 → 资产管理员 → 自动执行；节点可增删；支持多版本流程切换 |

## 3. 目标架构（渐进式叠加）

```
现有 Next.js 应用（保留全部 12 模块）
├─ src/actions/approval.*.ts    # 审批流 Server Actions（新）
├─ src/lib/socket.ts            # Socket.io 服务端（新，独立端口或同 server）
├─ src/components/approval/     # 审批前端：发起/待办/已办/流程配置（新）
├─ src/components/notification/ # 顶栏通知中心 + toast 跳转（新）
└─ prisma/schema.prisma         # 现有 schema + 审批增量表（一次迁移）
```

- **认证**：现有 iron-session 保留，Admin 表扩展多账号。
- **实时**：Socket.io 推送通知事件（待办/审批结果/抄送），toast 点击跳转申请单详情。
- **数据**：复用现有 Prisma schema 为基线，只增不改（7 新表 + 9 新列 + 4 枚举扩展，均无破坏性变更，已用 `prisma migrate diff` 实测）。

## 4. 数据模型改动（落地草案）

以 [approval-flow.draft.prisma](../prisma/approval-flow.draft.prisma) 为蓝本，本次落地：

**组织底座（审批人解析前提）**
- `Department.managerId`（新增，部门主管）
- `Employee.managerId`（新增，直属主管，自关联）
- `Admin`：新增 `role`、`employeeId`（关联员工档案）、`displayName`、`isActive`
- `AdminRole` 枚举：`SUPER_ADMIN / ASSET_MANAGER / DEPT_MANAGER / EMPLOYEE`

**可配置权限点（决策 5）**
- `Role`、`Permission`、`RolePermission` 三张表；Admin 通过角色关联权限点
- 默认种子：四角色 + 权限矩阵

**流程定义（支持多版本切换，决策 10）**
- `WorkflowDefinition`：`businessType` + `version` 唯一；`status`（DRAFT/PUBLISHED/ARCHIVED）；同一业务类型可有多套配置，**管理员切换当前生效版本**（新申请单用生效版，在途单仍按提交时版本）
- `WorkflowNode`：顺序审批链节点，`assigneeType`（USER/ROLE/DEPT_MANAGER/EMP_MANAGER/INITIATOR/CUSTOM）+ `multiMode`（ANY/ALL）+ `rejectPolicy`
- `WorkflowEdge`：顺序连线

**审批运行**
- `ApprovalRequest`：申请单，绑定流程**版本**；`payload` 存业务快照（assetId/新配件/理由）；状态 DRAFT/PENDING/APPROVED/REJECTED/CANCELLED
- `ApprovalTask`：待办（`assigneeId + status=PENDING` 即「我的待办」）
- `ApprovalLog`：流转时间线（SUBMIT/APPROVE/REJECT/CANCEL/EXECUTE/EXECUTE_FAILED）

**通知**
- `Notification`：站内通知，`type`（APPROVAL_TODO/APPROVAL_RESULT/APPROVAL_CC/SYSTEM），`linkUrl` 跳转申请单详情，`isRead` 未读红点

**现有表小改**
- `Asset.reservedByRequestId`（新增，审批期间预占资产防冲突）
- `AssetStatus.RESERVED`（追加枚举值）
- `LifecycleLog.operatorId` + `requestId`（新增，操作可追溯）

> ⚠️ 迁移后必须执行：`UPDATE Admin SET role = 'SUPER_ADMIN' WHERE id = 1;`（否则超管被锁在外面）。

## 5. 审批引擎语义

### 5.1 默认流程模板（升级配件）

```
[员工提交] → [部门主管审批] → [资产管理员审批] → [自动执行]
                ↑ 抄送：发起人本人 + 资产管理员
```

- 节点与顺序由超管在后台配置，**可增可减**
- 审批人自动解析（按申请人部门主管/角色），无需手选
- 每个节点流转时：通知当前节点审批人 + 抄送对象（toast 实时 + 站内未读）

### 5.2 流转控制

- **通过**：当前节点通过 → 生成下一个节点任务并通知 → 最后一个节点通过 → 状态 APPROVED → 触发业务执行
- **拒绝**：任一节点拒绝 → 申请单终态 REJECTED → 通知发起人 → 发起人可改单重提（新流程）
- **多版本切换**：管理员在流程配置页发布/切换生效版本；在途单不受影响

### 5.3 通过后自动执行（升级配件业务）

复用现有升级逻辑（[src/actions/](../../src/actions/) 升级相关 action）：
1. 扣减新配件库存
2. 旧配件回库
3. 更新设备配置（AssetComponent）
4. 写 LifecycleLog（带 operatorId + requestId 追溯）

同事务执行，失败记 `EXECUTE_FAILED` 供人工介入。

## 6. 权限矩阵（默认种子）

| 权限 | 超管 | 资产管理员 | 部门主管 | 普通员工 |
|------|:---:|:---:|:---:|:---:|
| 账号/角色/权限管理 | ✅ | | | |
| 流程配置（节点/版本/切换） | ✅ | | | |
| 资产/配件/库存全权 | ✅ | ✅ | | |
| 本部门数据可见 | ✅ | ✅ | ✅ | |
| 提交申请 | ✅ | ✅ | ✅ | ✅ |
| 审批（按流程节点） | ✅ | ✅ | ✅（部门主管节点） | |
| 查看本人资产/申请单 | ✅ | ✅ | ✅ | ✅ |

## 7. 实时通知方案

- **Socket.io**：服务端单例挂载，事件 `approval.todo` / `approval.result` / `approval.cc`
- 前端：Socket 客户端连接 → 收到事件 → 弹出 **toast（带链接跳转）** + 顶栏未读红点 +1
- 离线用户：登录时拉取未读通知补齐
- 不引入 Redis/BullMQ（通知低频、数据量小，内存即可）

## 8. 实施里程碑

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| M1 组织底座 | 迁移 7 新表 + 9 新列 + 枚举；补齐部门主管数据；Admin 多账号 + 角色 + 关联员工 | 全员可登录；`migrate diff` 0 破坏 |
| M2 权限 | Role/Permission 种子 + 服务端权限校验 + 用户/角色管理页 | 无权限被拒；权限矩阵测试全绿 |
| M3 流程配置 | 流程定义/节点/版本管理页 + 切换生效版本 | 超管可增删节点、切换配置 |
| M4 审批引擎 | 提交申请 / 待办 / 审批通过/拒绝 / 时间线 | 引擎单测 + 端到端手测 |
| M5 通过后执行 | 升级配件业务执行（扣库存/回旧件/更新配置）+ 预占锁 | 审批通过后资产配置自动变更 |
| M6 实时通知 | Socket.io + toast 跳转 + 顶栏通知中心 + 抄送 | 双端实时收到；未读/跳转正常 |

## 9. 测试策略

- 新增测试沿用现有 TDD 双配置（`vitest.config.ts` / `vitest.frontend.config.ts`）
- 审批引擎纯函数单测（节点推进、驳回、版本切换）
- 权限判定单测
- 通过后执行集成测试（本地 MySQL 测试库）
- 现有 54 个测试文件全部保留，作为回归基线

## 10. 明确不做（本版范围外）

- ❌ 不引入 NestJS / refine / Redis / BullMQ / monorepo
- ❌ 不做 React Flow 拖拽画布（顺序链表单配置即可）
- ❌ 不接邮件 / 企微 / 飞书通知
- ❌ 不接领用/归还/报废审批（后续扩展）
- ❌ 不做条件分支 / 会签 / 加签 / 委托（后续扩展）
