/**
 * Reading a server's published tool list, on whichever revision it answers.
 *
 * **Why this is harness code rather than one suite's helper.** Two families need the same list for
 * different reasons — the protocol family judges what the list *is* (names, schemas, ordering,
 * caching hints), the tool-surface family judges what a client's gate will *do* with it — and the
 * negotiation between the two live revisions is fiddly enough that two copies would drift within a
 * release. It has no family-specific knowledge, so it belongs to neither of them.
 *
 * **Both revisions are tried, in that order, deliberately.** The stateless shape comes first
 * because it is the current one. A server still on `2025-11-25` is not refused: its list is fetched
 * through the handshake instead, so that every revision-independent judgement still runs against a
 * real surface and reports real findings, rather than collapsing into one uninformative failure
 * about a revision the suite was not asking about.
 *
 * What was tried is returned alongside the list, because the interesting failure here is the empty
 * one — and "no tools came back" is useless to a reader without the two attempts that produced it.
 */

import {
  MCP_STATELESS_REVISION,
  firstError,
  firstResult,
  initializeMessage,
  listToolsMessage,
  mcpRequest,
  statelessMessage,
} from "./mcp-client.js";
import type { EdgeTarget } from "./edge-transport.js";

/** A tool as published, read tolerantly: every field is whatever the server put there. */
export interface PublishedTool {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly annotations?: unknown;
  readonly icons?: unknown;
  readonly _meta?: unknown;
}

/** A tool list as read, and what it took to read it. */
export interface ToolListing {
  /** The tools, in the order the server returned them. Empty when nothing could be read. */
  readonly tools: readonly PublishedTool[];
  /**
   * The `tools/list` result itself, which carries the caching hints the list rode in on.
   *
   * Undefined when no list came back — which is how a caller distinguishes "this server publishes
   * no tools" from "this run could not reach the list", two findings that must never be confused.
   */
  readonly result?: Record<string, unknown>;
  /**
   * What was tried, in one line, for quoting in a failure message.
   *
   * **Prose for a human, never a value to branch on.** A server that answered only on the older
   * revision succeeded, and its line still opens with the *stateless* attempt's failure — so any
   * check of the form "does this start with `listed`" reports a correctly-read legacy surface as
   * unreadable. {@link ToolListing.result} is the discriminator; this is the explanation beside it.
   */
  readonly attempt: string;
}

/** Where to read from, and with what credential. */
export interface ToolListingRequest {
  readonly target: EdgeTarget;
  /** The MCP endpoint URL, exactly as a user would type it. */
  readonly serverUrl: string;
  /** The credential every request should carry, or undefined when the surface is public. */
  readonly accessToken?: string;
}

/**
 * Read the tool list, trying the stateless revision first and the handshake second.
 *
 * @param request - Where to read from, and with what credential.
 * @returns The tools, the result envelope that carried them, and what was tried. Never throws: an
 *   unreachable or refusing server produces an empty list with `attempt` explaining both tries, so
 *   the caller decides whether that is a finding or a skip.
 */
export async function readPublishedTools(
  request: ToolListingRequest,
): Promise<ToolListing> {
  const { target, serverUrl, accessToken } = request;

  const stateless = await mcpRequest(
    target,
    serverUrl,
    statelessMessage("tools/list"),
    { revision: MCP_STATELESS_REVISION, accessToken },
  );
  const statelessResult = firstResult(stateless);
  if (Array.isArray(statelessResult?.tools)) {
    return {
      tools: statelessResult.tools as PublishedTool[],
      result: statelessResult,
      attempt: "listed on 2026-07-28",
    };
  }
  const statelessNote =
    `2026-07-28 \`tools/list\` answered http ${stateless.http.status}` +
    (firstError(stateless) ? ` / ${firstError(stateless)!.message}` : "");

  await mcpRequest(target, serverUrl, initializeMessage(), { accessToken });
  const legacy = await mcpRequest(target, serverUrl, listToolsMessage(), {
    accessToken,
  });
  const legacyResult = firstResult(legacy);
  if (Array.isArray(legacyResult?.tools)) {
    return {
      tools: legacyResult.tools as PublishedTool[],
      result: legacyResult,
      attempt: `${statelessNote}; listed on 2025-11-25 after \`initialize\` instead`,
    };
  }

  return {
    tools: [],
    attempt:
      `${statelessNote}; 2025-11-25 \`initialize\` + \`tools/list\` answered ` +
      `http ${legacy.http.status}` +
      (firstError(legacy) ? ` / ${firstError(legacy)!.message}` : ""),
  };
}

/**
 * The names a tool list published, rendered as strings for reporting.
 *
 * A non-string name is not corrected here — it is stringified so the finding can quote what was
 * actually published. `toolNameProblem` in `mcp-surface.ts` is what judges it.
 *
 * @param tools - The tools as published.
 * @returns One name per tool, in list order.
 */
export function publishedToolNames(
  tools: readonly PublishedTool[],
): readonly string[] {
  return tools.map((tool) =>
    typeof tool.name === "string" ? tool.name : String(tool.name),
  );
}

/**
 * Name a few of many, so a finding stays readable when a server publishes fifty tools.
 *
 * @param names - The names to render.
 * @param limit - How many to show before summarising the rest.
 * @returns The rendered list.
 */
export function nameSome(names: readonly string[], limit = 4): string {
  const shown = names
    .slice(0, limit)
    .map((name) => `\`${name}\``)
    .join(", ");
  const rest = names.length - limit;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}
