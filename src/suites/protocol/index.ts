/**
 * The protocol conformance family — what the server publishes, against revision `2026-07-28`.
 *
 * **Requires no capability.** A server with no authorization at all gets every assertion; one that
 * gates its MCP endpoint gets them through a credential obtained from the target's authorization
 * capability. That is the whole point of the capability design: a family asks for what it needs,
 * and a server that cannot offer it is not silently skipped — it is told why, in the terms of the
 * two ways out.
 *
 * The wire suite covers core requirements; the Skills suite checks the optional extension only
 * after the server advertises it. Extension absence never requires a consumer configuration flag.
 */

import type { McpTestTarget } from "../../target.js";

import { defineWireConformanceSuite } from "./wire.js";
import { defineSkillsConformanceSuite } from "./skills.js";

export { defineWireConformanceSuite, defineSkillsConformanceSuite };

/**
 * Register every protocol conformance suite this package ships against one target.
 *
 * @param target - The MCP server under test.
 */
export function defineProtocolConformanceSuites(target: McpTestTarget): void {
  defineWireConformanceSuite(target);
  defineSkillsConformanceSuite(target);
}
