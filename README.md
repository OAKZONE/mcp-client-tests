# @oakzone/mcp-client-tests

Conformance suites for MCP servers, written from the specifications and from what MCP client
vendors publish.

Point it at your MCP server and it answers one question with evidence: **would each vendor's client
actually be able to use this?**

## What it does

It starts your server as a real process, behind the reverse-proxy shape every deployment runs
behind, and drives it as Claude Desktop, Claude Code, and ChatGPT — over a real socket, against your
real storage, with **nothing mocked, including authentication.** Every assertion cites the clause it
comes from, and the citation travels into the failure message.

```
✓ Claude Desktop connector conformance  (45)
✓ Claude Code connector conformance     (11)
✓ ChatGPT connector conformance         (14)
```

## Why it exists

Because the defects that make an MCP server unreachable are the ones a normal test suite cannot see.
On its first run against a mature, well-tested deployment it found four, three of which produced **no
error and no log line anywhere**:

| What was wrong | What a user experienced |
|:---|:---|
| A library rule silently dropped `offline_access`, so no refresh token was ever issued to anyone | "I have to sign in again every hour, forever" |
| A client declaring `private_key_jwt` *with* published keys was registered as public, so its signed token request was refused | ChatGPT: consent succeeds, then "something went wrong" |
| `state` was required, though RFC 6749 §4.1.1 makes it RECOMMENDED | "connection setup failed", no login page |
| Redirect URIs matched by exact string, refusing RFC 8252 loopback | **Claude Code could not sign in at all** |

Every one of those passed the server's own handler tests, because the handlers did exactly what they
were written to do.

## The rule that makes it work

**Assertions come from the specification, never from the server under test.** A suite written to
describe current behaviour is green on all four defects above. When a test here fails, read its
citation: if the clause says what the assertion says, the server is what changes.

Vendor profiles are edited **only when a vendor's documentation changes**, and each carries a
`verifiedAgainst` date.

## Quickstart

```bash
npm install --save-dev github:OAKZONE/mcp-client-tests#vX.Y.Z   # see Releases for the current tag
```

Public and installable with no credentials, which is what lets it work from a build that has none —
a Coolify/Nixpacks deploy builds on its own server, where a private git dependency cannot be fetched
at all.

Three small files in your repo — a target, a global setup, a test file. See
**[docs/consuming.md](docs/consuming.md)** for the walkthrough.

```ts
// mcp-tests/target.ts
export const target: McpTestTarget = {
  id: "my-server",
  canonicalOrigin: "https://my-server.test",
  mcpPath: "/mcp",
  deployment: {
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: { BASE_URL: "https://my-server.test" },
    portEnvironmentVariable: "PORT",
    readyPath: "/.well-known/oauth-protected-resource/mcp",
  },
  authorization: { /* how to sign a user in, and where the consent form is */ },
};

// mcp-tests/oauth.test.ts
defineOAuthConformanceSuites(target);
```

## Capabilities, not configuration

A target declares **what its server can do**, and each suite family requires what it needs. A server
with no OAuth still gets every family that does not need one.

| Family | Requires | Asks |
|:---|:---|:---|
| `discovery` | — | Can a client find you and start? Runs against a **remote** deployment, so you can point it at staging or production. |
| `oauth` | `authorization` | Can each vendor's client authorize, refresh, and reconnect? |
| `protocol` | — | Does the server answer revision `2026-07-28` in the shapes it mandates? |
| `webmcp` | `webMcp` | Do the pages that publish tools to an in-browser agent declare them the way the W3C draft states? |
| `tool-surface` *(next)* | — | Do the published tools satisfy the tool-design rules? |

**`webmcp` asserts against a different specification from the rest.** WebMCP is the browser API that
lets a page hand its own functions to an agent attached to the browser. It borrows MCP's vocabulary
and none of its wire — no JSON-RPC, no transport, no server, no OAuth — so no MCP clause binds a tool
published in a page. The *declarative* API is served HTML and provable over the wire; the imperative
`document.modelContext.registerTool(...)` is reached by an opt-in suite that drives a real Chrome
through `playwright-core` — an optional peer dependency shipping no browser binaries — and is the
only way to catch a page whose registration call never landed.

Adding a family never changes an existing one. See **[docs/extending.md](docs/extending.md)**.

## Requirements the spec offers, and advice it does not

MCP's `2026-07-28` revision removed the handshake and the session, made `server/discover` mandatory,
and made freshness hints required on every list. The `protocol` family fails on those, and on tool
names, schemas, list stability, and the two error channels.

It also **advises**, without failing, on everything the revision merely offers — server
`instructions`, `icons[]` and their sourcing rule, tool descriptions, an `outputSchema`, a
`listChanged` declaration. Each advisory names what it costs in a client that exists:

```
⚠ icons
  the server identity publishes no `icons[]`
    offered by:  MCP 2026-07-28 — Server Tools (`icons[]` with `src`, `mimeType`, `sizes`)
    read it at:  https://modelcontextprotocol.io/specification/2026-07-28/server/tools
    verified:    2026-08-29
    costs you:   VS Code renders them for servers, resources and tools since 1.105. Claude shows a
                 generic globe for a custom connector and closed the request as not planned […]
```

**Advisories never fail a run.** Bumping this package can turn a green run red only through a real
requirement.

## Requirements

- **Node 20+** in the test process. The *server under test* can be anything that serves HTTP — a Node
  entry point, a compiled Go binary, a launcher script — because the package spawns a command and
  speaks HTTP to it.
- **Vitest** as the test runner (a peer dependency).
- A **disposable database**, if your server has one. These suites write real users, grants, and
  tokens.

## Documentation

- **[docs/consuming.md](docs/consuming.md)** — wire it into a repository.
- **[docs/extending.md](docs/extending.md)** — add a vendor surface or a whole test family.
- **[AGENTS.md](AGENTS.md)** — how to work in this repository, and the release process.
- **[CHANGELOG.md](CHANGELOG.md)** — what changed, and which vendor facts were re-verified when.

## Versioning

Consumers pin a tag and bump deliberately, so a vendor-behaviour change never lands in a
consumer's CI unannounced. See [AGENTS.md § Versioning](AGENTS.md#versioning).

## Licence and contributing

[Apache License 2.0](LICENSE). Use it, fork it, ship it — commercially or otherwise. Keep the
attribution and state your changes; the patent grant and its retaliation clause come with it.

Copyright stays with OAKZONE, and Apache-2.0 §5 puts contributions under the same terms
automatically, so there is no CLA to sign. See [CONTRIBUTING.md](CONTRIBUTING.md) — it is short, and
the one rule it carries is the one that makes this package worth running.
