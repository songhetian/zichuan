# CLAUDE.md

Project notes and agent-skill configuration for the 资产管理系统 (zichuan) desktop app.

## Agent skills

### Issue tracker

GitHub Issues at `github.com/songhetian/zichuan`; PRs are **not** a triage surface. Use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: **`domain.md`** at the repo root is the authoritative domain spec and the single source of truth for diagnosis/refactor/optimization. Code conflicts with it → docs win; do not change business logic, schema, or interface signatures without confirmation. See `docs/agents/domain.md`.
