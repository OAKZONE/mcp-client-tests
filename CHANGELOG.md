# Changelog

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
