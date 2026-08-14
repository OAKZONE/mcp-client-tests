# Changelog

## v0.3.0 — Runs under a forking pool, and adapts to a consent screen's own control names

Second consumer (Stageify) — and adopting it surfaced two package defects, both of the exact class
`AGENTS.md` MCT05 exists to prevent: a harness artefact that reads as a finding about somebody's
server. **If you are on v0.2.1 and your suites never ran, this is why.**

### Fixed

- **🔴 The deployment handoff was keyed on `process.pid`, so every suite failed under Vitest's
  default `forks` pool.** Global setup writes the handoff in the *main* runner process and a suite
  reads it in a *worker*, which under `forks` is a different process with a different pid — so the
  two resolved to different files and every suite threw *"No deployment was provisioned for target
  X"* while the deployment was running perfectly. The run is now keyed on a per-run id carried in
  the environment, which both processes see under either pool. A consumer whose runner uses
  `threads` never saw this; one whose runner uses `forks` saw nothing else.
- **A test that failed after the run started could leave the pooled connection unhandled.** Not a
  package change — see the consuming note below — but `docs/consuming.md` now says why a target's
  database client must not disconnect between suites, because doing so ends a worker with
  *"Worker exited unexpectedly"* and no failing test to attribute it to.

### Added

- **`AuthorizationCapability.consentScopeFieldName`** — the `name` a consent screen's permission
  checkboxes carry, defaulting to `scope`. Like `consentFormId` this is application UI, not
  protocol: nothing in any specification names the control a consent screen collects capabilities
  in, and a deployment whose decision route reads `selectedScopes` is exactly as conformant as one
  reading `scope`. The package models a real browser, which submits the control's declared name and
  nothing else, so it has to be told which one to read — and which one to add an extra permission
  to when a suite exercises granting more than was asked.
- `consentControls(authorization)` is exported for suite authors: spread it into a browser leg so a
  new consent-screen fact is added in one place rather than at every call site.

### Consumers

**No action needed on an existing target** — `consentScopeFieldName` defaults to the name every
consumer written before it used. Bump for the handoff fix if your runner forks, which is Vitest's
default.

## v0.2.1 — Consumer guidance corrected: a plain devDependency, not optional

### Fixed

- **Install guidance said `optionalDependencies`; it should say `devDependencies`.** That advice was
  written while this repository was private, when a build server with no credentials could not fetch
  it at all and `optional` was what kept a deploy alive. Public removes the reason entirely: it
  installs with no credentials anywhere, so `optional` rescues nothing and only converts a clear
  `npm ci` failure into a confusing `Cannot find module` at typecheck. `AGENTS.md` and
  `docs/consuming.md` now say so, and say when `optional` is still a deliberate choice.

### Added

- `docs/consuming.md` gains a short section for **source-built deploys** (Coolify/Nixpacks and
  similar): they will install this package even though the deployed image never runs a conformance
  test, `npm ci --omit=dev` cannot avoid it because the build needs devDependencies, and
  `--omit=optional` cannot either because it prunes transitive native dependencies such as `sharp`
  and `lightningcss`. Measured cost: ~13 s and 47 packages.

## v0.2.0 — Apache-2.0, and contributions are welcome

### Changed

- **Licensed under [Apache License 2.0](LICENSE)**, replacing the internal-use-only notice inherited
  from the toolkit scaffold. The package is public and meant to be used: permissive so adoption is
  not gated on a legal review, with an explicit patent grant because it runs inside other
  organisations' CI. Copyright remains OAKZONE's.
- **Contributions are accepted under the same licence automatically** (Apache-2.0 §5) — no CLA. See
  the new [CONTRIBUTING.md](CONTRIBUTING.md), whose one rule is the one that makes the package worth
  running: assertions come from the specification, never from a server under test.
- Added `NOTICE`, and both it and `LICENSE` now ship with an install.

**Released as a minor, not a patch.** A licence change is not an API change, but it is exactly the
kind of thing a consumer's review needs to see rather than have buried in a patch.

## v0.1.3 — Install instructions no longer name a fixed tag

### Fixed

- The quickstart and `docs/consuming.md` showed `#v0.1.0`, the most-copied line in the docs and one
  that goes stale on every release. Both now show `#vX.Y.Z` and point at Releases for the current
  tag.

## v0.1.2 — Moved to the OAKZONE organisation

### Changed

- The repository now lives at **[OAKZONE/mcp-client-tests](https://github.com/OAKZONE/mcp-client-tests)**,
  matching the `@oakzone/` package scope and sitting beside the other shared OAKZONE packages
  rather than under a personal account. Still public, so it still installs with no credentials.
- Every install instruction, the `repository` field, and the consumer guidance name the new owner.

**Consumers should re-pin** to `github:OAKZONE/mcp-client-tests#v0.1.2`. GitHub redirects the old
path, so an existing pin keeps resolving — but a redirect is not a contract, and a lockfile that
still records the personal account will confuse the next reader.

## v0.1.1 — Public repository: toolkit material excluded, consumer guidance corrected

### Fixed

- **The agent-toolkit vendor mirrors are gitignored and were removed from history.** `.agents/`,
  `.claude/`, `.codex/`, `.github/instructions/`, `.github/copilot-instructions.md`, the toolkit's
  `claude.yml`/`codex.yml` workflows, `setup.sh`, and `.vscode/` all come from the **private**
  OAKZONE/agent-toolkit and must never be committed to this **public** repository. v0.1.0's tree
  contained them; the tag was rewritten to a clean tree and force-pushed.
- **Consumer guidance now recommends `optionalDependencies`**, not `devDependencies`. A
  Coolify/Nixpacks deploy builds on the deploy server and installs devDependencies, so a dependency
  that cannot be fetched there breaks the deploy; optional makes it non-fatal. Paired with a
  `require.resolve` assertion in the consumer's conformance job, so "installed" is never assumed.

### Changed

- `AGENTS.md` is self-contained: a fresh clone has no rule corpus (the toolkit is gitignored), so a
  contributor or cloud agent without toolkit access works from that file alone.

## v0.1.0 — First release: OAuth conformance for Claude Desktop, Claude Code, and ChatGPT

Extracted from the Kwantle repository, where these suites were written and where their first run
found four defects that every handler-level test had passed.

### Added — the package

- **A capability-scoped target contract** ([src/target.ts](src/target.ts)). A consumer describes
  what its server *is able to do*; each suite family requires what it needs. A server with no
  authorization still gets every family that does not need one — which is what makes the package
  usable by an authless MCP service and by a server written in any language, since the deployment is
  spawned as a command and driven over HTTP.
- **A deployment harness** that starts the server under test as its own process behind the
  reverse-proxy shape every deployment runs behind: the client addresses the canonical HTTPS origin,
  the server receives plain HTTP with `Host` and `X-Forwarded-*`. Nothing is mocked, no consumer
  module is imported, and every assertion is about bytes that crossed a socket.
- **A modelled browser** that derives its `Origin` header from the page's own `Referrer-Policy` —
  which is how a server whose hardening header and CSRF check disagree becomes a red test instead of
  a production incident.
- **A per-run certificate authority** ([src/harness/tls-certificate.ts](src/harness/tls-certificate.ts)),
  hand-encoded X.509 with no dependency, so client metadata documents are served over real TLS. A
  CIMD `client_id` MUST use `https`, so a harness serving the plain-HTTP shape would certify
  something no client can use.
- **Three vendor profiles**, transcribed from vendor documentation and live metadata documents with
  per-field citations and a `verifiedAgainst` stamp: `claude-desktop` (the hosted surfaces),
  `claude-code` (native, loopback, no scope-union step-up), `chatgpt-desktop` (three-URL discovery,
  `private_key_jwt`, per-connection callback).
- **70 assertions** across the three surfaces, each citing a clause in
  [src/harness/specifications.ts](src/harness/specifications.ts) — RFC 6749, 6750, 7009, 7523, 7591,
  7636, 8252, 8414, 8707, 9207, 9700, 9728, MCP Authorization 2025-11-25, and the vendors' own
  published contracts — with the citation carried into the failure message.
- **The package's own tests** for every pure harness unit, including validating the hand-encoded
  certificate against Node's X.509 parser. A defect in `wellKnownInsertion` or
  `parseBearerChallenge` would otherwise make every consumer's suite assert the wrong thing quietly.

### Findings from the first run

Recorded here because each is a shape to watch for, not just a closed ticket. Three produced no error
and no log line anywhere:

| Defect | Symptom |
|:---|:---|
| `offline_access` silently stripped by the library's OIDC `prompt` rule — **no refresh token ever issued** | "I sign in again every hour, forever" |
| A CIMD client declaring `private_key_jwt` **with published keys** rewritten to `none`, refusing its signed token request | ChatGPT: consent succeeds, then fails |
| `state` required, though RFC 6749 §4.1.1 makes it RECOMMENDED | connection setup fails, no login page |
| Redirect URIs matched exactly, refusing RFC 8252 loopback | **Claude Code could not sign in at all** |
