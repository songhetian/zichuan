# domain.md — 资产管理系统 领域与规范文档

> 本文件是项目的**权威领域与规范文档**。原始需求见 `功能.txt`，技术实现见 `src/`。
> 本文件与原始开发文档共同构成后续所有**诊断 / 重构 / 优化**的**唯一标准**。

---

## 0. 最高约束（治理规则 — 用户明确要求）

1. **唯一标准**：后续所有诊断、重构、优化操作，必须严格以本文件 + 原始开发文档（`功能.txt`、代码注释、建表语句）为唯一依据。
2. **文档高于代码**：当**代码与文档（含本文件、建表语句、注释）冲突**时，**以文档为准**，不得按代码意图擅自"修正"文档。
3. **禁止私自变更**：未经用户明确确认，不得修改以下三类内容：
   - 业务逻辑（状态流转、库存扣减、编号生成等规则）
   - 数据库表结构（表、字段、类型、约束、索引）
   - 接口出入参（DBManager 公开方法的参数与返回结构、UI 信号契约）
4. **偏离须确认**：任何与上述任一条冲突的改动，必须先向用户说明并获确认后再执行。

---

## 1. 项目概述

- **名称**：资产管理系统（资产数字化管理平台 / 企业电子设备资产管理平台）
- **定位**：公司内部**电子设备固定资产**的全生命周期管理桌面软件
- **目标形态**：Python 桌面应用，最终**打包为独立可执行程序**部署
- **界面范式**：左右分栏 —— 左侧导航菜单（固定宽 240），右侧内容区（`QStackedWidget`）
- **原始需求文档**：`功能.txt`（技术栈、界面、6 大功能模块要求）

---

## 2. 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 开发语言 | Python 3 | 依赖见 `requirements.txt` |
| 界面框架 | PySide6 | Qt6 绑定，QWidget/QMainWindow/QDialog |
| 数据库 | SQLite | 单文件库 `data/zichan.db`，启用 **WAL** 模式 |
| 表格/导出 | pandas + openpyxl | `get_assets_for_export()` 导出 xlsx |
| 拼音检索 | pypinyin | `PinyinComboBox` 支持中文/拼音首字母联想 |
| 二维码 | qrcode + pillow | 资产标签生成（`QRGenerator`） |
| 日志 | logging + RotatingFileHandler | `logs/app.log`，5MB×3 轮转 |
| 部署 | 打包为独立桌面应用 | 需求要求；具体打包工具未在当前代码中体现 |

**视觉规范**：主色 `#1890ff`（Ant Design 蓝），辅助色 绿 `#52c41a`、橙 `#fa8c16`、红 `#f5222d`；全局字体 "Microsoft YaHei"；QSS 集中在 `MainWindow.apply_styles()`。

---

## 3. 分层规范（架构与目录约定）

```
main.py                      # 入口：QApplication → LoginWindow →(login_success)→ MainWindow
src/config.py                # 常量层：DB 路径、窗口尺寸、标题/版本、样式
src/database/db_manager.py   # 数据访问层（DAL）：唯一允许出现 SQL 的地方
src/utils/                   # 工具层（无业务状态）
  ├─ logger.py               #   setup_logging()
  ├─ pagination.py           #   PaginationWidget（通用分页组件）
  ├─ pinyin_combo.py         #   PinyinComboBox（拼音联想下拉）
  └─ qr_generator.py         #   QRGenerator（资产标签）
src/ui/
  ├─ login_window.py         # 登录窗（QWidget，发出 login_success 信号）
  ├─ main_window.py          # 主窗（QMainWindow：侧栏导航 + 内容栈 + 5s 刷新 + 安全校验）
  └─ pages/                  # 业务页（每页一个 QWidget）
```

**分层规则（必须遵守）**：
- **DAL 唯一性**：所有 SQL 与事务集中在 `DBManager`；UI 层**不得**直接写 SQL（少数页面为取详情用 `get_connection()` 做只读 `SELECT *` 属例外，重构时应收敛回 DAL）。
- **每页自持连接**：各 `Page` 自行 `DBManager()` 实例化，按需 `get_connection()`；无全局单例/连接池。
- **页面契约**：每个 `Page` 在 `__init__` 中 `init_ui()` + `load_data()`；须实现 `refresh_data()`（被主窗口 5s 定时器与切页调用）；表格统一用 `QStandardItemModel` 或自定义 `QAbstractTableModel`；分页统一用 `PaginationWidget`（page_size 默认 20）；增改用 `QDialog`。
- **命名约定**：DAL 方法以 `get_/add_/update_/delete_/change_/checkout_/return_/batch_` 等动词前缀；返回布尔表示成败。

---

## 4. 数据库表结构（权威 = 当前磁盘 schema：`data/zichan.db`）

> ⚠️ **磁盘实际 schema 与 `db_manager.init_db()` 的建表语句已漂移**（见 §10）。下表以**磁盘真实结构**为准，因为 `CREATE TABLE IF NOT EXISTS` 不会修正已有库。

### 4.1 基础字典表
| 表 | 字段 | 类型/约束 | 说明 |
|----|------|-----------|------|
| `categories` | id | INTEGER PK AUTOINCREMENT | 资产分类 |
| | name | TEXT NOT NULL **UNIQUE** | 分类名（电脑/服务器/…） |
| | parent_id | INTEGER FK→categories(id) | 预留层级；**当前 UI 未使用** |
| `departments` | id | INTEGER PK | 部门 |
| | name | TEXT NOT NULL UNIQUE | 部门名 |

### 4.2 核心业务表
| 表 | 字段 | 类型/约束 | 说明 |
|----|------|-----------|------|
| `employees` | id | INTEGER PK | 员工 |
| | emp_no | TEXT UNIQUE | 工号（自动生成 `EMP+yyyymmdd+4位`） |
| | name | TEXT NOT NULL | 姓名 |
| | dept_id | INTEGER FK→departments(id) | 部门（可空） |
| | contact | TEXT | 联系方式 |
| | status | TEXT DEFAULT '在职' | 在职 / 离职 |
| `assets` | id | INTEGER PK | 资产 |
| | asset_no | TEXT UNIQUE | 资产编号（缺省 `ZC+yymymmddHHMMSS`） |
| | name | TEXT NOT NULL | 设备名称 |
| | model | TEXT | 型号 |
| | **sn** | TEXT UNIQUE | 序列号（**init_db 缺失该列**） |
| | brand | TEXT | 品牌 |
| | spec | TEXT | 配置摘要（由配件汇总生成） |
| | category_id | INTEGER FK→categories(id) | 分类 |
| | dept_id | INTEGER FK→departments(id) | 归属部门 |
| | user_id | INTEGER FK→employees(id) | 当前使用人（闲置/报废时为 NULL） |
| | location | TEXT | 物理存放地点 |
| | status | TEXT DEFAULT '闲置' | 在用/闲置/维修/报废 |
| | purchase_date | DATE | 采购日期 |
| | **price** | REAL | 单价（**init_db 缺失该列**） |
| | **image_path** | TEXT | 图片路径（**init_db 缺失该列**） |
| | remarks | TEXT | 备注 |
| `lifecycle_logs` | id | INTEGER PK | 流转履历 |
| | asset_id | INTEGER FK→assets(id) | |
| | op_type | TEXT NOT NULL | 领用 / 归还（注释另有 调拨/报废，未实现） |
| | operator | TEXT | 操作员 |
| | target_user_id | INTEGER FK→employees(id) | 关联员工 |
| | op_date | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |
| | remark | TEXT | |
| `maintenance_records` | id | INTEGER PK | 维修/升级记录 |
| | asset_id | INTEGER FK→assets(id) | |
| | type | TEXT | 实际存**变更性质原文**（配置升级/维修替换/…） |
| | content | TEXT | 变更内容 |
| | cost | REAL | 成本（**当前 UI 未写入**） |
| | date | DATE | |

### 4.3 配件库存表
| 表 | 字段 | 类型/约束 | 说明 |
|----|------|-----------|------|
| `component_models` | id | INTEGER PK | 配件型号 |
| | type_name | TEXT | CPU/内存/硬盘/显卡/主板/其他 |
| | model_name | TEXT NOT NULL | |
| | brand | TEXT | |
| | UNIQUE(type_name, model_name) | | |
| `component_stock` | id | INTEGER PK | 库存余量 |
| | model_id | INTEGER FK→component_models(id) | |
| | quantity | INTEGER DEFAULT 0 | |
| `component_stock_logs` | id | INTEGER PK | 库存流水 |
| | model_id | INTEGER FK | |
| | op_type | TEXT | 采购入库（正）/ 设备领用（负） |
| | quantity | INTEGER | 正为入库，负为消耗 |
| | operator / op_date / remark | | |
| `asset_components` | id | INTEGER PK | 资产已装配件 |
| | asset_id | INTEGER FK→assets(id) | |
| | comp_name | TEXT | 配件类型 |
| | comp_spec | TEXT | 型号摘要 |
| `category_components` | id | INTEGER PK | 分类配件模板 |
| | category_id | INTEGER FK | |
| | component_name | TEXT | |
| | default_quantity | INTEGER DEFAULT 1 | |

### 4.4 对账 / 系统表
| 表 | 字段 | 类型/约束 | 说明 |
|----|------|-----------|------|
| `stocktake_sessions` | id | INTEGER PK | 盘点任务 |
| | name | TEXT NOT NULL | |
| | start_date | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |
| | status | TEXT DEFAULT '进行中' | 进行中 / 已完成 |
| `stocktake_records` | id | INTEGER PK | 盘点明细 |
| | session_id | INTEGER FK→stocktake_sessions(id) | |
| | asset_no | TEXT | |
| | status | TEXT | 正常 / 盘盈 / 盘亏 |
| | scan_date | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | |
| `users` | id | INTEGER PK | 系统账号 |
| | username | TEXT UNIQUE NOT NULL | |
| | password | TEXT NOT NULL | **明文存储** |
| | role | TEXT DEFAULT 'admin' | super（内置）/ admin |
| `system_logs` | id | INTEGER PK | 操作日志 |
| | op_date | TIMESTAMP | |
| | operator / module / op_type / detail | TEXT | 见 §8 |

**索引（磁盘存在，init_db 未建）**：`idx_asset_no`、`idx_asset_name`、`idx_asset_status`、`idx_emp_name`。

---

## 5. 统一返回格式 / 接口规范

本系统为**桌面应用，无 HTTP 接口**。这里的"接口"指 **DAL 公开方法契约**与 **UI 信号契约**。

### 5.1 DBManager 方法返回约定（统一格式）
| 方法类别 | 返回结构 | 示例 |
|----------|----------|------|
| 命令/写操作 | `True`（成功）/ `False`（失败） | `add_asset`、`checkout_asset`、`update_asset_components_batch` |
| 批量导入 | `(成功条数, [])` | `batch_import_assets` |
| 普通查询 | `tuple` 行 / `list[tuple]` | `get_departments`、`get_categories` |
| 分页查询 | `(total:int, rows:list[tuple])` | `get_all_assets`、`get_all_employees`、`get_system_logs` |
| 单值 | 标量或 `0`/`None` | `get_model_stock` |

### 5.2 错误处理约定（无数字错误码）
- DAL 内部 `try/except` → `logging.error(...)` → 返回 `False`/`None`；
- UI 层以 `QMessageBox` 反馈：`critical`（失败/错误）、`information`（成功）、`warning`（前置校验不通过）；
- **不存在**统一的错误码枚举或异常类型体系。

### 5.3 Qt 信号契约（跨组件接口）
| 信号 | 定义处 | 参数 | 用途 |
|------|--------|------|------|
| `login_success` | `LoginWindow` | `str`（用户名） | 登录成功 → 打开主窗 |
| `page_changed` | `PaginationWidget` | `int`（offset） | 翻页 |
| `view_all_logs` | `DashboardPage` | — | 跳转系统日志页 |
| `jump_to_page_with_filter` | `MainWindow` | `(key, filter_text)` | 跨页带筛选跳转（统计→资产） |

### 5.4 DBManager 公开方法清单（接口出入参，禁止擅自改）
- **资产**：`get_all_assets(kw,did,limit,offset,order_col,order_dir)`、`add_asset(dict,op)`、`update_asset(aid,dict,op)`、`change_asset_status(aid,ns,op,rem)`、`checkout_asset(aid,eid,op,rem)`、`return_asset(aid,op,rem)`、`get_asset_resume(aid)`、`get_assets_for_export()`、`get_asset_stats_detailed()`
- **员工**：`get_all_employees(kw,did,status,limit,offset,order_col,order_dir)`、`generate_emp_no()`
- **配件**：`get_all_component_models(type_name)`、`add_component_model(t,m,b)`、`add_component_stock(mid,qty,op,rem)`、`get_component_stock_logs(kw)`、`get_model_stock(mid)`、`get_category_components(cid)`、`update_category_components(cid,data)`、`get_asset_components(aid)`、`update_asset_components_batch(aid,list,op,change_type)`
- **流转/对账**：`get_recent_activity(limit)`、`get_dashboard_stats()`、`get_config_history(kw,limit,offset)`、`get_system_logs(u,m,k,l,o)`
- **系统/管理员**：`log_action(op,mod,typ,det)`、`validate_user(u,p)`、`get_all_admins()`、`add_admin(u,p)`、`delete_admin(uid)`、`update_admin(uid,u,r)`、`update_admin_password(uid,pwd)`、`add_department(n)`、`delete_department(did)`、`add_category(n)`、`delete_category(cid)`

---

## 6. 错误码

> 本系统**无数字/字符串错误码体系**（桌面应用，无 API 层）。故障以"布尔返回 + 日志 + 弹窗"表达。

| 失败场景 | 表现 |
|----------|------|
| 增/删/改 SQL 异常 | DAL 返回 `False`；多数 UI 不显式提示（少数提示"保存失败"） |
| 配件库存不足 / DB 错误 | `update_asset_components_batch` 返回 `False` → 弹窗"保存失败，可能是库存不足或数据库错误" |
| 入库数量非整数 | `AddStockDialog` `try/except` → 弹窗"请输入有效的数字数量" |
| 登录凭据错误 | 弹窗"用户名或密码错误" |
| 当前账号在 DB 中被删 | 主窗 5s 轮询检测到 → 弹窗"安全警报：账号已失效！"并关闭 |
| 前置业务校验不通过 | `QMessageBox.warning`（如"请先选择闲置资产""禁止分配"） |

---

## 7. 校验规则

校验集中在 **UI 层**（DAL 仅做数据库约束/外键）。逐项：

| 对象 | 规则 |
|------|------|
| 资产入库 | `name` **必填**；`asset_no` 可空（缺省自动生成）；`status` 默认 `闲置` |
| 资产编辑 | 可改 `name/model/location/remarks`；`sn/brand/price/image_path` **当前 UI 不维护** |
| 员工 | `name` 必填；`status ∈ {在职, 离职}`；`dept_id` 可空；`emp_no` 自动生成 |
| 配件型号 | `model_name` 必填；`type_name ∈ {CPU, 内存, 硬盘, 显卡, 主板, 其他}` |
| 配件入库数量 | 必须为整数（非整数拒绝） |
| 领用分配 | **仅 `status=闲置` 可分配**；否则提示"禁止分配" |
| 状态手动变更 | 目标 `∈ {闲置, 维修, 报废}`；当前 `=在用` 时强制归入 `闲置` |
| 删除部门 | 存在关联员工则**禁止**（`delete_department` 返回 False） |
| 删除分类 | 存在关联资产则**禁止**（`delete_category` 返回 False） |
| 删除管理员 | `username='admin'` **受保护**，不可删 |
| 登录 | `username + password` 明文比对 |

---

## 8. 业务约束（领域规则 — 禁止擅自改）

### 8.1 资产状态机（四态）
`在用` / `闲置` / `维修` / `报废`

| 动作 | 状态变化 | 附带写操作 |
|------|----------|------------|
| 领用 `checkout_asset` | → `在用`，`user_id=领用人` | 写 `lifecycle_logs(op_type='领用')` |
| 归还 `return_asset` | → `闲置`，`user_id=NULL` | 写 `lifecycle_logs(op_type='归还')` |
| 手动变更 `change_asset_status` | → 目标态 | **`user_id` 强制置 NULL**（无论目标） |

### 8.2 配件变更与库存
- 变更性质：`配置升级` / `配置降级` / `维修替换` / `初始录入`
- **库存扣减规则（非对称，务必注意）**：仅当 `change_type ∈ {配置升级, 维修替换}` 时，扣减 `component_stock` 并写 `component_stock_logs(op_type='设备领用', quantity 为负)`；
  `配置降级` / `初始录入` **不扣减，也不回补库存**。
- `maintenance_records.type` 实际存入**变更性质原文**（可能含"配置升级/维修替换/配置降级/初始录入"），与表注释"维修/升级"**不一致**。

### 8.3 编号生成规则
- 资产编号：缺省 `ZC` + `datetime.strftime('%y%m%d%H%M%S')`（14 位时间戳）
- 工号：`EMP` + 当日 `yyyymmdd` + 4 位当日自增序号

### 8.4 账号与权限
- 角色：`super`（内置 `admin` 账户）/ `admin`（新增账号）
- 初始账号：`admin / admin123`（明文）
- `admin` 用户名受保护，不可删除
- 密码**明文存储**于 `users.password`

### 8.5 对账 / 盘点
- `stocktake_sessions.status ∈ {进行中, 已完成}`；`stocktake_records.status ∈ {正常, 盘盈, 盘亏}`
- 盘点应为"按当前资产状态自动生成对账快照"（`StocktakePage.run_auto_stocktake`）；其依赖的 `auto_complete_stocktake` **在 DAL 中未实现**（见 §10）

### 8.6 系统日志 / 安全
- `log_action(operator, module, op_type, detail)` 写入 `system_logs`；`module ∈ {资产管理, 员工管理, 流转管理, 系统设置}`（UI 筛选枚举）
- 主窗口每 **5 秒**校验当前登录用户仍存在；不存在则报警并关闭（防账号被删后越权）

### 8.7 模块映射（菜单 → 页面类）
| 菜单 | key | 页面类 |
|------|-----|--------|
| 仪表盘 | dashboard | `DashboardPage` |
| 资产统计 | statistics | `AssetStatsPage` |
| 资产档案中心 | assets | `AssetPage` |
| 配件库存管理 | comp_inv | `ComponentInventoryPage` |
| 资产流转 | circulation | `LifecyclePage` |
| 员工管理 | employee | `EmployeePage` |
| 配置审计 | report | `ReportPage` |
| 库存对账 | stock | `StocktakePage` |
| 系统日志 | logs | `SystemLogPage` |
| 系统设置 | settings | `SettingsPage` |

---

## 9. 原始需求对照（功能.txt 六模块）

| 需求模块 | 实现状态 | 落点 |
|----------|----------|------|
| 1 设备档案管理 | ✅ | `AssetPage`（增/改/查/状态/标签/履历），字段含 sn/brand/price/image_path（部分 UI 未维护，见 §4/§7） |
| 2 设备生命周期 | △ | 领用/归还已实现；调拨/报废仅状态位，无独立流转动作 |
| 3 升级管理 | △ | 配件配置升降级 + `maintenance_records`；计划提醒/成本统计未实现 |
| 4 库存对账 | △ | 盘点页存在，但 `auto_complete_stocktake` 未实现（见 §10） |
| 5 查询统计 | ✅ | `DashboardPage` / `AssetStatsPage` / `ReportPage` |
| 6 系统管理 | △ | 用户/部门/分类管理 ✅；操作日志 `system_logs` **未实际写入**（见 §10）；备份恢复/批量导入导出仅导出 xlsx 已实现 |

---

## 10. 已知代码与文档/层间不一致（供诊断参考，**非规范**）

> 以下为当前代码真实存在的偏差，仅供后续诊断/重构定位；**不改变上述规范**，修复须先与用户确认。

1. **DAL 缺失 UI 调用的方法（会导致运行时报错/功能失效）**：
   - `employee_page.py` 调用 `db.add_employee` / `db.update_employee` —— 未定义
   - `lifecycle_page.py` 调用 `db.get_assets_by_status(...)` —— 未定义
   - `stocktake_page.py` 调用 `db.auto_complete_stocktake(name)` —— 未定义（盘点功能不可用）
2. **`init_db()` 与磁盘 schema 漂移**：`assets` 建表语句缺 `sn` / `price` / `image_path` 三列及全部索引；因 `IF NOT EXISTS`，旧库不受影响，但换库/初始化会丢字段。
3. **`system_logs` 从未写入**：`log_action` 已定义但**全代码无调用点**，`SystemLogPage` 实际恒为空 —— 不符合"操作日志记录"需求。
4. **`lifecycle_logs.op_type`**：表注释允许 领用/归还/调拨/报废，实际仅写 领用/归还。
5. **`maintenance_records.type`**：注释为 维修/升级，实际存变更性质原文（配置升级/维修替换/配置降级/初始录入）。
6. **配件"配置降级"不回补库存**：与"升级/维修替换扣减"非对称，属当前业务规则，勿擅自改对称。
7. **`categories.parent_id`**：表结构支持层级，UI 仅扁平分类，未利用。

---

*生成依据：功能.txt、requirements.txt、config.py、db_manager.py、utils/*、ui/*、ui/pages/*、data/zichan.db 真实 schema。*
*治理规则（§0）为项目最高约束，优先于本文件其余任何条款。*
