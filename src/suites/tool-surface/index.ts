/**
 * The tool-surface conformance family — whether a client's gate will let the published tools run.
 *
 * **Requires no capability.** A server with no authorization at all gets every assertion; one that
 * gates its MCP endpoint gets them through a credential obtained from the target's authorization
 * capability, exactly as the protocol family does.
 *
 * One suite today. Two more belong here when there is a contract worth asserting against, and each
 * will add a file rather than edit one: **result gating** — whether what a tool *returns* stays
 * inside the size thresholds clients truncate at, and whether it is free of the instruction-shaped
 * text that puts an agent into refusal instead of into the workflow — and **the `_meta` steering
 * keys**, once more than one vendor publishes one.
 *
 * **Why this is a family rather than assertions inside `protocol`.** The protocol family judges the
 * surface against the specification: what a server publishes, and in what shape. This one judges it
 * against **somebody else's software** — what a client does with a list that is already perfectly
 * conformant. A tool can satisfy every clause of the tools contract and still never run. Mixing the
 * two would put a vendor's review criteria and an RFC-level MUST behind the same failure message,
 * and a reader could no longer tell which of the two they had broken.
 */

import type { McpTestTarget } from "../../target.js";

import { defineToolGatingSuite } from "./gating.js";

export { defineToolGatingSuite };

/**
 * Register every tool-surface conformance suite this package ships against one target.
 *
 * @param target - The MCP server under test.
 */
export function defineToolSurfaceConformanceSuites(target: McpTestTarget): void {
  defineToolGatingSuite(target);
}
