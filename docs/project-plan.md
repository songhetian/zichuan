# Asset Manager — 项目规划总览

> 本文档是 React 重写版资产管理系统的完整规划，基于 grilling 会话的全部决策。
> 原系统：Python + PySide6 + SQLite（见 `domain.md`）
> 新系统：Next.js + React + MySQL + Prisma + shadcn/ui

---

## 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 框架 | **Next.js 14+** (App Router) | 全栈框架，Server Components + Server Actions |
| UI | **React 18** + **shadcn/ui** + **Tailwind CSS** | 组件库 + 样式方案，完全可控 |
| 状态管理 | **Zustand** | 轻量客户端状态 |
| 数据获取 | **React Query (TanStack Query)** | 服务端状态缓存 |
| 表单校验 | **Zod** | Schema 校验 |
| 图表 | **ECharts** | 统计报表可视化 |
| 数据库 | **MySQL** | 关系型数据库 |
| ORM | **Prisma** | 类型安全的数据访问 + 迁移管理 |
| 认证 | 单用户简单登录 | 一个 admin 账号，无权限系统 |
| Excel | SheetJS (xlsx) | 导入导出 |
| 语言 | **TypeScript** | 全栈类型安全 |

---

## 2. 功能模块清单（11 个核心模块）

| # | 模块 | 核心功能 | 优先级 |
|---|------|----------|--------|
| 1 | 设备管理 | 设备列表、搜索筛选、详情、编辑、状态变更 | P0 |
| 2 | 设备模板管理 | 模板 CRUD、配件 BOM 定义、按模板批量生成设备 | P0 |
| 3 | 配件库存管理 | 分类管理、型号管理、入库出库、库存流水 | P0 |
| 4 | 员工管理 | 员工 CRUD、部门管理、搜索筛选 | P0 |
| 5 | 分配管理 | 单台/批量分配、按模板生成分配、从设备池分配 | P0 |
| 6 | 归还管理 | 单台/批量归还、查看员工在用设备 | P0 |
| 7 | 调拨管理 | 单台/批量调拨、直接转使用人 | P1 |
| 8 | 升级维修 | 配件更换、旧配件回库、维修记录 | P1 |
| 9 | 库存盘点 | 创建盘点任务、手动标记、盘盈盘亏报表 | P1 |
| 10 | 统计报表 | 状态/分类/部门/员工/配件维度统计 + 流转趋势 | P1 |
| 11 | 系统设置 | 部门/分类/账号管理、标签打印、数据导入导出 | P1 |
| 12 | 系统日志 | 重要操作审计记录 | P2 |

**不做的功能**：仪表盘、设备图片上传、折旧计算、二维码。

---

## 3. 领域模型

### 3.1 核心实体关系

```
ComponentCategory (配件分类, 两级)
    └── ComponentModel (配件型号)
            └── ComponentStock (库存) + StockLog (库存流水)

AssetCategory (设备分类, 两级)
    └── DeviceTemplate (设备模板/BOM)
            └── TemplateComponent (模板配件清单)
                    ↓ 按模板生成
Asset (设备实体)
    ├── AssetComponent (设备当前配件)
    ├── LifecycleLog (生命周期履历)
    ├── MaintenanceRecord (维修升级记录)
    └── AssetStatus (闲置/在用/维修中/报废)

Department (部门)
    └── Employee (员工)

StocktakeSession (盘点任务)
    └── StocktakeRecord (盘点明细)

SystemLog (系统日志)
Admin (管理员, 单用户)
```

### 3.2 设备编号规则

格式：`{分类前缀}-{4位自增序号}`

示例：
- 计算机设备 → DN-0001
- 网络设备 → WL-0001
- 办公设备 → BG-0001

分类前缀由设备分类的编码字段决定，可配置。

### 3.3 设备状态机

```
  闲置 (Idle)
    ↑    ↓
    └────── 在用 (In Use)
    ↑         ↑
    │         │
维修中 (In Maintenance)
    │
    ↓
  报废 (Scrapped) ← 任何状态都可直接报废
```

关键流转动作：
- **分配 (Allocation)**：闲置 → 在用
- **归还 (Return)**：在用 → 闲置
- **调拨 (Transfer)**：在用 → 在用（换使用人）
- **送修**：闲置/在用 → 维修中
- **维修完成**：维修中 → 闲置
- **报废 (Scrap)**：任何状态 → 报废

---

## 4. 关键业务规则

### 4.1 分配

- 两种分配方式：
  1. **从设备池分配**：选择闲置设备，分配给员工
  2. **按模板生成分配**：选择设备模板和数量，生成新设备并直接分配（扣减配件库存）
- 支持批量分配：一次分配多种设备给同一个员工
- 分配时自动生成生命周期记录
- 分配后设备状态 = 在用，user_id = 员工ID

### 4.2 归还

- 支持批量归还：选择员工，勾选其在用设备，批量归还
- 归还后设备状态 = 闲置，user_id = NULL
- 设备实体保留，配置不变
- 归还时记录归还备注

### 4.3 调拨

- 支持批量调拨：选择多台设备，一次性转给同一个员工
- 不走归还再分配，直接修改 user_id
- 记录调拨履历

### 4.4 升级/维修

- 选择设备，查看当前配件配置
- 替换配件：选择新配件型号，扣减库存
- 旧配件自动回库（增加对应配件型号的库存）
- 记录维修/升级日志（类型、内容、日期）
- 设备的模板归属不变，但实际配置以当前配件为准

### 4.5 报废

- 任何状态的设备都可以报废
- 报废后状态 = 报废，不再出现在设备池可用列表中
- 设备记录永久保留
- 配件不自动回库（报废设备的配件状态不确定）

### 4.6 配件库存

- 入库来源：采购入库、升级退回
- 出库去向：组装设备、升级替换
- 库存流水记录每一次变动
- 库存不足时阻止操作（有明确提示）

### 4.7 盘点

- 创建盘点任务，可按分类/部门/状态筛选范围
- 系统列出范围内的所有设备
- 手动标记每台设备：正常 / 盘亏 / 盘盈（盘盈需手动添加）
- 完成盘点后生成盘盈盘亏报表
- 盘点结果不自动修改设备数据，仅作记录

### 4.8 系统日志

- 记录重要操作：分配、归还、调拨、报废、升级、入库
- 不记录查询类操作
- 日志内容：操作人（admin）、时间、模块、动作、详情

---

## 5. 页面结构

```
/login                    登录页
/assets                   设备列表（设备池，支持按状态/分类/部门筛选）
/assets/new               新增设备（单台/批量，从模板生成）
/assets/[id]              设备详情（基本信息 + 配置 + 履历 + 操作）
/templates                设备模板列表
/templates/new            新建模板
/templates/[id]           模板详情/编辑
/components               配件库存总览
/components/categories    配件分类管理
/components/models        配件型号管理
/components/stock         库存流水
/employees                员工列表
/employees/new            新增员工
/employees/[id]           员工详情（含在用设备）
/allocation               分配中心（分配/归还/调拨 Tab）
/allocation/new           新建分配单
/return                   归还
/transfer                 调拨
/stocktake                盘点任务列表
/stocktake/new            新建盘点
/stocktake/[id]           盘点详情/操作
/stats                    统计报表
/settings                 系统设置
  /departments            部门管理
  /asset-categories       设备分类管理
  /labels                 标签打印
  /import-export          数据导入导出
  /account                账号设置
/logs                     系统日志
```

---

## 6. 项目目录结构

```
asset-manager/
├── prisma/
│   ├── schema.prisma         # 数据库模型
│   └── migrations/           # 迁移文件
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── layout.tsx        # 根布局（侧边栏 + 内容区）
│   │   ├── page.tsx          # 首页（重定向到 /assets）
│   │   ├── login/
│   │   ├── assets/
│   │   ├── templates/
│   │   ├── components/       # 配件库存
│   │   ├── employees/
│   │   ├── allocation/
│   │   ├── stocktake/
│   │   ├── stats/
│   │   ├── settings/
│   │   └── logs/
│   ├── components/           # 公共 UI 组件
│   │   ├── ui/               # shadcn/ui 组件
│   │   ├── layout/           # 布局组件（Sidebar、Header 等）
│   │   └── features/         # 业务组件
│   ├── lib/                  # 工具函数
│   │   ├── prisma.ts         # Prisma 客户端单例
│   │   ├── auth.ts           # 认证相关
│   │   └── utils.ts          # 通用工具
│   ├── store/                # Zustand stores
│   ├── types/                # TypeScript 类型定义
│   ├── actions/              # Server Actions（按模块组织）
│   │   ├── asset.actions.ts
│   │   ├── component.actions.ts
│   │   ├── employee.actions.ts
│   │   └── ...
│   └── hooks/                # 自定义 React Hooks
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── next.config.js
```

---

## 7. 命名规范

- **代码命名**：英文，驼峰式（camelCase）
- **数据库表名**：英文，蛇形式（snake_case），复数
- **组件名**：PascalCase
- **文件命名**：
  - 页面/组件：`kebab-case.tsx`（Next.js App Router 约定）
  - 工具函数：`camelCase.ts`
- **展示文字**：中文
- 项目名：`asset-manager`

---

## 8. 开发优先级建议

**第一阶段（核心功能）**：
1. 项目初始化 + Prisma schema + 数据库
2. 登录 + 布局框架
3. 配件分类 + 型号 + 库存管理
4. 设备分类 + 模板管理
5. 员工管理 + 部门管理
6. 设备管理（设备池 + 详情）

**第二阶段（流转功能）**：
7. 分配（按模板生成 + 从设备池分配 + 批量）
8. 归还（批量）
9. 调拨（批量）
10. 升级维修
11. 报废

**第三阶段（辅助功能）**：
12. 盘点
13. 统计报表 + ECharts
14. 系统日志
15. 标签打印
16. Excel 导入导出
17. 系统设置页面整合

---

*生成于 grilling 会话，共 20 轮决策确认。*
