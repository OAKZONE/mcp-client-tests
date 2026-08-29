/**
 * The protocol conformance family — what the server publishes, against revision `2026-07-28`.
 *
 * **Requires no capability.** A server with no authorization at all gets every assertion; one that
 * gates its MCP endpoint gets them through a credential obtained from the target's authorization
 * capability. That is the whole point of the capability design: a family asks for what it needs,
 * and a server that cannot offer it is not silently skipped — it is told why, in the terms of the
 * two ways out.
 *
 * One suite today. A second — `subscriptions/listen`, and whether a `list_changed` notification
 * actually reaches a subscriber — belongs here when there is a client contract worth asserting
 * against; it will add a file rather than edit this one.
 */

import type { McpTestTarget } from "../../target.js";

import { defineWireConformanceSuite } from "./wire.js";

export { defineWireConformanceSuite };

/**
 * Register every protocol conformance suite this package ships against one target.
 *
 * @param target - The MCP server under test.
 */
export function defineProtocolConformanceSuites(target: McpTestTarget): void {
  defineWireConformanceSuite(target);
}
