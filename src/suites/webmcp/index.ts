/**
 * The WebMCP family — what a page publishes to an agent attached to the user's browser.
 *
 * **Requires the `webMcp` capability**, which names the pages that publish tools. That is a fact
 * about the deployment in the same way the authorization capability is: a server either serves such
 * pages or it does not. A target that declares none gets the family skipped, and pays nothing.
 *
 * **This family asserts against WebMCP, never against MCP.** The two share a vocabulary and no
 * wire. Nothing here cites an MCP clause, and nothing in the protocol or OAuth families says
 * anything about a tool registered in a page — which is exactly why this is a separate family
 * rather than a branch inside an existing one.
 *
 * Four suites, seeing different halves:
 *
 * - **`declarative`** — reads served HTML: forms carrying `toolname` and the script text that says
 *   which entry point a page reaches for. Needs nothing beyond the deployment.
 * - **`reachability`** — asks whether the API can exist for a visitor at all. In a stock browser
 *   `document.modelContext` exists only where the response carried an origin-trial token, so this
 *   one checks the token is served, still valid for this origin, and served to everyone rather than
 *   to whoever a rule happens to match. A token arrives on the response like any other header, so
 *   this needs no browser either.
 * - **`imperative`** — loads each page in a real Chrome and asks it `getTools()`. Needs
 *   `playwright-core` (an optional peer dependency shipping no binaries) and a Chrome on the
 *   machine. It is the only one that sees whether `registerTool` actually landed, and the only one
 *   that walks pages in a single tab to see whether a document released its tools on the way out.
 * - **`execution`** — calls the tools a target declares as safe to call. The only way to reach the
 *   shapes a caller touches on every call — how `inputSchema` is encoded, what `executeTool`
 *   accepts — and the only way to check that a value a result reports for a parameter is a value
 *   that parameter accepts. Same browser requirement.
 *
 * **`defineWebMcpConformanceSuites` registers the two that need no browser**, and that is
 * deliberate. This package's standing promise is that adopting a new version can turn a green run
 * red only through a real requirement — never through advice, and never through infrastructure.
 * Registering a browser-driven suite by default would break every existing consumer's run with a
 * missing-Chrome error, which is neither a finding about their server nor something they asked for.
 * So the browser suites are named explicitly by a consumer who wants them, and hard-fail only for
 * them.
 */

import type { McpTestTarget } from "../../target.js";

import { defineWebMcpDeclarativeSuite } from "./declarative.js";
import { defineWebMcpExecutionSuite } from "./execution.js";
import { defineWebMcpImperativeSuite } from "./imperative.js";
import { defineWebMcpReachabilitySuite } from "./reachability.js";

export {
  defineWebMcpDeclarativeSuite,
  defineWebMcpExecutionSuite,
  defineWebMcpImperativeSuite,
  defineWebMcpReachabilitySuite,
};

/**
 * Register the WebMCP suites that need nothing beyond the running deployment.
 *
 * Add {@link defineWebMcpImperativeSuite} and {@link defineWebMcpExecutionSuite} alongside this to
 * also drive a real browser — see this module's header for why those two are not registered here.
 *
 * @param target - The deployment under test.
 */
export function defineWebMcpConformanceSuites(target: McpTestTarget): void {
  defineWebMcpDeclarativeSuite(target);
  defineWebMcpReachabilitySuite(target);
}
