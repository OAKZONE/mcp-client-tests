# Changelog

## v0.8.0 — The client gate: why an authorized tool still does not run, and an evidence grade that decides what may fail you

Everything this package asserted until now answered one of two questions: can a client **reach**
your server, and does what it finds there match the specification. A consumer can pass both and
still have tools that are "hit and miss" across clients — disabled before they are ever called,
prompted for on every use, or refused by a safety layer for calls the server was built to serve.

That third question now has a family. It also has a constraint the other families never needed:
**most of what is known about how clients gate tools is not published by anybody.** The ceiling
people quote for one client comes from an issue log; for another it is contested between two figures
that differ by a factor of two; for four more it is unknown. So this release adds the grading
mechanism first and the assertions second — because without the grade, the most quotable facts here
are exactly the ones that would eventually fail a correct server.

### Added — evidence grades, and a guard that makes them binding

Every clause in `specifications.ts` now carries an `EvidenceGrade`, in the vocabulary the vendor
documentation already uses:

| Grade | What it means | What the package may do with it |
|:---|:---|:---|
| `strong` | A primary source read directly, or behaviour reproduced live. | **Assert.** |
| `moderate` | Vendor prose with no testable assertion, or a single field report. | Advise. |
| `thin` | An uncorroborated community report. | Advise, printed with what is missing. |
| `unverified` | A gap recorded rather than guessed at. | Advise, or nothing. |

**`cite()` now throws when handed anything below `strong`**, naming `advise()` as the way out. This
is the part worth knowing before you bump: it is not a convention a future contributor can quietly
drift past, it is a structural guarantee that **a number no vendor ever published can never turn
your build red**. A clause built with `clause()` is `strong` by construction; grading one down uses
`graded()`, which demands a caveat saying what corroboration is missing.

Advisories render under the relation their clause earns — `offered by:` for a `strong` one,
`reported by:` for anything less, with the grade and caveat printed beside it. The renderer picks,
not the call site, so a community report can never be presented as though a vendor had stated it.
New `reports()` export for the third relation.

### Added — the `tool-surface` family

```ts
import { defineToolSurfaceConformanceSuites } from "@oakzone/mcp-client-tests";
defineToolSurfaceConformanceSuites(target);
```

**Requires no capability**, on the same terms as `protocol`. It is opt-in like every family, so
**nothing goes red until you register it**.

Between `tools/list` and execution sit five layers the client owns — admission, enablement,
approval, classification, content scanning — and a call can die at any of them with nothing reported
back. **`annotations` is the only one you can steer from the wire**, so it is the only one asserted
on. Everything else is advice that saves you debugging an endpoint that was never the problem.

**What fails** — each a fact a vendor states outright:

- **A tool publishing no behavioural hint at all.** Unannotated is not neutral: the specification's
  stated default is non-read-only, potentially destructive, non-idempotent and open-world, and the
  clients act on exactly that. ChatGPT treats an unhinted tool as a **write** and confirms every
  call — with approval memory that lasts one conversation and resets on refresh, so it never stops
  asking. Claude withholds auto-permission. A Codex profile is reported to refuse it outright.
- **A tool with no `title`** — the name a human is actually asked to approve. `create_deployment` is
  a decision somebody can make; `svc_dpl_create_v2` is a decision they decline.
- **A tool claiming `readOnlyHint` and `destructiveHint` at once.**
- **A name over 64 characters** — half what the specification permits, and what one vendor publishes
  as its limit. An over-long name is reported to fail the whole server connection, not the one tool.
- **A schema property name outside `A-Z a-z 0-9 _ . -`, or over 64 characters.** One client runs the
  API's own checks at load time and **drops the whole tool**, logging the reason only to itself. A
  tool that works in one client and is missing in another is this far more often than it is an
  authorization problem.
- **One tool spanning safe (`GET`, `HEAD`, `OPTIONS`) and unsafe (`POST`, `PUT`, `PATCH`, `DELETE`)
  methods** — the catch-all `api_request` shape, named explicitly as a rejection, and explicitly not
  rescued by documenting the difference in the description.
- **A description hiding text a user cannot see** — zero-width or bidirectional-control characters,
  an HTML comment, or an instruction to ignore what was said elsewhere.

**What advises**: how many of your tools would run unprompted (the figure that moves when the
annotations land), hints declared only in part, catalog size against every published cap with its
grade, descriptions that merely *read* as instructions, schemas that branch at the root, destructive
tools and the surfaces where nothing will ask, and the gates configured client-side that you can
neither see nor fix.

**Detection is deliberately narrow where a guess would be cheap.** A generic `action` enum is not
flagged as mixed read/write — only HTTP methods, which is the shape the source names — and a
cross-tool reference like "copy an id from `find_report`" is never read as steering, because that is
something the tool-design rules positively ask for. A gate that fails correct servers gets switched
off, taking every true finding with it.

**Nothing here recommends removing a capability to get past a gate.** A destructive tool that is the
point of your server stays in your server; the fix is honest annotation, a title a human can judge,
and a confirmation you own rather than borrow.

### Added — the per-client gate matrix, as data

`src/profiles/client-gates.ts` carries one `ClientGate` row per client **surface** — ChatGPT, Claude
hosted, Claude Code, VS Code Copilot, Codex CLI, Cursor, and the Messages API connector — each with
its annotation handling, tool cap, approval default, classifier, and administrator off-switch, and
each field citing its source. Findings render from these rows, so a re-verification that moves one
client's behaviour moves every message quoting it.

The Messages API row is the design constraint behind all of them: **every catalog you publish is
reachable from at least one surface with no approval gate at all.**

Exported: `CLIENT_GATES`, the individual rows, `unannotatedConsequences()`, `toolCapSummary()`.

### Changed

- **`readPublishedTools()` moved into the harness** (`harness/tool-listing.ts`), shared by the
  `protocol` and `tool-surface` families rather than duplicated. `PublishedTool`,
  `publishedToolNames()` and `nameSome()` come with it. No assertion changed; the `protocol` family
  reads the same list by the same negotiation as before.
- `SpecificationClause` gained `grade` and an optional `caveat`. A clause built by `clause()` is
  `strong`, so no existing citation changed meaning.
- The advisory report header now says how many entries cite a source graded below `STRONG`.
- **The "cannot see the surface" error names the calling family and the remote dead end.** It
  previously said "the protocol suites" whoever was asking, and offered two ways out of which a
  `remote` target can only ever take one. It now names the suite, and says plainly that a remote
  deployment cannot obtain a credential at all — register `defineDiscoveryConformanceSuites` there
  instead. Verified against a live gated server during the release gate.

### Toolkit alignment

Pinned to `@oakzone/agent-toolkit#v0.70.0`, whose research this release is written from, and added
the `PROJECT-MAP.md` this repository never had — which is why the MCP framework guides were not
loading here at all. All four are now enabled and deliberately unscoped: scoping pays where MCP is a
*feature*, and here it is the *product*.

### Migration

**Register the new family to get the new findings** — `defineToolSurfaceConformanceSuites(target)`.
Until you do, your run is unchanged.

Expect it to be red the first time on a surface that has never been annotated, and read the
failures in this order: `title` and one honest hint on every tool, then split anything spanning read
and write. Those two are most of the distance, and they are what the number in the
"auto-permission" advisory measures.

## v0.7.0 — WebMCP joins as a family of its own, driven in a real browser, and a redirect fact we had backwards is corrected

Two unrelated things, both worth a consumer's attention before bumping.

**A vendor fact was recorded inverted, and a passing test was enforcing it.** This package described
ChatGPT's stable OAuth redirect as a legacy path and asserted that a deployment should *not* depend
on it. OpenAI documents the opposite. A consumer that did the recommended thing had a red test for
it; a consumer that read our docstring was steered onto the fallback. That is exactly the failure
mode this package exists to prevent, so it is called out first.

**WebMCP is now a family**, and it is deliberately not folded into the MCP ones.

### Fixed — the ChatGPT redirect URI, which was the wrong way round

`https://chatgpt.com/connector_platform_oauth_redirect` is the **recommended** form, not a legacy
one: *"If your authorization server meets those requirements, ChatGPT uses the stable redirect URI
…"* The requirement is RFC 9207 issuer identification — returning `iss` on the authorization
response. The per-connection `https://chatgpt.com/connector/oauth/{callback_id}` form is the
**fallback**, for servers that do not. The matching CIMD client ids follow the same split:
`https://chatgpt.com/oauth/client.json` with `iss`, `https://chatgpt.com/oauth/{callback_id}/client.json`
without.

- `CHATGPT_LEGACY_REDIRECT_URI` → **`CHATGPT_STABLE_REDIRECT_URI`**, and `CHATGPT_REDIRECT_URI` →
  **`CHATGPT_PER_CONNECTION_REDIRECT_URI`**. Both old names are gone rather than aliased, because an
  alias called `LEGACY` would keep teaching the inverted fact.
- New `chatgptRedirectUri(emitsIss)` and `chatgptClientIdMetadataUrl(emitsIss, callbackId)` express
  the split as data.
- **The test `"does not depend on the legacy shared callback"` is replaced.** It failed a deployment
  for registering the recommended URI. In its place: the suite reads your own
  `authorization_response_iss_parameter_supported` advertisement and checks that the redirect form
  ChatGPT would therefore send is registrable exactly. **A consumer that was green may now be red
  here** — and if so it is a real finding: a server advertising `iss` receives the stable redirect
  and is unreachable from ChatGPT if it has never allowlisted it.

### Added — the `discovery` family, and remote targets

`defineDiscoveryConformanceSuites(target)` asserts the authorization surface a client reads **before
it has a token**: the `401` challenge, the protected-resource document, the authorization-server
document, and the URLs a client derives to reach them.

It requires no capability and no credential, which is what makes the second half possible: a target
may now declare `deployment: { remote: true }` instead of a `DeploymentSpec`, naming a server that is
**already running**. Point it at staging or production. Nothing is spawned, nothing is written, and
the only requests made are the ones an unauthenticated client makes anyway.

**Fails on:** an unauthenticated call that is not a transport-level `401`; a challenge with no
`resource_metadata` pointer; an invalid token not answered `invalid_token`; protected-resource
metadata absent from a derived URL; the authorization-server document absent from the RFC 8414
**inserted** path; an `issuer` that does not match the URL it came from; a missing `S256`.

**Advises on:** `offline_access` in the protected-resource document instead of the
authorization-server one (the most common reason refresh silently never happens), CIMD advertised
without both election conditions, a missing RFC 9207 `iss`, no registration path at all, an
append-shaped discovery alias no client derives, and an origin-level authorization-server document
that names a path-bearing issuer — which RFC 8414 §3.3 requires a client to refuse, so it cannot be
used even by accident.

**And one standing advisory every run:** discovery being correct is not authorization working. A
clean report means a client can find you and start; it is not evidence the flow completes.

**A remote target may not declare `authorization`.** The OAuth families write an account holder into
the server's storage and need the server to trust a per-run certificate authority — both of which
require this package to have started the process. The combination is refused with both ways out
named rather than half-honoured, because suites failing for infrastructure reasons read as findings.

### Added — the `webmcp` family

`defineWebMcpConformanceSuites(target)`, gated on a new **`webMcp`** capability naming the pages that
publish tools (`toolPages`, plus an optional `viewerCookie` for pages behind a session).

**WebMCP is not MCP**, and the family is separate for that reason rather than for tidiness. It is the
W3C draft that lets a page register its own functions as typed tools for an agent attached to the
browser; it borrows MCP's vocabulary and none of its wire — no JSON-RPC, no transport, no server, no
OAuth. A tool registered this way runs in the user's tab, in their live authenticated session, with
no token, no scope and no consent step of its own. No assertion in this family cites an MCP clause,
and mixing the two is how a reader carries MCP's security model onto a surface that has none of its
controls.

**What it proves over the wire**, from the served HTML of each declared page:

- **Every declarative tool carries the `description` the IDL requires.** `ModelContextTool` requires
  `name` and `description`; a form with `toolname` and no `tooldescription` asks a model to choose it
  on the name alone.
- **Tool names are unique within a document.** Tools are registered per `Document`, so two forms
  claiming one name leave the agent unable to address either predictably.

**What it advises**, with the clause that offers it — none of it fails a run:

- Parameters with no `toolparamdescription`, which leave the model inferring meaning from a form-field
  name and filling it confidently and wrongly.
- `toolautosubmit`, which is a consent decision wearing the clothes of a convenience flag.
- Over-parameterization, which leaks by the tool being *called*, not by being misused.
- A page reaching `navigator.modelContext` and never `document.modelContext` — the object moved,
  Chrome deprecated the old spelling in 150.0.7861.0 and plans to remove it, and this registers today
  and stops registering on an unannounced browser update, silently.

**Script bundles are fetched and searched**, because registration almost never lives in an inline
script and reading only those would report every bundled page as registering nothing. Same-origin
bundles always; cross-origin ones only from origins the deployment names in the new
`webMcp.scriptOrigins` capability field. An undeclared origin is never fetched — that is what keeps
a run from pulling an arbitrary third party's CDN into a consumer's CI, or reporting somebody else's
bundle as their defect — and a page loading one gets an advisory naming what went unread. A declared
bundle that fails to return is also an advisory rather than a failure: a slow or unreachable CDN is a
gap in the run, not a finding about the server.

**Why the allowlist earns its place:** which spelling a page used is visible *only* in source text.
On any browser that has the API, `navigator.modelContext` and `document.modelContext` reference one
object, so driving a real browser cannot reveal the page's choice. A team shipping registration from
their own CDN would otherwise have no route to that check at all.

### Added — `defineWebMcpImperativeSuite`, which drives a real browser

The declarative suite reads text and therefore cannot see whether `registerTool()` ran. This one
loads each declared page in Chrome and asks it `getTools()` — the same question an attached agent
asks — which is the only way to catch the failure the platform documentation names: a page whose own
tests are green while DevTools reads zero tools, because registration never landed. The `navigator`
→ `document` migration broke exactly that class of test.

What it fails on: every registered tool carries the `name` and `description` the IDL requires; names
are unique per document; and **every page declared in `toolPages` registered something**. That last
one is assertable precisely because the consumer declared the page — registering nothing contradicts
their own claim, and both readings of it (the list is wrong, or the call never landed) are real
findings.

What it advises on: a page that registered through the deprecated `navigator` spelling, a tool
declaring none of the three annotations, and a tool claiming `readOnlyHint` — which nothing verifies
and nothing requires an agent to honour, so on a tool that writes it is a shipped vulnerability
rather than a mislabel.

**The install cost is deliberately small.** `playwright-core` is an **optional peer dependency** —
about 14 MB, shipping **no browser binaries**; the browser is whatever Chrome the machine already
has, or `MCP_TESTS_CHROME_PATH`. A consumer who never registers this suite installs nothing extra.

**It is not registered by `defineWebMcpConformanceSuites`.** This package's standing promise is that
a new version can turn a green run red only through a real requirement — never through advice, and
never through infrastructure. Auto-registering a browser-driven suite would break every existing
consumer's run with a missing-Chrome error, which is neither a finding about their server nor
something they asked for. So it is named explicitly, and a missing library, a missing binary, or a
Chrome without the API stops the run **with both ways out named** rather than skipping silently.

**The flag is configured for you.** Chrome is launched with
`--enable-features=WebMCPTesting,DevToolsWebMCPSupport` (exported as `WEBMCP_LAUNCH_ARGS`), the
command-line spelling of `chrome://flags/#enable-webmcp-testing`. Chrome documents the flag
(146.0.7672.0+) and the origin trial (149–156) but **not** the switch, which comes from a single
secondary source — so it is a default the suite can be overridden out of via `launchArgs` /
`MCP_TESTS_CHROME_ARGS`, never a fact this package asserts. The API's presence is verified before any
conclusion is drawn from a page, so a renamed switch produces a named stop listing what to try, not a
page reported as publishing nothing.

**The reader is discovered rather than assumed.** The specification's IDL puts `getTools()` on
`document.modelContext`; Chrome's testing flag is documented as exposing a separate
`navigator.modelContextTesting`, and published sources name its reader differently (`getTools()`
versus `listTools()`). The suite probes each and reports which answered, turning a documentation
conflict into evidence from the machine that ran the suite.

To reach the page the way production serves it, the harness fronts the deployment with an HTTPS
listener holding a certificate for the canonical host and points Chrome at it with
`--host-resolver-rules`, so absolute URLs resolve and the page gets the secure context WebMCP
requires.

### Added — icon `theme`, and the trap in publishing only tuned variants

The `Icon` shape also carries `theme?: "light" | "dark"`. **Absent is not a default of light** — the
spec says a client "should assume the icon can be used with any theme" — and the spec states **no
rule for how a client chooses among several icons**.

That silence is the whole constraint. A server publishing only `light` and `dark` variants cannot
rely on any client finding the one matching its ground: a client that ignores `theme`, or that takes
the first renderable entry, draws whichever came first. A mark that was merely *untuned* becomes one
drawn *for the wrong ground*, with no error and no fallback.

New advisory in the `protocol` family (`icon themes`) reports a tagged-only set, or an untagged entry
published behind tagged ones. **Advice, not a requirement** — what it hedges against is an absence in
the specification, and a server publishing a single untagged icon was correct before and is correct
now.

### Changed

- **`parseAttributes` moved to a new `harness/html.ts`**, shared by the modelled browser and the
  WebMCP surface. Two copies of an attribute parser is two places for a quoting bug to live, and a
  quoting bug there misreports a consumer's page as publishing something it does not. Internal; no
  export changed.
- **`createLoopbackTlsMaterial` takes optional extra SAN hostnames**, so the browser front can hold
  a certificate for the deployment's canonical host. Existing callers are unchanged.
- **`EdgeTarget` gained `remote`**, and the transport dials the real host over TLS when it is set,
  omitting the forwarded headers — a remote deployment already sits behind its own proxy, and
  supplying a second set would describe a hop that did not happen.
- **New exports**: `defineDiscoveryConformanceSuites`, `defineAuthorizationSurfaceSuite`,
  `RemoteDeployment`, `TargetDeployment`, `isRemoteDeployment`; `WEBMCP` clauses, `WebMcpCapability`,
  the WebMCP surface readers
  (`declarativeWebMcpTools`, `declarativeToolProblem`, `duplicateDeclarativeToolNames`,
  `undescribedParameters`, `imperativeRegistrationStyle`, `inlineScriptText`, `scriptSources`,
  `triageScriptUrls`), and the browser harness (`openWebMcpBrowser`, `startCanonicalProxy`).
- **Toolkit pin moved to v0.69.0.** Development-time only; nothing a consumer installs changes.

### Consumer action

1. **If you name the ChatGPT redirect constants**, rename them (`CHATGPT_STABLE_REDIRECT_URI`,
   `CHATGPT_PER_CONNECTION_REDIRECT_URI`).
2. **If your ChatGPT suite goes red on the redirect test**, read it as a finding rather than a
   regression: your server advertises `iss`, so ChatGPT sends the stable URI, and it must be
   registrable.
3. **The `webmcp` family costs you nothing until you declare `webMcp`.** No existing family changed,
   and the browser suite is opt-in on top of that — `npm i -D playwright-core` only if you register
   `defineWebMcpImperativeSuite`.

## v0.6.0 — The stateless revision, asserted; and everything it merely offers, advised

MCP shipped its largest revision since launch on 2026-07-28, and it is mostly **subtractive**, which
is the dangerous kind: a server built on the old assumptions keeps passing its own tests while the
ground moves. The handshake is gone. The session is gone. `server/discover` is mandatory, freshness
hints are required on every list, and list results may no longer vary per connection.

This release adds the `protocol` family, which asserts that revision over the real wire, and a
second outcome beside pass and fail — an **advisory** — for the large amount the revision *offers*
and does not require.

### Added

- **The `protocol` family** — `defineProtocolConformanceSuites(target)`. It **requires no
  capability**: a server that lists tools unauthenticated needs nothing, and one that refuses
  obtains a credential through the target's existing `authorization` capability. A gate it cannot
  get through stops the run and names both ways out, rather than passing while looking at a `401`.
  What it fails on:
  - **`server/discover` is answered.** It is mandatory on this revision, and it is not hypothetical
    traffic — Claude Code's v2 runtime probes HTTP and claude.ai connector servers with it and uses
    the newer revision with those that answer. A server that does not implement it is invisible to
    that probe and stays on the deprecated revision by default.
  - **The discovery result advertises the revisions it supports.** With no handshake left to
    negotiate one, `supportedVersions` is how a client decides what to speak; answering the probe
    without naming them tells it nothing it can act on.
  - **No `Mcp-Session-Id` is minted** for a stateless request. A server still minting one is keeping
    per-connection state its list results are no longer permitted to depend on.
  - **`ttlMs` and `cacheScope` are present** on `server/discover`, on every list the server
    implements, and on `resources/read`. Absent is not neutral: a client assumes `ttlMs: 0` and
    treats the result as immediately stale, so omitting them asks every client to re-fetch
    everything, forever.
  - **Tool names are inside the published vocabulary** — 1–128 characters from `A-Z a-z 0-9 _ - .`,
    none published twice — and **every `inputSchema` is a JSON Schema object**, never null.
  - **The tool list is identical, in order, on a second connection.** Order is part of the contract,
    and on this revision a list may vary only by the authorization presented.
  - **An unknown tool comes back as a protocol error**, not as a result carrying `isError`.
    Returning it as a result teaches the model the tool exists and failed.
- **Advisories** — a third outcome that never fails a run (`advise`, `reportAdvisories`, `offers`,
  all exported). The `protocol` family reports what the revision offers and the server does not
  publish, each with the clause that offers it and **what it costs in a named client**: server
  `instructions` (ChatGPT's host reads them), `icons[]` and their same-authority sourcing rule (VS
  Code renders them since 1.105; a CDN-hosted icon silently does not load), tool descriptions, an
  `outputSchema`, a `listChanged` declaration, and a `tools/list` marked `public` while fetched with
  a credential.
- **RFC 9207 `iss` on the authorization response** (Claude Code suite). Where the authorization
  server advertises `authorization_response_iss_parameter_supported`, the response must carry `iss`
  equal to the issuer — Claude Code now **fails the sign-in outright** on an unexpected issuer, and
  it presents as a broken consent screen rather than as an issuer error. Where the server does not
  advertise it, this is an advisory instead: emitting `iss` is what ChatGPT requires before offering
  stable OAuth redirect URLs with client-ID metadata (2026-08-21).

### Changed

- **All three vendor profiles re-read 2026-08-29** against the re-verified vendor documentation.
  **No OAuth field moved on any of them**; each `verifiedAgainst` records the re-read, because
  "checked, unchanged" is information. What was recorded instead is behaviour a server owes these
  clients: Claude Code probes for `2026-07-28`, refreshes on `list_changed` under hard stream-reopen
  limits, and enforces `iss`; the hosted Claude surfaces' revision is **Unverified** and their
  connector tool lists have been reproduced surviving reconnect, delete-and-re-add, restart and
  rename; ChatGPT's revision is **Unverified** and its branding comes from directory submission
  assets rather than from MCP `icons[]`.
- `src/harness/specifications.ts` carries the `2026-07-28` clauses under their own read date, and
  four new vendor sources: the Claude Code MCP reference, the VS Code MCP developer guide, the
  OpenAI plugin changelog, and Anthropic's *Writing tools for agents*.

### Verified

Driven end to end against a real consumer's deployment — a production build, a real Postgres, a real
socket — twice. The first run found a defect **in this package**: server identity does not ride a
`serverInfo` field on a `server/discover` result at all. The revision moved it into each result's
`_meta`, under `io.modelcontextprotocol/serverInfo`, and the speculative locations the first draft
guessed at reported a server publishing a full identity and two icons as publishing neither. Both
false advisories are gone; the reader now checks the two locations that exist — that key on
`2026-07-28`, and the top-level `serverInfo` an `initialize` result carries on `2025-11-25` — and
guesses at no third.

### Consumers

**A green run can turn red here, and that is the intended behaviour of this package** — every new
assertion above is a requirement that existed before this release and was simply not being checked.
Read the citation on the failure before changing anything.

The likely first finding is `server/discover`. If your server has not adopted the revision, expect
that failure plus the caching-hint ones, and treat them as one migration rather than four defects:
serve both revisions while the twelve-month deprecation window runs, add `ttlMs` and `cacheScope` to
every list result, implement `server/discover`, make anything a client may retry idempotent, and
move per-connection session state to an explicit server-minted handle passed as a tool argument.

**Nothing in the advisory report needs fixing to stay green.** It is there because the run already
knew, and staying silent about it would waste what it knew.


## v0.5.0 — ChatGPT connections survive access-token expiry

ChatGPT Desktop registers the `refresh_token` grant but, unlike the model the previous profile
used, does not reliably append the OpenID Connect-only `offline_access` scope. An OAuth server that
inherits an OIDC provider's default refresh policy therefore returns only an access token. The
connection looks healthy until that token expires — commonly one hour later — and then ChatGPT asks
the user to reconnect.

### Changed

- The ChatGPT profile now reflects the observed desktop connector request and does not synthesize
  `offline_access` from authorization-server metadata.
- The ChatGPT suite now completes an authorization without `offline_access`, requires a refresh
  token, and exchanges it for a replacement access token over the real wire. This may turn a green
  consumer red when its OAuth server incorrectly couples refresh issuance to an OIDC scope instead
  of the client's registered OAuth grant.

### Consumers

If the new assertion fails, keep the client's capability check: issue a refresh token only when the
client registered `refresh_token`. Remove only the dependency on `offline_access`; do not issue
refresh credentials to clients that did not register the grant.

## v0.4.0 — Two refusals the suites exercised but never actually pinned

Both come from auditing two consumers' own OAuth tests for anything generic enough to belong here.
Almost everything worth keeping was already covered — these two were not, and both are the kind of
defect that is invisible until a real client hits it.

### Added

- **A too-narrow credential must draw `403`, not `401`.** The insufficient-scope test previously
  *searched* for a `403` and asserted its shape; a server answering `401` was never examined, so it
  passed by producing nothing to look at. It now accepts either status and pins `403`. RFC 6750 §3.1
  reserves `401`/`invalid_token` for a credential that could not be *verified*: a client meeting
  `401` re-authenticates, so a server answering it here sends the client through a full
  authorization that mints the same too-narrow token — forever, with no error anyone can see.
- **A revoked credential must be indistinguishable from one that never existed.** Every other
  assertion exercises one refusal and checks its shape; this is the only one that compares two, and
  the property is invisible any other way. A distinguishable refusal is an oracle answering "did
  this token ever exist?" and "is that holder still authorized?" for anyone willing to ask. RFC 6750
  §3.1 gives the whole class one code so a server has nothing finer to leak.

### Consumers

Both may turn a green run red, which is the point — neither was ever asserted before. If the second
one fails, the fix is in the refusal path, not in the test: make every unverifiable credential
answer identically and log the real cause server-side.

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
