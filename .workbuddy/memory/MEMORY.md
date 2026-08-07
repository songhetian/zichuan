# 项目长期记忆 (zichuan)

## 设计系统现状 (2026-08-06 评估)
- **技术底座**: shadcn/ui + Radix + Tailwind + CSS 变量 token 体系，生产级、默认可访问性达标。
- **配色**: 品牌色 teal `173 80% 40%`(非默认蓝,有辨识度)；背景暖米白 `40 5% 98%`(非纯白)；侧栏固定深色 `--sidebar-bg: 200 15% 14%`。
- **主题**: 仅有 `:root`(light) 变量,globals.css 无 `.dark` 覆盖;未引入 next-themes/ThemeProvider,**无深色模式切换**。侧栏恒暗 + 内容恒亮属于「固定混合模式」,属可接受方案但无用户切换。**用户 2026-08-07 明确决定不做深色模式**(不要再主动提此需求)。
- **语义色缺口**: Badge 仅有 default/secondary/destructive/outline,**缺 success(绿)/warning(琥珀)**;资产生命周期状态(在用/报废/维修中)缺少统一状态色板。
- **表格**: DataTable 自带 empty(暂无数据)/search-not-found(未找到匹配) 状态,分页+每页条数可选;但存在两套并行搜索机制(DataTable 内置 searchKey 列过滤 vs 页面级 ListSearchInput+filterItemsByText),已统一走页面级。
- **批量操作缺口**: 设备列表已实现跨页选择(cross-page select-all),但选中后**缺可见的批量操作条**(批量删除/导出)。
- **筛选**: 多个列表页已加可搜索下拉(SearchableSelect)与文本搜索叠加取交集;缺统一的「重置筛选」按钮。
- **a11y**: 按钮有 focus ring;但表格行内 icon-only 操作按钮(详情/编辑/删除)仅用 title 提示,建议补 aria-label。

## 删除 vs 报废 语义 (2026-08-06 厘清)
- **`deleteAsset` = 真正的硬删除**(`prisma.asset.delete`,级联删配件/生命周期记录,不可逆)；此前界面无此入口,垃圾桶图标被「报废」占用,造成语义混乱。
- **「报废」= 状态变更**(`SCRAPPED` 枚举,`scrapAssets` 动作,保留记录与历史),非删除。
- **修复后**: 垃圾桶 `Trash2` 专指「删除」(调 deleteAsset,红色破坏性确认);「报废」改用 `Ban` 图标(橙色)。资产行操作列:查看/编辑/删除内联,其余生命周期动作(分配/归还/调拨/送修/维修完成/报废)收进「更多」DropdownMenu。批量栏新增「批量删除」。

## 状态语义色 (2026-08-06 升级)
- `src/components/features/status-badge.tsx` 抽出纯函数 `getStatusStyle(status)` → 带底色语义胶囊: IDLE=中性灰、IN_USE=成功绿(emerald)、IN_MAINTENANCE=警告琥珀、SCRAPPED=危险红、IN_STOCK=信息蓝。替换原小圆点样式。

## 表格打磨 (2026-08-06)
- DataTable 表头行加 `group`(排序箭头 hover 可见);行 map 用 `<Fragment key>` 修 React key 警告;单元格 `align-top`→`align-middle`。
- DataTable 移除未使用的 `searchKey` 内置搜索分支(无页面使用),收敛为页面级搜索单一机制。
- 模板/型号/库存流水三页筛选栏新增「重置」按钮(任意筛选生效时显示,一键清空)。

## 访问/部署方式
- **用户验证 UI 走本地项目访问(localhost,非 192.168.110.145 服务器)**: 本地直接跑工作区代码,改动经 `npm run dev` 的 HMR 实时生效,**无需 git 提交即可在本地看到 UI 修复**。
- **本地看不到最新 UI 改动时,首要排查顺序: 本地 dev 实例未重启 → HMR 未刷新/报错 → 跑的是旧 docker 容器或旧 `next build` 产物;而不是 git 未提交**(git 提交仅影响推到 192.168 服务器生产部署)。
- 生产部署(Debian 局域网服务器 192.168.110.145): 仅代码改动 `git pull` + `npm run docker:update`(重建 app+nginx,不动库);含 DB 迁移 `npm run docker:deploy`;502 排查 `docker compose restart nginx`。

## 测试约定
- 前端 UI 测试用 `npm run test:frontend`(vitest.frontend.config.ts,不连库)。
- 既有 DB/服务端测试需 MySQL,在沙箱内无库会失败,与本机 UI 改动无关。

## 认证机制现状 (2026-08-07 诊断)
- **非 JWT**: 用 `iron-session`(cookie session),`src/lib/auth.ts`。`getIronSession`,`SESSION_MAX_AGE=8h`,cookie `httpOnly + sameSite:lax + secure:false + path:/`。
- `SESSION_SECRET` 已在 `.env` 正确随机设置(≥32字符),非 secret 问题。
- 部署纯 HTTP(nginx `listen 80` 反代 app:3000),故 `secure:false` 当前正确。
- 守卫: 无 middleware;(main)/layout.tsx 服务端每次渲染 `getCurrentUser()`,null 即 `redirect("/login")`;前端 header 仅在点「退出登录」时跳登录。**故"自动退出"必为服务端读到 session=null**。
- **设计缺陷(真凶候选)**: iron-session **无滑动过期**——`createdAt` 仅登录时定,8h 固定到期,活跃也不续;只读导航不调 `session.save()`。
- **另一候选**: 访问地址在 `192.168.110.145`(IP) 与 `it.manage.com`(域名) 间混用 → cookie 域不共享 → 跳登录(局域网典型)。
