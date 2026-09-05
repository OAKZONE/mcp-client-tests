# PROJECT-MAP.md

> Local flavoring document: where things live in **this** repository, and what its concepts are
> called. Toolkit-shared instructions reference the sections below by name.
>
> `AGENTS.md` answers HOW and WHY. This file answers WHERE and WHAT IT IS CALLED.

## Path map

| Key | Path | Notes |
|:---|:---|:---|
| `source_root` | `src/` | The whole package. |
| `consumer_contract` | `src/target.ts` | `McpTestTarget` — the entire integration surface. Imports nothing. |
| `shared_types` | `src/target.ts` | Same file; this package's only public type surface besides the suites. |
| `harness` | `src/harness/` | Transport, browser, TLS authority, document host, OAuth + MCP clients, deployment lifecycle, and the pure units the suites judge with. |
| `specifications` | `src/harness/specifications.ts` | The clause registry every assertion cites. **No assertion exists without a row here.** |
| `profiles` | `src/profiles/` | One file per client **surface**, transcribed from vendor docs (MCT02). |
| `suites` | `src/suites/` | One directory per family (MCT03). |
| `provisioning` | `src/provision.ts` | Run-start wiring, gated per capability. |
| `tests_unit` | `src/harness/harness.test.ts` | The package's own tests — the MCT05 guard. |
| `docs_root` | `docs/` | Ships in the npm tarball via `files`. |
| `docs_todo` | `docs/todo/` | Active mission folders. **Gitignored** — working notes quote the private toolkit. |
| `tech_debt_ledger` | `docs/guides/tech-debt.md` | Created on first `OH02` entry. |

## QA scripts

| Concept | Command |
|:---|:---|
| `typecheck` | `npm run typecheck` |
| `lint` | `npm run lint` |
| `lint_fix` | `npm run lint -- --fix` |
| `test` | `npm run test` |
| `test_targeted` | `npm run test -- {path-or-pattern}` |
| `build` | `npm run build` |
| `full_qa` | `npm run validate` (typecheck → lint → test → build) |

> **`npm run validate` is the gate for any source change.** It cannot tell you a suite still passes
> against a real server — that is the second gate in `AGENTS.md § QA gates`, and it is not optional
> before a release.

## Terminal conventions

| Key | Value |
|:---|:---|
| `shell` | `PowerShell` |
| `cd_allowed` | `false` |
| `path_separator` | `\` |
| `os_family` | `Windows` |

## Testing conventions

| Key | Value |
|:---|:---|
| `harness_path` | `src/harness/` |
| `cross_link_required` | `false` |
| `ui_mount_tests_allowed` | `false` |
| `paired_tests_required` | `true` (a new pure unit in `src/harness/` ships with its `harness.test.ts` case — MCT05) |

## Dispatch floor

`SUB19`'s break-even, measured for this repository: **~9K tokens** per custom-subagent dispatch
(`AGENTS.md` + `CLAUDE.md` + the always-on `.claude/rules/` corpus). Below the toolkit's 15–25K
typical, because this repo deliberately carries no local agentic content. Re-measure when the rule
corpus or `AGENTS.md` changes materially.

## Domain glossary

```
- Family      — a group of suites sharing one required capability and one subject (discovery, oauth,
                protocol, tool-surface, webmcp)
- Capability  — a fact about the SERVER that unlocks a family, never a flag about the tests (MCT01)
- Profile     — one client SURFACE's published behaviour, as data (MCT02)
- Clause      — a row in specifications.ts; the citation a failure or advisory quotes
- Assertion   — a failure-producing expectation. Comes from a clause, never from a server
- Advisory    — a non-failing finding: something offered, or something graded below STRONG
- Gate        — the client-side layers between tools/list and execution (admission, enablement,
                approval, classification, content scanning)
```

## Project-specific specialists

None. The toolkit's generic agents handle everything here.

## Framework warnings (opt-in)

```
- [x] llm-tool-surface
- [x] mcp
- [x] mcp-connection
- [x] mcp-ui
- [x] vitest
- [ ] nextjs
- [ ] prisma
- [ ] zustand
- [ ] react-flow
- [ ] shadcn-ui
- [ ] tailwind
- [ ] vercel-ai-sdk
- [ ] vercel-ai-sdk-tool-calling
- [ ] vercel-ai-sdk-strict
- [ ] ruff
- [ ] observability-shipping
```

**All four MCP-family guides are enabled, and deliberately left unscoped.** A `[scope: …]` narrows a
guide to named directories, which pays in a project where MCP is *a feature*. Here MCP is *the
product*: every file under `src/` is about the protocol, its clients, or the gate their tools pass,
so any scope narrower than the tree would only risk hiding the rule from the transport, profile or
specification code that carries no `mcp` in its path.

`mcp-connection` is enabled because this package asserts the OAuth wire contract and the stateless
revision. `mcp-ui` is enabled because it asserts `icons[]` sourcing and theme coverage.
