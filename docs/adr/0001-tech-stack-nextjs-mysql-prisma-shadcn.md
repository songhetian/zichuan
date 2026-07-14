# 技术栈选择：Next.js 全栈 + MySQL + Prisma + shadcn/ui

选择 Next.js 作为全栈框架（Server Components + Server Actions），搭配 MySQL 数据库、Prisma ORM、shadcn/ui + Tailwind CSS 前端组件库，彻底重写原 Python/PySide6 桌面应用。

**原因**：
- 用户明确要求用 React 重构，且偏好 shadcn/ui + Tailwind 的样式可控性
- Next.js 全栈架构省去了单独维护后端服务的复杂度，单人项目开发效率最高
- MySQL 相比 SQLite 功能更完整，未来如需扩展为多人使用无需换库
- Prisma 提供类型安全的数据访问和便捷的迁移管理
- 系统定位为单人本地使用，浏览器应用即可满足需求，无需 Electron 等桌面打包方案

**Considered Options**：
- Python/PySide6（原方案）— 样式定制困难，UI 体验不佳
- Electron + React — 包体积大，对单人本地应用过重
- 纯前端 + sql.js — 性能和存储有限制
- Next.js + SQLite — 功能受限，扩展性差
