# Consuming the package

Three files in your repository, then one command. Nothing else about your project changes.

## 1. Install and pin

```bash
npm install --save-dev github:OAKZONE/mcp-client-tests#vX.Y.Z   # see Releases for the current tag
```

Pin a **tag**, never a branch. A vendor-behaviour change landing in your CI unannounced is exactly
what the tag prevents; you bump when you are ready to read what changed.

**A plain `devDependency` is right.** The repository is public, so it installs with no credentials
on any machine — including a build server that has none, which is the case that decides this. Reach
for `optionalDependencies` only if you deliberately want a build to proceed without the gate; the
cost is that npm continues silently when the package is missing, and you find out at typecheck
instead of at install.

The package builds itself on install (`prepare`), so no build step of your own is needed: about
13 s and 47 packages on a cold install.

### If your deploy builds from source

A Coolify/Nixpacks-style deploy builds on its own server and installs devDependencies, because its
build needs them — so it will install this package too, and pay that ~13 s, even though the deployed
image never runs a conformance test. Two things that do **not** work if you try to avoid it:
`npm ci --omit=dev` (the build needs those packages) and `--omit=optional` (it also prunes
transitive optional native deps such as `sharp` and `lightningcss`). The install cost is the price
of a source-built deploy; it is small, and it is the same whichever dependency type you choose.

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
    consentScopeFieldName: "scope", // optional; the name your permission checkboxes carry
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

**Name your consent controls if they are not called `scope`.** The package models a real browser: it
submits the checkbox `name` your page declares and nothing else. If your decision route reads
`selectedScopes`, set `consentScopeFieldName` to match, or every consent submits an empty capability
set. Nothing in any specification names this control — your server is not wrong, the package just
cannot guess.

**Do not disconnect your database client between suites.** They share one worker, so tearing the
pool down when one finishes takes it out from under the next; worse, an idle client erroring on a
pool with no `error` listener ends the worker process outright — which Vitest reports as *"Worker
exited unexpectedly"*, with no failing test and nothing in your server's log. Open it lazily, add a
no-op `pool.on("error")`, and release it from the capability's `close()`.

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

### The protocol family — `mcp-tests/protocol.test.ts`

Asks what your server publishes, against revision `2026-07-28`: `server/discover`, no session,
caching hints on every list, legal tool names, valid `inputSchema`s, a stable list across
connections, and both error channels.

```ts
import { defineProtocolConformanceSuites } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineProtocolConformanceSuites(target);
```

**It requires no capability.** If your MCP endpoint lists tools without a credential, that is all it
needs. If it refuses, it obtains one by driving a real authorization through the `authorization`
capability — so a gated server needs that block declared, and one without it stops the run with the
two ways out named rather than passing while looking at a `401`.

This family also prints **advisories** after its results: things the specification offers that your
server does not publish — `instructions`, `icons[]`, tool descriptions, an `outputSchema`, a
`listChanged` declaration — each with what it costs and the clause that offers it. **Advisories never
fail a run.** Adopting a new version of this package can turn your run red only through a real
requirement.

### The tool-surface family — `mcp-tests/tool-surface.test.ts`

Asks the question a consumer usually arrives with: the server is up, the connection is authorized,
the revision is right, the tool is in the list — **and it still does not run**, or it prompts on
every call, or it is present on one client and missing on another.

```ts
import { defineToolSurfaceConformanceSuites } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineToolSurfaceConformanceSuites(target);
```

**It requires no capability**, on the same terms as the protocol family: a public surface is read
directly, a gated one through a credential obtained from `authorization`.

**Why it is separate from `protocol`.** That family judges your surface against the specification.
This one judges it against **somebody else's software** — what a client's gate does with a list that
is already perfectly conformant. A tool can satisfy every clause of the tools contract and still be
dropped before the model sees it. Reporting both behind one failure message would leave you unable
to tell which of the two you had broken.

Between `tools/list` and execution sit five layers the client owns — admission, enablement,
approval, classification, content scanning — and a call can die at any of them with nothing reported
back to you. **`annotations` is the only one you can steer from the wire**, which is why it is the
only one asserted on, and why everything else here is advice that saves you debugging your own
endpoint.

**What it fails on** — each of these is a fact a vendor states outright:

- a tool publishing **no behavioural hint at all**. Unannotated is not neutral: the specification's
  stated default is non-read-only, potentially destructive, non-idempotent and open-world, and the
  clients act on exactly that — ChatGPT treats it as a **write** and confirms every call, Claude
  withholds auto-permission, and a Codex profile is reported to refuse it with no prompt;
- a tool with no `title` — the name a human is actually asked to approve;
- a tool claiming `readOnlyHint` and `destructiveHint` at once;
- a name over **64** characters, which is half what the specification permits and is what one vendor
  publishes as its limit;
- a schema property name outside `A-Z a-z 0-9 _ . -`, or over 64 characters, which one client
  validates and **drops the whole tool** over, logging the reason only to itself;
- one tool spanning safe (`GET`, `HEAD`, `OPTIONS`) and unsafe (`POST`, `PUT`, `PATCH`, `DELETE`)
  methods — the catch-all `api_request` shape, rejected by review, and explicitly not rescued by
  documenting the difference in the description;
- a description hiding text you cannot see: zero-width or bidirectional-control characters, an HTML
  comment, or an instruction to ignore what was said elsewhere.

**What it advises on** — the caps (one documented, two contested, four unknown), how many of your
tools would run unprompted, hints declared only in part, descriptions that merely *read* as
instructions, schemas that branch at the root, destructive tools and the surfaces where nothing will
ask, and the gates configured on the client that you can neither see nor fix.

**Advice is graded, and the grade decides what can fail you.** Every clause carries how well
established it is — `STRONG` for a primary source read directly, down through `MODERATE` and `THIN`
to `UNVERIFIED` — and the package **refuses to build an assertion on anything below `STRONG`**. That
is a structural guarantee rather than a convention: a widely-repeated tool ceiling that no vendor
ever published cannot turn your build red, however tempting the number is. It reaches you as an
advisory that prints its own grade, so you weigh it instead of taking a forum post for a
specification.

**Nothing here asks you to remove a capability to get past a gate.** A destructive tool that is the
point of your server stays in your server. The fix is honest annotation, a title a human can judge,
and a confirmation you own rather than borrow — because the client's prompt is absent wherever there
is no human, and every catalog you publish is reachable from at least one surface with no approval
gate at all.

### The discovery family — `mcp-tests/discovery.test.ts`

Asks the one question every other family assumes the answer to: **can a client find you and
start?** The `401` challenge, the protected-resource document, the authorization-server document,
and the URLs a client derives to reach them.

```ts
import { defineDiscoveryConformanceSuites } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineDiscoveryConformanceSuites(target);
```

**It needs no capability and no credential**, which makes it the one family that can run against a
server this package did not start:

```ts
export const target: McpTestTarget = {
  id: "stageify-dev",
  canonicalOrigin: "https://dev.stageify.net",
  mcpPath: "/mcp",
  deployment: { remote: true },   // already running — nothing is spawned or stopped
};
```

Point it at staging or production. Nothing is written, no client is registered, and the only
requests made are the ones an unauthenticated client makes anyway.

**What it fails on:** an unauthenticated call that is not a transport-level `401`; a challenge with
no `resource_metadata` pointer; an invalid token that does not come back `invalid_token`;
protected-resource metadata missing from a URL clients derive; the authorization-server document
missing from the RFC 8414 **inserted** path; an `issuer` that does not match the URL it was fetched
from; and a missing `S256`.

**What it advises on:** `offline_access` in the wrong document (the single most common reason
refresh silently never happens), CIMD advertised without both election conditions, a missing RFC
9207 `iss`, no registration path at all, an append-shaped discovery alias that no client derives,
and an origin-level authorization-server document naming a path-bearing issuer.

**What a clean run does *not* prove**, stated as an advisory on every run: no token was exchanged,
no consent screen submitted, no refresh attempted. Discovery being correct is not authorization
working.

**Remote targets cannot declare `authorization`.** The OAuth families create an account holder in
the server's storage and need the server to trust a certificate authority minted for the run — both
of which require this package to have started the process. Declaring both is refused with the two
ways out named, rather than half-honoured.

### The WebMCP family — `mcp-tests/webmcp.test.ts`

Asks what the **pages** of your deployment hand to an agent running inside the user's browser.

```ts
import { defineWebMcpConformanceSuites } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineWebMcpConformanceSuites(target);
```

**WebMCP is not MCP.** It is the W3C Web Machine Learning Community Group draft that lets a page
register its own functions as typed tools via `document.modelContext`. It borrows MCP's vocabulary —
tools, descriptions, JSON Schema — and none of its wire: no JSON-RPC, no transport, no server, no
OAuth. A tool registered this way runs in the user's tab, in their live authenticated session, with
no token, no scope and no consent step of its own. Nothing in the `protocol` or `oauth` families
says anything about it, and no assertion in this family cites an MCP clause.

**It requires the `webMcp` capability**, which names the pages that publish tools:

```ts
webMcp: {
  toolPages: ["/dashboard", "/orders"],
  // Only if those pages are behind a session:
  viewerCookie: { name: "session", value: process.env.CONFORMANCE_SESSION! },
  // Only if your pages load their own scripts from another origin:
  scriptOrigins: ["https://cdn.example.com"],
},
```

The pages are listed rather than crawled, because a crawler's reach would get reported as a finding
about your server.

**What it reads.** The *declarative* API is served HTML — a `<form>` carrying `toolname`,
`tooldescription` and `toolparamdescription` — so it is fetched through the same proxy translation
every other suite uses and asserted on directly. It also fetches your **script bundles** and
searches them, because registration almost never lives in an inline script: same-origin ones always,
and cross-origin ones only from the origins you name in `scriptOrigins`. An undeclared origin is
never fetched — that is what keeps a conformance run from pulling an arbitrary third party's CDN
into your CI — and a page that loads one gets an advisory naming what went unread. A declared bundle
that fails to come back is also an advisory, never a failure: a slow or unreachable CDN is a gap in
the run, not a defect in your server.

What that catches is the migration that breaks registration silently: the object moved from
`navigator.modelContext` to `document.modelContext`, Chrome deprecated the old spelling in
150.0.7861.0 and plans to remove it, and much third-party writing still shows it. **Source text is
the only place that fact lives** — both names reference one object on a browser that has the API, so
no amount of driving a real browser reveals which spelling your page wrote. That is why naming your
CDN origin matters if your registration ships in a bundle.

**It does not execute your page.** Whether `registerTool()` actually ran is not visible in text —
that is the browser suite below.

### Driving a real browser — `defineWebMcpImperativeSuite`

The only way to catch the documented silent failure: a page whose own tests are green while
DevTools reads zero tools, because registration never landed.

```ts
import { defineWebMcpImperativeSuite } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineWebMcpImperativeSuite(target);
```

**You do not have to configure the flag.** The suite launches Chrome with
`--enable-features=WebMCPTesting,DevToolsWebMCPSupport`, the command-line spelling of
`chrome://flags/#enable-webmcp-testing`. Override it with `launchArgs` (or `MCP_TESTS_CHROME_ARGS`)
if a Chrome release renames the feature, or to serve an origin-trial token instead.

**Chrome 149 or newer.** The flag exists from 146.0.7672.0 and the origin trial runs from Chrome 149
(through 156). If the launched browser is older there is nothing to enable, which is the first thing
the failure message tells you to check.

It loads each page in Chrome and asks it for its registered tools — the same question an attached
agent asks — then asserts every one carries the `name` and `description` the IDL requires, that names
are unique per document, and that **every page you declared in `toolPages` registered something**.
That last one is assertable precisely because you declared the page: registering nothing contradicts
your own claim, and both readings of that contradiction are real findings.

**Which reader it uses is discovered, not assumed.** The specification's IDL puts `getTools()` on
`document.modelContext`; Chrome's testing flag is documented as exposing a separate
`navigator.modelContextTesting`, whose reader two sources name differently (`getTools()` versus
`listTools()`). The suite probes each in turn and reports the one that answered in an advisory, so a
Chrome release that moves it shows up as a change rather than as your pages registering nothing.

**Install cost.** `playwright-core` is an **optional peer dependency** — about 14 MB, and it ships
**no browser binaries**. The browser is whatever Chrome the machine already has; point
`MCP_TESTS_CHROME_PATH` at one if it is somewhere unusual. A consumer who never registers this suite
installs nothing extra.

```bash
npm i -D playwright-core
```

**It is not registered by `defineWebMcpConformanceSuites`, on purpose.** Adopting a new version of
this package can turn your run red only through a real requirement — never through advice, and never
through missing infrastructure. So you name this suite explicitly, and a missing library, missing
binary, or a Chrome without the API stops the run with both ways out named. None of those is a
silent skip.

Under the hood it fronts your deployment with an HTTPS listener holding a certificate for your
canonical host and points Chrome at it with `--host-resolver-rules`, so the page loads on the origin
production serves — absolute URLs and all — and gets the secure context WebMCP requires.

**Most of what it has to say is advisory**, because by the explainer's own account the declarative
half is the less finished half — input-schema synthesis is marked TBD and the response mechanism is
under debate. Only what the specification *states* is asserted: every declarative tool carries the
`description` the IDL requires, and names are unique within a document. The security guidance —
undescribed parameters, `toolautosubmit` as a consent decision, over-parameterization as a privacy
leak — arrives as advice with the clause that offers it.

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
