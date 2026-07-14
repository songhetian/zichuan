# Issue tracker: GitHub

Issues for this repo live as GitHub issues. Use the `gh` CLI for all operations.

Remote: `https://github.com/songhetian/zichuan.git` (inferred by `gh` from inside the clone).

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies).
- **Read an issue**: `gh issue view <number> --comments`, also fetch labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with `--label` / `--state` filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** This is a solo/maintained desktop app; external PRs are not a feature-request surface. `/triage` does not pull PRs into the queue. (Switch to `yes` only if the user decides to accept external PRs as requests.)

## When a skill says "publish to the issue tracker" / "fetch the relevant ticket"

Create / read a GitHub issue as above.
