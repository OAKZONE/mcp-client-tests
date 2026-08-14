# Consuming the package

Three files in your repository, then one command. Nothing else about your project changes.

## 1. Install and pin

```bash
npm install --save-dev github:OAKZONE/mcp-client-tests#vX.Y.Z   # see Releases for the current tag
```

Pin a **tag**, never a branch. A vendor-behaviour change landing in your CI unannounced is exactly
what the tag prevents; you bump when you are ready to read what changed.

The package builds itself on install (`prepare`), so no build step of your own is needed.

## 2. Describe your server — `mcp-tests/target.ts`

```ts
import type { McpTestTarget } from "@oakzone/mcp-client-tests";

export const target: McpTestTarget = {
  id: "my-server",

  // The origin your server BELIEVES it is served on. HTTPS, normally port-free — this is what its
  // issuer, `resource`, redirect targets, and Secure cookies are derived from. The package delivers
  // requests to a loopback port with `Host` and `X-Forwarded-*` set, reproducing the proxy split
  // every deployment actually runs behind.
  canonicalOrigin: "https://my-server.test",
  mcpPath: "/mcp",

  deployment: {
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: {
      // Whatever makes your server believe `canonicalOrigin`, plus its secrets and a database URL
      // pointing at a DISPOSABLE database.
      BASE_URL: "https://my-server.test",
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
    },
    portEnvironmentVariable: "PORT",
    readyPath: "/.well-known/oauth-protected-resource/mcp",

    // Optional, and worth writing: a clear refusal beats a mysterious readiness timeout.
    preflight: () =>
      existsSync("dist/server.js")
        ? undefined
        : "No build found — run `npm run build` first.",
  },

  // Optional. Supply it and the OAuth conformance family runs; omit it and it skips.
  authorization: {
    consentFormId: "consent-approve",
    accessTokenSeconds: 5, // optional; unlocks the expiry → refresh → retry path
    async createAccountHolder(suiteId) { /* … */ },
    async clearAccountHolders(suiteId) { /* … */ },
    async close() { /* … */ },
  },
};
```

### The authorization capability, honestly

`createAccountHolder` must produce a **real** signed-in user in the running server's storage and
return the cookie a browser would actually hold. Nothing about the flow may be shortcut: the consent
leg runs against your real consent page, submitted by a modelled browser that computes its `Origin`
from that page's own `Referrer-Policy`. If you stub the session, you are testing a fiction.

**Namespace by `suiteId`.** Suites share one deployment, so a cleanup keyed on something they all
share deletes a sibling's signed-in holder — which surfaces as every consent screen redirecting to
your login page, a failure that reads exactly like a broken deployment.

## 3. Start it once — `mcp-tests/global-setup.ts`

```ts
import { provisionMcpTestRun } from "@oakzone/mcp-client-tests";
import { target } from "./target";

export default async () => (await provisionMcpTestRun(target)).teardown;
```

Point your runner at it:

```ts
// vitest.config.ts
export default defineConfig({
  test: { globalSetup: ["./mcp-tests/global-setup.ts"] },
});
```

If your project already has a `globalSetup`, add this as a second entry — the array runs in order and
teardowns run in reverse, which matters when your first entry provisions the database the server
connects to.

## 4. Register the suites — `mcp-tests/oauth.test.ts`

```ts
import { defineOAuthConformanceSuites } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineOAuthConformanceSuites(target);
```

Or one surface at a time, which is what you want when a surface turns out to be unreachable and the
fix is a real change rather than a config edit:

```ts
import { defineClaudeDesktopSuite, defineClaudeCodeSuite } from "@oakzone/mcp-client-tests";
defineClaudeDesktopSuite(target);
defineClaudeCodeSuite(target);
```

## 5. Run it

```bash
npm run build          # the suites drive a real build and never produce one for you
npx vitest run --no-file-parallelism mcp-tests/
```

**Run the files serially.** One deployment serves every suite, exactly as a real one does, and
deployment-wide abuse buckets are small by design — concurrent suites exhaust each other's budget and
turn a finding into a race.

**Make it its own gate, not part of your default `test` script.** It needs a build and a database and
runs in minutes. A consumer that folds it into `npm test` either slows every change or, worse, has it
silently skipped in the one place it mattered.

## Diagnosing a failure

In order, because most failures are explained two steps earlier than they surface:

1. **The failure message** — it carries the clause, its URL, its verification date, and for the
   browser leg the whole navigation walk with statuses and redirect targets.
2. **Your server's own log** — its path is printed at the start of every run
   (`mcp-client-tests: server log at …`). Opaque protocol refusals almost always have a cause there
   that the wire deliberately does not carry.
3. **Is it the harness?** Two artefacts are known and fixed, and both looked like server faults: a
   pooled keep-alive socket producing a bare `400` with no body, and a shared cleanup marker deleting
   a sibling suite's holder. If a new failure is fast, empty, and untraceable in your server log,
   suspect that class before filing a finding — and please report it.

## When a test fails, what changes

The server. Read the citation first: if the clause says what the assertion says, the finding is real.

Change a **profile** only when the vendor's documentation changed, and update its `verifiedAgainst`
date in the same commit. A profile edited to make a red test green has converted this into a
regression suite for your own behaviour, which is worse than not running it.
