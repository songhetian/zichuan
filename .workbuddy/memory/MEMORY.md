# 项目长期记忆 (zichuan)

## 设计系统现状 (2026-08-06 评估)
- **技术底座**: shadcn/ui + Radix + Tailwind + CSS 变量 token 体系，生产级、默认可访问性达标。
- **配色**: 品牌色 teal `173 80% 40%`(非默认蓝,有辨识度)；背景暖米白 `40 5% 98%`(非纯白)；侧栏固定深色 `--sidebar-bg: 200 15% 14%`。
- **主题**: 仅有 `:root`(light) 变量,globals.css 无 `.dark` 覆盖;未引入 next-themes/ThemeProvider,**无深色模式切换**。侧栏恒暗 + 内容恒亮属于「固定混合模式」,属可接受方案但无用户切换。
- **语义色缺口**: Badge 仅有 default/secondary/destructive/outline,**缺 success(绿)/warning(琥珀)**;资产生命周期状态(在用/报废/维修中)缺少统一状态色板。
- **表格**: DataTable 自带 empty(暂无数据)/search-not-found(未找到匹配) 状态,分页+每页条数可选;但存在两套并行搜索机制(DataTable 内置 searchKey 列过滤 vs 页面级 ListSearchInput+filterItemsByText),已统一走页面级。
- **批量操作缺口**: 设备列表已实现跨页选择(cross-page select-all),但选中后**缺可见的批量操作条**(批量删除/导出)。
- **筛选**: 多个列表页已加可搜索下拉(SearchableSelect)与文本搜索叠加取交集;缺统一的「重置筛选」按钮。
- **a11y**: 按钮有 focus ring;但表格行内 icon-only 操作按钮(详情/编辑/删除)仅用 title 提示,建议补 aria-label。

## 部署约定 (Debian 局域网服务器 192.168.110.145)
- 仅代码改动: `git pull` + `npm run docker:update`(重建 app+nginx,不动库)。
- 含 DB 迁移: `npm run docker:deploy`。
- 502 排查: nginx 缓存旧 app 容器 IP → `docker compose restart nginx`。

## 测试约定
- 前端 UI 测试用 `npm run test:frontend`(vitest.frontend.config.ts,不连库)。
- 既有 DB/服务端测试需 MySQL,在沙箱内无库会失败,与本机 UI 改动无关。
