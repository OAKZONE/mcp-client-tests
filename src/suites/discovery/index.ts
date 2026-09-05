/**
 * The discovery family — the authorization surface a client reads before it has a token.
 *
 * **Requires no capability, and it is the only family a remote deployment can run.** Everything it
 * asserts is a public document or a `401`, so it works identically against a server this package
 * started and against one already serving somewhere else. Pointing it at staging or production is a
 * supported thing to do.
 *
 * It is a separate family rather than part of `oauth` because of what it does *not* need: no
 * account holder, no consent screen, no callback. Folding these assertions into the OAuth suites
 * would make them unreachable for exactly the deployments that most benefit from them.
 */

import type { McpTestTarget } from "../../target.js";

import { defineAuthorizationSurfaceSuite } from "./authorization-surface.js";

export { defineAuthorizationSurfaceSuite };

/**
 * Register every discovery conformance suite this package ships against one target.
 *
 * @param target - The MCP server under test, spawned or remote.
 */
export function defineDiscoveryConformanceSuites(target: McpTestTarget): void {
  defineAuthorizationSurfaceSuite(target);
}
