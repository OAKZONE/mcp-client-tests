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
 * Two suites, seeing different halves:
 *
 * - **`declarative`** — reads served HTML. Needs nothing beyond the deployment.
 * - **`imperative`** — loads each page in a real Chrome and asks it `getTools()`. Needs
 *   `playwright-core` (an optional peer dependency shipping no binaries) and a Chrome on the
 *   machine. It is the only one that sees whether `registerTool` actually landed.
 *
 * **`defineWebMcpConformanceSuites` registers only the declarative one**, and that is deliberate.
 * This package's standing promise is that adopting a new version can turn a green run red only
 * through a real requirement — never through advice, and never through infrastructure. Registering
 * a browser-driven suite by default would break every existing consumer's run with a missing-Chrome
 * error, which is neither a finding about their server nor something they asked for. So the browser
 * suite is named explicitly by a consumer who wants it, and hard-fails only for them.
 */

import type { McpTestTarget } from "../../target.js";

import { defineWebMcpDeclarativeSuite } from "./declarative.js";
import { defineWebMcpImperativeSuite } from "./imperative.js";

export { defineWebMcpDeclarativeSuite, defineWebMcpImperativeSuite };

/**
 * Register the WebMCP suites that need nothing beyond the running deployment.
 *
 * Add {@link defineWebMcpImperativeSuite} alongside this to also drive a real browser — see this
 * module's header for why that one is not registered here.
 *
 * @param target - The deployment under test.
 */
export function defineWebMcpConformanceSuites(target: McpTestTarget): void {
  defineWebMcpDeclarativeSuite(target);
}
