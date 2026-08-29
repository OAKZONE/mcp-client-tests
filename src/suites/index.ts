/**
 * The suite families this package offers, and the shape every future one follows.
 *
 * ## The registry
 *
 * A **family** is a group of suites that share a required capability and a subject.
 *
 * | Family | Requires | Asks |
 * |:---|:---|:---|
 * | `oauth` | `authorization` | Can each vendor's client authorize, refresh, and reconnect? |
 * | `protocol` | — | Does the server answer revision `2026-07-28` in the shapes it mandates — `server/discover`, no session, caching hints, legal tool names, both error channels? |
 * | `tool-surface` *(next)* | — | Do the published tools satisfy the tool-design rules — described parameters, bounded results, actionable errors, no raw identifiers crossing out? |
 *
 * Two of those three require **no capability at all**, which is the point of the design: a server
 * with no authorization — or one written in another language whose consumer cannot express a
 * session — still gets everything that does not need one. The consumer opts in by calling the
 * family's `define…` function; a family it does not call costs it nothing.
 *
 * The `protocol` family shows the shape of "requires nothing" precisely: it needs a *credential*
 * only when the server refuses to list unauthenticated, and it takes that from the authorization
 * capability if the target has one. A gate it cannot get through stops the run with both ways out
 * named, because a family that quietly asserted nothing is worse than one that failed.
 *
 * ## Adding a family
 *
 * 1. If it needs something from the consumer that no existing family does, add a **capability** to
 *    `target.ts` — a fact about the server, never a flag about the tests.
 * 2. Add `suites/<family>/` with one `define…Suites(target)` entry point that `describe.skipIf`s on
 *    the capability it requires.
 * 3. If it needs new infrastructure at run start, gate it in `provision.ts` on that capability.
 * 4. Re-export it here.
 *
 * Nothing in an existing family changes. That is the test of whether the seam is right.
 */

export {
  defineOAuthConformanceSuites,
  defineClaudeDesktopSuite,
  defineClaudeCodeSuite,
  defineChatgptDesktopSuite,
} from "./oauth/index.js";

export {
  defineProtocolConformanceSuites,
  defineWireConformanceSuite,
} from "./protocol/index.js";
