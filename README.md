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
| `oauth` | `authorization` | Can each vendor's client authorize, refresh, and reconnect? |
| `tool-surface` *(next)* | — | Do the published tools satisfy the tool-design rules? |
| `protocol` *(next)* | — | Does the transport answer in the shapes the spec mandates? |

Adding a family never changes an existing one. See **[docs/extending.md](docs/extending.md)**.

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
