# 审批流程配置页重构 & 发布版可管理化

## Context（背景）
当前 `/settings/workflows` 节点配置页的三个痛点：
1. **已发布流程不可管理**：后端 `guardDraft` 强制「发布版只读」，想改动只能手动开个空的新 DRAFT 重配所有节点（很繁琐）。
2. **节点配置繁琐**：流程 + 节点层级往返、字段多次切换下拉框。
3. **不支持拖拽排序**：只有上移/下移按钮。

目标：用 frontend-design 技能**推倒重排**该页布局与交互，并补齐「发布版管理」能力，同时**守住审批运行安全与既有回归测试**。

## 设计方向（frontend-design 美学）
- 延续项目既有「暖纸·精密台账」全局主题（`globals.css` 变量 / 松墨绿主色 + 铜点缀 + 衬线标题 + 细发丝边框），**不另起炉灶换皮肤**，只**重排结构与交互**。
- 视觉概念：**版本年鉴** —— 左侧版本轨道（DRAFT 草稿 / PUBLISHED 当前生效 / ARCHIVED 已归档，含状态徽标与时间），右侧节点顺序链可拖拽卡片式编辑区。年度感 + 台账精密度。

## 关键决策（回应用户四选 + 拖拽）
- ✅ **一键派生新版草稿**：对任意版本「复制为新版 DRAFT」（深拷贝节点配置），后续增删改排，再发布。
- ✅ **删除/清理草稿**：可删除 DRAFT 版本（后端守卫：仅 DRAFT 可删、非当前唯一可用真有效版）。
- ✅ **历史版本一键设为当前生效**：`activateWorkflowVersion` 将该版本置为 PUBLISHED（自动归档当前 PUBLISHED，保持「同类型仅一个 PUBLISHED」）。
- ✅ **"原地编辑已发布"→ 实现为自动派生**：用户编辑 PUBLISHED/ARCHIVED 时，前端自动先 `duplicate` 成新 DRAFT 再进入编辑（体验≈"能直接改"）。**线上 PUBLISHED 记录保持只读、不原地突变**（保证运行中审批稳定），服务端 `guardDraft` 一律保留 → 既有「发布后不可改」回归测试**保持全绿**。
- ✅ **顺序链列表拖拽 + 分组表单**（不引入可视化连线画布，符合既有「顺序链/无画布」约束）。

## 后端改动（src/actions/workflow.actions.ts）
复用现有 `guardPermission` / `businessTypeSchema` / `nodeInputSchema` / `guardDraft` / `maxNodeSeq`，新增三个 `export async function`：

1. `duplicateWorkflowDefinition(definitionId)` → 派生新版草稿
   - 读原 definition（含 nodes 全部配置：name/sortOrder/assignee*/multiMode/ccType/ccUserIds/ccRules/initiatorCanChoose）。
   - 版本号 = 该类 maxVersion + 1；status=DRAFT；createdById=user.id。
   - 深拷贝节点：重新生成 `nodeKey=n{i+1}`，`sortOrder=i`，`ccUserIds` 用 `JSON.stringify`、`ccRules` 用 `JSON.parse(JSON.stringify(...))` 落库（与现有写法一致）。
   - 返回 `{ id, name, version }`。

2. `removeWorkflowDraft(definitionId)` → 删除草稿
   - 守卫：仅 `status==="DRAFT"` 可删；若既是 DRAFT 又是该类唯一版本且无其他可查版本则拒绝（避免业务类型无任何版本）。
   - 级联删除 nodes（WorkflowNode 默认 onDelete? 需在实现时确认；若为无级联则手动先删 nodes 再删 definition）。

3. `activateWorkflowVersion(definitionId)` → 历史版本设为当前生效
   - 事务：同类型当前 `PUBLISHED` → `ARCHIVED`；目标版本若为 `ARCHIVED`/`DRAFT` 置 `PUBLISHED` + `publishedAt=new Date()`。
   - 守卫：目标版本存在；不可对已是 PUBLISHED 的版本重复激活（否则直接 `success` 返回，幂等）。

> 保持 `publishWorkflowDefinition`、`add/update/remove/reorder` 的 `guardDraft` 不变，不改任何发布只读断言。

## 前端改动（重排 /settings/workflows）
主文件：`src/app/(main)/settings/workflows/workflows-client.tsx`（重排），可按需拆组件同目录下：
- `version-rail.tsx`：版本轨道列表（每个版本：状态徽标 DRAFT/PUBLISHED/ARCHIVED、版本号、节点数、发布时间）。操作按钮按状态显示：PUBLISHED/ARCHIVED →「复制为新版本」「设为当前生效」「查看」；DRAFT →「编辑」「发布」「删除」。
- 选中版本后进入**节点顺序链编辑区**：
  - **拖拽排序**：列表项用原生 HTML5 `draggable`（不新增依赖，契合离线）实现上移/下移之外的手势拖拽；拖拽结束调用现有 `reorderWorkflowNodes`（后端已验证节点集合一致性）。空态/单节点禁用拖拽。
  - 编辑区顶部状态横幅：DRAFT「可编辑」/ PUBLISHED「当前生效·只读，点『复制为新版本』可改动」/ ARCHIVED「只读」。
  - 「编辑已发布」入口 = 自动触发 `duplicateWorkflowDefinition` 后切到新 DRAFT，Toast 提示「已基于 vX 创建新草稿 vY」。
- **节点表单分组化（消除繁琐）**：字段来自 `nodeInputSchema`。拆为两段折叠卡片 —— ①「审批人」：审批人类型(USER/ROLE/DEPT_MANAGER/EMP_MANAGER/INITIATOR/CUSTOM) + 依赖目标(指定账号/角色) + 可选「发起人可自选」+ 多人模式(ANY/ALL)；②「抄送」：抄送规则 ccRules 列表（类型下拉 + ROLE 选角色 + USER 填 id，可增删）。保留 `ccType/ccUserIds` 兼容旧数据。
- 恢复/复用之：`getWorkflowDefinitions`、`getWorkflowDefinition`、`publishWorkflowDefinition`、`reorderWorkflowNodes`、现有节点增删改 action 均维持调用。

## 测试（tests/workflow-config.test.ts，DB 测试）
- 新增用例：
  - duplicate：从 PUBLISHED/ARCHIVED/DRAFT 复制出正确版本号的新 DRAFT，节点数/配置深拷贝一致，且新旧版本互不影响。
  - removeWorkflowDraft：可删 DRAFT；非 DRAFT 被拒；删除唯一有效版本被拒。
  - activateWorkflowVersion：把旧版本设为当前生效，自动归档现行版；重复激活幂等；不存在的版本被拒。
  - “编辑已发布 = 自动派生”：模拟前端传 PUBLISHED 出手动改节点仍被 `guardDraft` 拒（回归不破坏）。
- 保留并确认既有「发布后新增/修改/删除/调序/重复发布均被拒」用例全绿。
- 前端 tests：若有 workflows-client 组件测试，同步更新；无则纯新增覆盖尽可少。

## 验证（Verification）
1. `npx tsc --noEmit` → 0 错。
2. `npm test`（vitest，dev/test 库迁移已就位）→ 全绿（DB 69+ 文件 / 前端）。
3. 手动断点校核：dev 库 `/settings/workflows`（须 `workflow.config.manage` 权限账号，如 admin）——
   - 对当前 PUBLISHED 版本「复制为新版本」→ 出现更高版本号 DRAFT 且节点已复制；
   - 在 DRAFT 里拖拽节点重排 → 保存后顺序变化、`ApprovalRequest` 未受影响；
   - 「设为当前生效」旧版本 → 确认当前生效徽标切换、原版自动归档；
   - 点「编辑」已发布版本 → 自动派生新草稿并进入编辑态。

## 注意事项
- 不新增 npm 依赖（拖拽用原生 HTML5）。
- 不推翻「同类型仅一个 PUBLISHED」「发布版只读防篡改」；所有新能力在既有不变式与回归之上叠加。