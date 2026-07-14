# Domain Docs (consumer rules)

How the engineering skills should consume this repo's domain documentation.

## Layout

**Single-context.** This repo has one authoritative domain document:

- **`domain.md`** at the repo root — the project's domain language, tech stack, table structures, return/error conventions, validation rules, and business constraints.

There is no `CONTEXT.md` / `CONTEXT-MAP.md` / `docs/adr/` in this repo (it is a small desktop app, not a monorepo). `domain.md` absorbs all of those roles. Do not create `CONTEXT.md` unless the user asks.

## Before exploring, read `domain.md`

Read `domain.md` (repo root) before any diagnosis, refactor, or optimization. It is the single source of truth for:

- tech stack and layering conventions
- database table structures (authoritative = on-disk `data/zichan.db` schema)
- unified return format / interface (DBManager) contract
- validation rules and business constraints

## Governance rule (highest precedence)

> 后续所有诊断 / 重构 / 优化必须以 `domain.md` + 原始开发文档为唯一标准。
> 代码与文档冲突时，**以文档为准**。
> 禁止私自修改：业务逻辑、数据库表结构、接口出入参。

When your output would contradict `domain.md` or the on-disk schema, **surface it explicitly** rather than silently overriding, and do not change business logic / schema / interface signatures without user confirmation.

## Known gaps

`domain.md` §10 lists code-vs-doc inconsistencies for diagnosis. Treat them as findings, not as license to change the documented rules.
