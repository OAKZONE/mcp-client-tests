# Extending the package

Two axes of growth, deliberately separated: **more client surfaces** (another vendor to be reachable
from) and **more test families** (another question to ask of the same running server).

## Adding a client surface

A surface is a *client build*, not a vendor. Every vendor whose contract has been examined warns
against generalising one surface to another, and the warning is load-bearing: Claude Code differs
from Claude's hosted surfaces on redirect URI, scope selection, and step-up, and folding them
together hid a defect that made the CLI unable to sign in at all while every browser client worked.

1. **Read the vendor's primary sources.** The OAKZONE agent toolkit distils them per client with
   per-fact strength grades (`docs/vendors/`); use it to find the primary source, then read that.
2. **Add `src/profiles/<surface>.ts`** transcribing the client: registration path, redirect URI,
   metadata document, scope ladder, discovery probe order. Every field cites its source. Stamp
   `verifiedAgainst` with the build or documentation revision you read.
3. **Add `src/suites/oauth/<surface>.ts`** asserting only what is **different** about that surface.
   The protocol spine is exercised in full by `claude-desktop`; repeating it doubles the runtime and
   halves the signal.
4. **Export both** from `src/profiles/index.ts` and `src/suites/oauth/index.ts`.

### Only assert what the vendor establishes

Where a vendor records a behaviour as unverified — ChatGPT's scope-merge algorithm, its step-up retry
bound, whether each surface requests `offline_access` — pin the *server's* behaviour and name the
uncertainty in the test's docstring. Promoting an unverified row into a requirement produces a suite
that fails correct servers, which gets the whole gate switched off.

## Adding a test family

A **family** is a group of suites sharing a required capability and a subject.

### The design rule

**A capability describes the SERVER, never the test.** `authorization` is a fact about a deployment;
`runOAuthTests` would be a flag, and a flag is how a suite ends up silently skipped in the one
repository that most needed it. If you cannot phrase what you need as a fact about the server, the
family probably needs no new capability at all.

### The steps

1. **Only if it needs something new from the consumer**, add a capability to `src/target.ts`.
   Most families need nothing: the deployment is already running and already reachable.
2. **Add `src/suites/<family>/`** with one `define…Suites(target)` entry point whose suites
   `describe.skipIf` on the capability they require.
3. **Only if it needs new infrastructure at run start**, gate it in `src/provision.ts` on that
   capability — the way the document host is gated on `authorization` today.
4. **Re-export it** from `src/suites/index.ts` and add a row to the family table there and in the
   README.

**Nothing in an existing family changes.** That is the test of whether the seam is right. If adding a
family means editing an existing suite, the abstraction is wrong — stop and fix it there instead.

### Families this package is shaped for

| Family | Requires | Subject | Notes |
|:---|:---|:---|:---|
| `oauth` | `authorization` | Can each vendor's client authorize, refresh, reconnect? | Shipped |
| `protocol` | — | Revision `2026-07-28`: `server/discover`, no session, caching hints, tool names and schemas, list stability, both error channels | Shipped |
| `tool-surface` | — | Will a client's gate let the published tools run — annotations, `title`, the 64-character name budget, read split from write, schema names a client validates, descriptions a scanner reads as an attack | Shipped |
| `webmcp` | `webMcp` | Do pages publishing tools to an in-browser agent declare them the way the W3C draft states? | Shipped |
| *result gating* | — | Does what a tool **returns** stay inside the size thresholds clients truncate at, and is it free of the instruction-shaped text that puts an agent into refusal? | Not shipped: it needs a `tools/call` against a real tool, whose side effects the package must be invited to take |

Note that **three of the four need no capability**. That is the point of the design: a server with no
OAuth — or one whose consumer cannot express a session, say a Go service with no Node-side session
helper — still gets everything that does not need one. Such a consumer supplies a target with no
`authorization` block and calls the families it qualifies for.

The `protocol` family shows the useful middle case: it needs no capability, but it does need a
*credential* when the server refuses to list unauthenticated, and it takes one from `authorization`
when the target has it. Where it cannot get through the gate it stops the run and names both ways
out — never a silent skip.

## Failure or advisory?

The package has two outcomes, and choosing between them is the judgement that keeps the gate
credible.

### The grade decides it, and the code enforces the decision

Every clause in `src/harness/specifications.ts` carries an **evidence grade**, using the same
vocabulary the distilled vendor documentation does, so you can move between the two without
re-learning one:

| Grade | What it means | What you may do with it |
|:---|:---|:---|
| `strong` | A primary source read directly, or behaviour reproduced against a live deployment. | **Assert.** `cite()` accepts it. |
| `moderate` | Vendor prose with no testable assertion, or a single field report. | Advise, via `reports()`. |
| `thin` | An uncorroborated community report. | Advise, and say the number is not a fact. |
| `unverified` | A gap recorded rather than filled by guess. | Advise, or say nothing. |

A clause built with the plain `clause()` constructor is `strong` — `verified` already means somebody
read the primary source on that date. Grading one **down** is a deliberate act at the call site: use
`graded()`, and give it a `caveat` saying what corroboration is missing and what a reader must
therefore not conclude.

**`cite()` throws on anything below `strong`.** That is not a style rule you can argue with in
review — a suite physically cannot assert on a community report, and the error names `advise()` as
the way out. The reason is worth internalising before you reach for a workaround: the most
quotable facts about client behaviour are the least established ones (a ~256-tool ceiling, a
~40-tool ceiling, a profile key that hard-blocks), and every one of them would eventually fail a
correct server. A conformance gate that fails correct servers gets switched off, taking every true
finding with it.

**Fail** when a specification requires it, or a vendor states it outright. A red test is then a
defect report, and the citation says so.

**Advise** — `harness/advisory.ts` — when the specification *offers* it and a shipping client would
use it: server `instructions`, `icons[]`, a tool description, an `outputSchema`. An advisory names
the subject, what is absent, **what it costs in a named client**, and the clause that offers it. It
prints after the suite and never fails the run, which is a promise to consumers: a version bump can
turn their run red only through a real requirement.

Advise **also** when a fact is real but its wire placement is not established in the sources —
`resultType` on a list result is the shipped example. Pinning an uncertain placement as a
requirement fails correct servers, and a suite that fails correct servers gets switched off
entirely, taking every true finding with it.

Advice with no consequence is a preference: if you cannot name the client and what its user sees,
do not write the advisory.

### The three relations

An advisory renders under the relation its clause earns, and the renderer picks it rather than the
caller — a graded-down clause **always** reads as *reported by*, whatever a call site asks for, so
the unsafe direction is unrepresentable.

- **`required by:`** (`cite`) — the source states it, and this fails the run.
- **`offered by:`** (`offers`) — the source offers it and a shipping client would use it.
- **`reported by:`** (`reports`) — it was reported, reproduced, or contested rather than stated. The
  grade and its caveat print with it.

One case needs the caller's help: a **well-established fact that nothing offers**. A client
rewriting a root-level schema combinator is documented and certain, but no source *offers* it and no
server can prevent it, so *offered by* would read as nonsense. Pass `relation: "reports"` on the
advisory. Only that value is honoured, because downgrading a claim is always honest and upgrading
one is the failure this package exists to prevent.

### Adding a per-client gate fact

Behaviour a client applies to a list it already has — a cap, an approval posture, a classifier, an
administrator switch — goes in `src/profiles/client-gates.ts`, one row per client **surface**, each
field carrying the clause it came from. Findings render from those rows rather than quoting them
inline, so a re-verification that moves one client's behaviour moves every message that mentions it,
and there is one place to edit — the place holding the citation.

## Re-verifying vendor facts

Client behaviour moves. One vendor changed its scope selection in a point release and its redirect
form in another.

- Every profile carries `verifiedAgainst`. When you re-read a vendor's documentation, update it —
  **even if nothing changed**, because "checked, unchanged" is information.
- Every clause in `src/harness/specifications.ts` carries a `verified` date that travels into failure
  messages, so a consumer reading a red test can see how old the claim is.
- Record what moved in `CHANGELOG.md`. A consumer bumping a pin needs to know which of their green
  assertions just changed meaning.

## Working in this repository

`AGENTS.md` carries the operating rules, the QA gates, and the release process.
