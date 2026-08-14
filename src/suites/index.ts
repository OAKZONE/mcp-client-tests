/**
 * The suite families this package offers, and the shape every future one follows.
 *
 * ## The registry
 *
 * A **family** is a group of suites that share a required capability and a subject. Today there is
 * one — OAuth conformance, which requires {@link AuthorizationCapability} and asks "can each vendor's
 * client connect to this server?". Families planned next ask different questions of the same running
 * deployment and need nothing new from the consumer:
 *
 * | Family | Requires | Asks |
 * |:---|:---|:---|
 * | `oauth` | `authorization` | Can each vendor's client authorize, refresh, and reconnect? |
 * | `tool-surface` *(next)* | — | Do the published tools satisfy the tool-design rules — names, described parameters, bounded results, actionable errors, no raw identifiers crossing out? |
 * | `protocol` *(next)* | — | Does the transport answer `initialize`, `tools/list`, and `tools/call` in the shapes the specification mandates, including both error channels? |
 *
 * Two of those three require **no capability at all**, which is the point of the design: a server
 * with no authorization — or one written in another language whose consumer cannot express a
 * session — still gets everything that does not need one. The consumer opts in by calling the
 * family's `define…` function; a family it does not call costs it nothing.
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
