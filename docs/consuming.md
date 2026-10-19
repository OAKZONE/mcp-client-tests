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
    consentScopeMarkerAttribute: "data-consent-scope", // optional; for a screen that states them
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

**If your screen states permissions instead of offering them, mark them.** A checkbox presents a
permission the holder may decline on its own. A deployment with one grantable scope has nothing to
put in a picker — the box would be pre-ticked and un-tickable, a control that decides nothing — so
it states the permission and its consequence, and Allow/Deny is the real choice. Put
`data-consent-scope="<the scope>"` on the element carrying each permission's text, and the suites
read what your screen presented. Both shapes are conformant; a screen the package can read neither
way is reported as presenting no permissions at all.

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

The protocol family also registers `defineSkillsConformanceSuite`. It reads `server/discover` first
and skips its assertions when `io.modelcontextprotocol/skills` is absent. An advertised extension
must declare Resources and implement `skills/list` and `skills/get`; complete manifests need
`resultType: "complete"`, non-negative integer `ttlMs`, and public/private `cacheScope`. The suite
pages through the listing and reads each listed skill's manifest. It checks required frontmatter,
explicit file manifests or `"dynamic"`, SHA-256 digest syntax, byte sizes, duplicate file URIs, and
the skill's own `SKILL.md` entry. It does not load instructions into a model or execute served code.
Alternative URI schemes and duplicate **skill names** are allowed; the recommended size limits are
not asserted. Content bytes and YAML frontmatter equality are not verified by these metadata checks.

Core results now require a non-empty `resultType`, including list results. Caching checks apply to
complete results; `input_required` intermediates and extension-specific result types are not judged
by the core caching contract. Negotiated extensions can add result types.

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
  clients act on that — ChatGPT treats it as a **write** with confirmation by default, Claude
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
tools declare read-only behavior (not a guarantee of unprompted execution), hints declared only in part, descriptions that merely *read* as
instructions, schemas that branch at the root, destructive tools and the surfaces where nothing will
ask, and the gates configured on the client that you can neither see nor fix.

For ChatGPT plugins, this also reports missing explicit annotation booleans, writes that may pause
scheduled Chat runs, destructive-action safeguards, and description wording that claims approval.
See [ChatGPT scheduled writes](chatgpt-scheduled-writes.md) for the source-backed diagnosis and
reproduction procedure. Allow all actions does not bypass safety protections; passing this suite
cannot certify unattended execution in ChatGPT.

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
  // Only tools that are safe to call, repeatedly, with no side effect:
  toolCalls: [{ page: "/orders", tool: "search-orders", arguments: { query: "widget" } }],
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
that is the browser suites below.

**It also asks whether the API can exist for a visitor at all**, in a second suite registered by the
same call and needing no browser either. In a stock production browser `document.modelContext` exists
only where the response carried an **origin-trial token**, so a page can be perfectly written, its
tools perfectly registered, and unreachable by everyone. That suite reads the token from the
`Origin-Trial` response header or a `<meta http-equiv="origin-trial">`, decodes it, and reports the
feature, the origin it enrols, and **the day it expires** — the day Chrome starts ignoring it, your
code does not change, and every tool goes quiet.

It fails only where a token is served and cannot work: expired, or issued for another origin. A page
serving no token at all is an advisory, because reaching it with the flag is a legitimate
arrangement.

**The origin half is skipped when your canonical origin is unroutable**, which it usually is — the
shape recommended above is `https://my-server.test`, and no origin trial can ever be registered for
a name that never resolves. Your production token therefore names a different origin by necessity,
and failing you for that would be reporting this package's own choice of origin as your defect. The
expiry is still asserted, the conditional-delivery check is unaffected, and an advisory records that
the origin went unchecked so you can confirm by hand that the token covers the origin you really
serve on. Run with a routable `canonicalOrigin` and the origin is judged normally.

**And it fetches every page twice**, differing only by a cookie your deployment has never heard of.
The token is read from *the response that carried it*, so a response served without it has no WebMCP
— which makes a header attached to a rule that can decline to match an outage for exactly the
visitors that rule declines, and for nobody else. A real deployment attached one to a rule that also
carried cache conditions: it would have been dead for exactly the visitors holding one particular
cookie, and perfect for every developer who ever loaded the page. One fetch cannot see that.

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

**It waits for your page to register, rather than reading it at `load`.** This matters more than it
sounds. `registerTool()` is a script call, and the imperative API exists to hand a *live
application's* own functions to an agent — so a real page registers from a framework lifecycle hook,
a React effect or `onMounted` or `onMount`, which fires after hydration, which is after `load`. A
read taken at `load` is not an early read; it is a read taken before the normal case can have
happened at all, and it reports every such page as registering nothing. Measured on a Next.js 16
production build in stock Chrome 152, four pages registered 220–350 ms after `load` and none of them
at `load`.

So each navigation waits for a registration made by **that document** — it listens for `toolchange`
on the new document's own `ModelContext`, with a bounded re-read of `getTools()` behind it — and
returns the moment one lands. A page that registers inline pays nothing; only a page that genuinely
registers nothing waits out the deadline, once.

**The deadline is 5000 ms, it is this package's number, and nothing published sets one.** Neither
the draft nor Chrome states when a page must have registered by, so a slow page is not violating
anything and the number never appears in a citation — only in the message, because *registered
nothing within 5000 ms of `load`* is something you can act on. Raise it per suite or for a whole run:

```ts
defineWebMcpImperativeSuite(target, { registrationTimeoutMs: 15_000 });
```

```bash
MCP_TESTS_WEBMCP_REGISTRATION_MS=15000 npx vitest run mcp-tests/
```

**A timeout is a named failure, never a skip and never an empty pass.** The run also reports, as an
advisory, when your pages actually registered — and names any that landed past half the deadline,
because a CI runner is routinely twice as slow as the machine you measured on and that page is the
one that goes intermittently red later.

**It also walks your pages in a single tab**, which is the only arrangement where a registration that
outlived its own document can be seen at all. There is no `unregisterTool`: a registration is taken
back by aborting the `AbortSignal` you passed to `registerTool`, which is what a document going away
does for you. When that does not happen the failure is silent and cumulative — nothing errors, and
every page a visitor opens adds to what the last one left behind, until the agent's list is mostly
tools it can no longer call. Every other assertion opens a fresh tab per page, so each starts from
nothing and none of them can see it. Declare two pages and it becomes observable; declare one and the
run says so rather than passing quietly.

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

### Running the browser suites in CI

Both browser suites **hard-fail** when they cannot find `playwright-core`, a Chrome, or the API.
That is deliberate — a conformance run that quietly tested nothing is the worst outcome available —
but it does mean registering them puts a browser on a publish-gating job's critical path. Here is
what that actually costs, verified rather than reasoned about on **2026-09-10**.

**On GitHub's `ubuntu-latest`, you install nothing.** The label currently resolves to Ubuntu 24.04
x64, whose image ships **Google Chrome 152.0.7977.64** at `/usr/bin/google-chrome` (with Chromium
152.0.7977.0 and ChromeDriver alongside). The suite launches Playwright's `chrome` channel when
`MCP_TESTS_CHROME_PATH` is unset, and on Linux that channel resolves to `/opt/google/chrome/chrome`,
which is where the Chrome `.deb` puts it. The flag the suite passes exists from Chrome 146.0.7672.0,
so 152 is not marginal — it is six milestones clear.

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: npm }
- run: npm ci
- run: node -e "require.resolve('@oakzone/mcp-client-tests/package.json')"
- run: npm run build
- run: npx vitest run --no-file-parallelism mcp-tests/
```

**Where a Chrome is not already there** — a container image, a self-hosted runner, a pinned older
image — one step installs one:

```yaml
- run: npx playwright-core install --with-deps chrome
```

**Mind the spelling.** It is `playwright-core`, the package this suite already needs. The familiar
`npx playwright install …` would pull a *second*, different package off the registry at whatever
version `npx` resolves. `--with-deps` installs the system libraries Chrome needs and wants root or
`sudo`, which a GitHub-hosted runner gives it. In a container running as root, Chrome additionally
refuses to start without `--no-sandbox`; pass it through `MCP_TESTS_CHROME_ARGS` **alongside** the
feature switch, since that variable replaces the default rather than adding to it:

```yaml
- run: npx vitest run --no-file-parallelism mcp-tests/
  env:
    MCP_TESTS_CHROME_ARGS: "--enable-features=WebMCPTesting,DevToolsWebMCPSupport --no-sandbox"
```

**Is Playwright's bundled Chromium a valid substitute? Yes — with a version trap.** This is the
first thing most people try, so it is worth being exact. Launched with the same switch, on
2026-09-10:

| Binary | Version | `document.modelContext` | `navigator.modelContext` |
|:---|:---|:---|:---|
| Google Chrome (system) | 152.0.7977.83 | yes | **no — removed** |
| Playwright bundled Chromium | 151.0.7922.34 | yes | yes (same object) |
| Playwright headless shell | 151.0.7922.34 | yes | yes (same object) |
| Playwright bundled Chromium | 149.0.7827.55 | **no** | yes |

So the feature is genuinely in the open-source build, and even the stripped headless shell has it —
`playwright-core` 1.63 downloads Chrome for Testing 153.0.8010.12 as its "chromium", which is
Chrome's own build line. The trap is that **the version comes from your Playwright version, not from
your choice**: on a Playwright old enough to pin Chromium 149 there is no `document.modelContext` at
all, so a page written to the current spelling registers nothing and the run reports your page. The
system Chrome is the better default because it is both current and the thing your users actually
run. Reach for the bundled one only where no system Chrome exists, and pin a Playwright new enough
to matter:

```yaml
- run: npx playwright-core install --with-deps chromium
```

```ts
defineWebMcpImperativeSuite(target, {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
});
```

**Budget the wall clock.** Each declared page is loaded once per suite, and each load waits only
until that page registers — a few hundred milliseconds for a page that registers on hydration. The
cost that is not small is a page registering **nothing**: that one waits the full deadline, so a
broken run is slower than a healthy one, not faster.

### Calling your tools — `defineWebMcpExecutionSuite`

Nothing above ever calls a tool, so nothing above touches the two shapes a caller meets on **every
single call** — how `inputSchema` is encoded, and what `executeTool` accepts.

```ts
import { defineWebMcpExecutionSuite } from "@oakzone/mcp-client-tests";
import { target } from "./target";

defineWebMcpExecutionSuite(target);
```

**The current draft uses objects.** `RegisteredTool.inputSchema` is optional and object-shaped,
and `executeTool` takes a JavaScript object. Older Chrome exposed string schemas and required JSON
strings. The suite feature-detects that legacy surface and calls each declared tool once, selecting
the encoding from the returned schema shape. It never retries a handler error with another encoding.
Omitted schemas are allowed; malformed provided schemas fail. Advisories record the shape seen and
whether parameter round-trip checking had enough schema information to run.

**It also checks the round trip, which is not a WebMCP property at all.** Every value a tool's result
reports for a parameter must be a value that parameter accepts. A surface can print a filter as `on`,
publish `{"type":"boolean"}` for it, and accept `"true"` in its handler — three spellings, each
internally consistent, and a model that copies the printed value back earns a refusal for doing
exactly what the payload invited. That one was found in a browser after surviving 49 unit tests,
three adversarial review passes, and a design that explicitly called for the correct behaviour,
because every test asserted the producer's output against a literal instead of feeding it back
through the consumer. This suite feeds it back, with your own published schema as the consumer, and
reports a refusal only where the schema is unambiguous — a `type`, an `enum`, a `const`, a bound, a
pattern. A schema carrying `anyOf`, `oneOf` or `$ref` is not judged at all.

**It calls your code, so you have to name what it may call**, in `webMcp.toolCalls`. That is a fact
about the tool — "this one performs no side effect and these arguments are valid for it" — in the
same way `consentFormId` is a fact about your consent screen. Each named tool is called **more than
once per run**, because every published argument encoding is attempted whatever the first one does.
Name only read-only tools, and expect them to be called on every conformance run. Declare none and
nothing is executed: the run then records what it could not observe rather than passing on a surface
it never touched.

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
