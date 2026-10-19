# MCP verification — 19 October 2026

This refresh upgrades the local agent toolkit from v0.70.0 to the latest stable tag, v0.79.0.
Generated guidance remains gitignored. Only sources reopened during this pass receive a new
verification date; older OAuth reference pages and client metadata documents retain theirs.

## Core protocol

The current published baseline remains **2026-07-28**. Its schema explicitly requires `resultType`
on results, including lists. The wire suite now asserts that field instead of advising about its
absence. Extension-defined result types remain allowed. The caching contract applies to complete
results of the named operations, requires a non-negative integer `ttlMs` and public/private
`cacheScope`, and excludes `input_required` intermediates. These fields belong on the result, not
in arbitrary `_meta` keys. Sources: [published schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts),
[caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching).

## Optional extensions

The protocol family now checks **advertised Skills servers** through `skills/list` and `skills/get`.
It declares client support on each request, checks Resources support, follows pagination, and checks
complete result envelopes, caching hints, required frontmatter and file-manifest structure. An
absent extension skips these checks. `resources: "dynamic"`, other URI schemes, and repeated skill
names remain valid. The 512-file and 16-MiB recommendations are not hard limits. The current Skills
specification requires caching fields on list/get and directory results. These tests cover list/get
metadata; directory traversal, fetched file digests and YAML equality are not yet covered.
Source: [Skills specification](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/stable/skills.mdx).

**Tasks** and **Server Cards** have Final Extensions Track SEPs. Neither becomes a requirement for
an ordinary server. Tasks can introduce `resultType: "task"` after negotiation. Server Cards describe
static remote connectivity and do not replace runtime primitive listings or security decisions;
the schema repository's README still calls the work experimental despite its Final charter. This
pass records their status without adding unconditional endpoint or task-execution requirements.
Sources: [Tasks SEP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2663-tasks-extension.md),
[Server Cards SEP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2127-mcp-server-cards.md).

## Client-specific changes

- **Claude Code:** changelog verified through v2.1.303. Stdio and hosted connector negotiation now
  reach more installations by default. v2.1.288 added a re-authentication prompt; it does not
  establish a change to pinned-scope selection. v2.1.302 tolerates missing result fields, which
  does not relax the specification's requirements. The OAuth profile's executable fields stay
  unchanged. [Official changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).
- **Copilot CLI runtime:** supports CIMD, scope step-up and a headless `client_credentials` grant.
  This corrects the earlier claim that no shipping client supports that grant. The discovery
  advisory now names that client when the authorization server advertises the grant. This is
  distinct from VS Code's local MCP client and does not prove implementation of the MCP Client
  Credentials extension. [Official changelog](https://github.com/github/copilot-cli/blob/main/changelog.md).
- **Codex:** MCP approval modes are configurable per server and tool; eligible prompts may use an
  automatic reviewer. Destructive/open-world enablement keys under `apps` do not prove a hard block
  for an arbitrary MCP server. The gate data and old report's evidence caveat now reflect that
  distinction. [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
- **ChatGPT:** the custom MCP server guide replaces the old developer-mode URL. Unhinted tools
  remain writes; write confirmation is the default, with remembered choices scoped to a conversation.
  MCP Events separately requires 2026-07-28 and webhook delivery. Its callback verification,
  persistent subscriptions and outbound HTTPS need a dedicated integration target; the ordinary
  wire gate does not claim to test them.
  [Custom servers](https://developers.openai.com/api/docs/guides/custom-mcp-server),
  [MCP Events](https://developers.openai.com/plugins/build/mcp-events).

## WebMCP

The current browser API exposes an **optional object** `inputSchema` and takes object arguments.
The earlier internal string representation is not an alternative public contract. The execution
suite now allows an omitted schema and selects a legacy JSON-string argument only when the browser
returns a string schema. Each declared tool executes once; a handler error never triggers another
call under a different encoding. Node VM regression tests execute the generated browser script
against both API shapes and verify that rejected handlers are not called twice.
Source: [WebMCP draft](https://webmachinelearning.github.io/webmcp/).

## Validation and release status

The initial refresh passed typecheck, lint, **243 harness tests** and build. The changed families also ran
against Stageify's existing production build and its explicitly approved disposable test database,
using this checkout through a temporary configuration: **50 passed, 2 skipped** across four files,
including real-browser WebMCP. The skips are the Skills checks: that consumer does not advertise
Skills, so a live Skills server has not yet exercised the positive extension path.
Separate local socket-fixture checks exercise paginated Skills results with duplicate skill names,
native URI schemes and dynamic manifests; an invalid caching variant is rejected with its clause
citation. This is harness verification, not a claim of live Skills-client compatibility.

Compatible dependency patches include Vitest 4.1.12. Installation has no dependency warnings and
`npm audit` reports zero vulnerabilities. Major upgrades to the test/compiler/lint tools were not
part of this refresh. The package dry run excludes generated toolkit files and `docs/todo`, whose
gitignore rule alone did not prevent npm's explicit `docs` inclusion from packaging local notes.

The final v0.12.0 validation, including the [scheduled Chat diagnostics](chatgpt-scheduled-writes.md),
passes typecheck, lint, **253 harness tests** and build. A subsequent real-consumer run using this
checkout passed **130 tests across six files**, with the same two optional Skills checks skipped.
The diagnostics did not invoke write tools or reproduce a scheduled run inside ChatGPT.
The new assertions and corrected vendor facts are included in the [v0.12.0 minor release](../CHANGELOG.md).
