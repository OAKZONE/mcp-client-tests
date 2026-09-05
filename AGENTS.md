# mcp-client-tests — AGENTS.md

> Operating rules for this repository.
>
> **🔴 This repository is PUBLIC, and the agent-toolkit is not.** Everything
> `npm run sync-agents` materializes — `.claude/`, `.codex/`, `.github/instructions/`, `.agents/`,
> `setup.sh` — comes from the private [@oakzone/agent-toolkit](https://github.com/OAKZONE/agent-toolkit)
> and is **gitignored here**, unlike in the private consumer repos which commit it. Never commit it,
> and never paste its content into a file that is tracked.
>
> The consequence: **a fresh clone has no rule corpus**, and a contributor or cloud agent without
> toolkit access works from this file alone. So this file is self-contained rather than deferring to
> rule IDs. A maintainer with access runs `npm run sync-agents` to get the full corpus locally.

## ⚠️ The rule this repository exists to enforce

**Assertions come from the specification, never from the server under test.**

Everything else here is machinery in service of that. A suite written to describe what a server
currently does is green on every defect that server has — which is not a subtle failure mode, it is
the *only* failure mode that matters. The package's whole value is detecting where an implementation
and a specification disagree, and it can only do that if the specification is the source.

Three consequences, all binding:

1. **Every expectation cites a clause** in `src/harness/specifications.ts`, and the citation travels
   into the failure message via `cite()`. An assertion with no citation is an assertion about
   somebody's implementation.
2. **A vendor profile is edited only when that vendor's documentation changes**, with
   `verifiedAgainst` updated in the same commit. Never to make a red test green.
3. **Only vendor-established facts are asserted, and the code enforces it.** Every clause carries an
   **evidence grade** — `strong` / `moderate` / `thin` / `unverified`, the same vocabulary the
   distilled vendor documentation uses — and **`cite()` throws on anything below `strong`**. A fact
   graded down can therefore only ever reach a consumer through `advise()`, which prints its grade
   and its caveat beside it.

   Grading is a deliberate act at the call site: `clause()` builds a `strong` one, `graded()` builds
   anything less and demands a caveat saying what corroboration is missing. **Do not work around the
   guard.** The most quotable facts about client behaviour are the least established — a ~256-tool
   ceiling, a ~40-tool ceiling contested against 80+, a profile key reported to hard-block — and
   asserting any of them would eventually fail a correct server. A gate that fails correct servers
   gets switched off, taking every true finding with it.

If you find yourself adjusting an assertion because a consumer's server fails it, stop and read the
citation. That is the moment the suite is doing its job.

## Layout, and what may import what

| Path | Contains | May import |
|:---|:---|:---|
| `src/target.ts` | The consumer contract — capabilities, not configuration | nothing |
| `src/harness/` | Transport, browser, TLS authority, document host, OAuth + MCP clients, deployment lifecycle, and the pure units the suites judge with | Node, `oauth4webapi`, `vitest` |
| `src/profiles/` | One file per client **surface**, transcribed from vendor docs — OAuth behaviour, and the gate each surface applies to a tool list | `src/harness/` only |
| `src/suites/` | The families and their suites | all of the above |
| `src/provision.ts` | Run-start wiring, gated per capability | harness + target |

**Nothing imports a consumer.** That is what makes the package portable and what stops it asserting
someone's constants back at them.

## Design rules specific to this package

- **MCT01 — A capability describes the SERVER, never the test.** `authorization` is a fact about a
  deployment; `runOAuthTests` would be a flag, and a flag is how a gate ends up silently skipped in
  the one repository that most needed it.
- **MCT02 — One profile per client surface, never per vendor.** See `docs/extending.md`. This binds
  both kinds in `src/profiles/`: an OAuth profile (how a client *authorizes* — behaviour the harness
  executes) and a `ClientGate` row (what it does with a tool list it already has — published facts
  nothing can execute). Claude Code and the hosted Claude surfaces disagree on both, so a `claude`
  row in either would average two contracts into one describing neither.
- **MCT03 — Adding a family never edits an existing one.** If it does, the seam is wrong; fix the
  seam.
- **MCT04 — Prove the wire, not the handler** (toolkit MCP05). No suite may call a consumer's code
  directly. Everything crosses a socket.
- **MCT05 — A harness artefact must never be reportable as a consumer finding.** The package's own
  tests (`src/harness/harness.test.ts`) exist for exactly this: a defect in `wellKnownInsertion` or
  `parseBearerChallenge` would make every consumer's suite assert the wrong thing quietly. When a new
  pure unit is added to the harness, it gets a test here.
- **MCT06 — WebMCP is not MCP, and the two never share a clause.** WebMCP (`src/suites/webmcp/`,
  `src/harness/webmcp-surface.ts`, the `WEBMCP` clause group) is the browser API that lets a page
  register its own functions as tools for an agent attached to the browser. It borrows MCP's
  vocabulary — tools, descriptions, JSON Schema — and none of its wire: no JSON-RPC, no transport,
  no server, no OAuth. So an assertion about a page-published tool cites `WEBMCP`, never `MCP`, and
  an MCP rule (tool-name grammar, caching hints, `resultType`) has no standing over one. The gap is
  where the risk sits: a WebMCP tool runs in the user's tab, in a live authenticated session, with
  no token and no scope, and its three annotations are **hints no agent must honour**. The
  *declarative* API crosses a socket and is read from served HTML; the *imperative* API is a
  JavaScript call, so it is reached only by `suites/webmcp/imperative.ts`, which drives a real
  Chrome through `playwright-core` (an **optional peer dependency**, no binaries). That suite is
  never auto-registered: `defineWebMcpConformanceSuites` omits it, because turning a consumer's run
  red over a missing browser is neither a finding about their server nor something they asked for.

- **MCT07 — A remote deployment can only be asked what needs no credential.** `deployment: { remote:
  true }` names a server this package did not start, so there is no process to hand a certificate
  authority to and no storage to create an account holder in. Only the `discovery` family qualifies;
  `authorization` alongside a remote deployment is **refused in `provision.ts`**, not degraded. Do
  not "make OAuth work remotely" by relaxing that — the document host exists because the server must
  fetch a client-metadata document back over a trusted TLS chain, and a host you do not control
  cannot be given one.

## QA gates

| Scope | Gates |
|:---|:---|
| Docs only | none — state "QA skipped — documentation-only" |
| Any source change | `npm run validate` (typecheck + lint + tests + build) |
| A profile or a suite | `npm run validate`, **plus** run the suites against a real consumer before release |

The last row is not optional. This package's own tests cover its pure units; they cannot tell you a
suite still passes against a real server. Before tagging, run the gate in a consuming repository.

## Versioning

SemVer against the **consumer contract and the assertions**, which is not the same as source shape:

- **Patch** — a fix that does not change what any assertion means; docs; internal refactor.
- **Minor** — new suites, new profiles, new capabilities, new exports. **A consumer's green run may
  turn red**, because a new assertion can surface a pre-existing defect. That is the intended
  behaviour of this package, and the CHANGELOG must say what was added so the consumer can read the
  finding rather than debug a mystery.
- **Major** — a breaking change to `McpTestTarget` or to an exported entry point.

**A vendor-behaviour correction is at least a minor**, even when the diff is one line, because it
changes what a consumer's passing test asserted yesterday.

## Release flow

Same shape as the toolkit's, and the same three things must move together — `package.json` version,
a `CHANGELOG.md` heading, and the tag:

1. Land the work; `npm run validate` green; the gate run against a real consumer.
2. Bump `version` in `package.json`.
3. Add a CHANGELOG entry at the **top** under `## vX.Y.Z — <one-line summary>`. That summary becomes
   the commit and tag message, so write it as you would want to read it in `git log`.
4. **Maintainer-only:** `npm run release -- vX.Y.Z` (add `--dry-run` first to see the plan).

Agents do not run mutating git on their own initiative (TERM07). The release script does it once a
maintainer invokes it. It validates, refuses on a version/CHANGELOG mismatch, refuses to stage
anything that looks like a secret, then commits, tags, and pushes.

## Licence

Apache-2.0, and the choice is load-bearing rather than incidental:

- **Permissive**, so a consumer's legal review is a non-event and adoption is not the bottleneck.
- **§5 licenses inbound contributions under the same terms**, which is how "PRs welcome" and
  "OAKZONE keeps the rights" hold at once — no CLA to administer.
- **Explicit patent grant with retaliation**, which matters because this package is embedded in
  other organisations' CI.

Copyright is OAKZONE's regardless of the licence; the licence governs what everyone else may do.
Keep `LICENSE` and `NOTICE` in `files` so both travel with an install.

## Consumers

Consumers pin a tag and bump deliberately:

```
"devDependencies": { "@oakzone/mcp-client-tests": "github:OAKZONE/mcp-client-tests#vX.Y.Z" }
```

**`devDependencies`, not `optionalDependencies`.** This package being public is what makes that the
right answer: it installs with no credentials anywhere, so there is nothing for `optional` to
rescue, and `optional` would only convert a clear `npm ci` failure into a confusing
`Cannot find module` at typecheck. Use `optional` only if you deliberately want a build that can
proceed without the gate.

A consumer's conformance CI job is still worth one line of insurance, because the invariant it
protects is the one everything here rests on:

```yaml
- run: node -e "require.resolve('@oakzone/mcp-client-tests/package.json')"
```

A conformance run that quietly tested nothing is the worst outcome available.

When a release changes vendor facts, the CHANGELOG entry is what a consumer reads before bumping.
Write it for them, not for us.
