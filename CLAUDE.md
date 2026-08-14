@AGENTS.md

## Claude Code — operating guidance

Universal operating rules auto-load from `.claude/rules/<name>.md`, synced from the
[@oakzone/agent-toolkit](https://github.com/OAKZONE/agent-toolkit) by `npm run sync-agents`.
Path-scoped rules apply when Claude reads matching files; universal rules apply every session.

`@AGENTS.md` above is the only @-include: it carries this repository's own rules. Everything else
is auto-loaded, because `CLAUDE.md` costs tokens in every session and inside every subagent.

> **Never edit files in `.claude/`, `.github/instructions/`, `.codex/`, or `.agents/shared/`** —
> they are regenerated copies and edits are silently overwritten on the next sync.
