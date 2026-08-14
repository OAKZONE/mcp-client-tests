/**
 * An MCP client speaking Streamable HTTP over the real wire.
 *
 * The transport is written out rather than taken from an SDK for one reason: the properties under
 * test live in the HTTP envelope, not in the JSON-RPC payload. An unauthenticated call must fail the
 * **HTTP request** with `401` and a `WWW-Authenticate` header — a `200` carrying `isError: true`
 * produces no sign-in affordance in any client, which is the single most commonly reported MCP
 * authorization defect. An SDK client abstracts exactly that envelope away, and several throw before
 * a test can read it.
 *
 * Streamable HTTP permits a JSON body or an SSE stream in response to the same POST, chosen by the
 * server, so both are decoded here and reduced to the JSON-RPC messages they carry.
 */

import { edgeRequest, type EdgeTarget, type WireResponse } from "./edge-transport.js";

/** The protocol revision the modelled clients negotiate. */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface McpExchange {
  /** The raw HTTP response — status, headers, and `WWW-Authenticate` all matter. */
  readonly http: WireResponse;
  /** JSON-RPC messages decoded from a JSON body or an SSE stream; empty when neither. */
  readonly messages: readonly JsonRpcResponse[];
}

export interface McpRequestOptions {
  /** Bearer credential, sent in the `Authorization` header. */
  readonly accessToken?: string;
  /** Sent as `?access_token=`, to check that a credential in the query string is refused. */
  readonly queryAccessToken?: string;
  /** An `Origin` header, for the browser-context checks. */
  readonly origin?: string;
  /** Override `Content-Type`, so a wrong media type can be modelled deliberately. */
  readonly contentType?: string;
  readonly method?: string;
}

/**
 * Decode whatever the server chose to answer with.
 *
 * A Streamable HTTP response is either a JSON body or an `text/event-stream` whose `data:` lines
 * each carry one JSON-RPC message. Anything else decodes to no messages, which a test asserting on
 * the envelope can still use.
 */
function decodeMessages(response: WireResponse): readonly JsonRpcResponse[] {
  const contentType = response.headers.get("content-type") ?? "";
  const text = response.text();
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
  if (contentType.includes("text/event-stream")) {
    const messages: JsonRpcResponse[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        messages.push(JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
      } catch {
        // A non-JSON data frame is not a JSON-RPC message; the envelope assertions still apply.
      }
    }
    return messages;
  }
  return [];
}

/**
 * Send one JSON-RPC message to the MCP endpoint.
 *
 * @param target - The deployment.
 * @param mcpServerUrl - The MCP endpoint URL, exactly as a user would type it.
 * @param body - The JSON-RPC message (or batch).
 * @param options - Credentials and envelope overrides.
 * @returns The HTTP response and any decoded JSON-RPC messages.
 */
export async function mcpRequest(
  target: EdgeTarget,
  mcpServerUrl: string,
  body: unknown,
  options: McpRequestOptions = {},
): Promise<McpExchange> {
  const url = new URL(mcpServerUrl);
  if (options.queryAccessToken !== undefined) {
    url.searchParams.set("access_token", options.queryAccessToken);
  }
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  };
  if (options.accessToken !== undefined) {
    headers.authorization = `Bearer ${options.accessToken}`;
  }
  if (options.origin !== undefined) headers.origin = options.origin;

  const http = await edgeRequest(target, url, {
    method: options.method ?? "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { http, messages: decodeMessages(http) };
}

/** The `initialize` message a client opens a session with. */
export function initializeMessage(id: string | number = 1): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-conformance-harness", version: "1.0.0" },
    },
  };
}

/** The `tools/list` message. */
export function listToolsMessage(id: string | number = 2): unknown {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

/** A `tools/call` message. */
export function callToolMessage(
  name: string,
  argumentsValue: Record<string, unknown> = {},
  id: string | number = 3,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: argumentsValue },
  };
}

/** One parsed `WWW-Authenticate` challenge. */
export interface BearerChallenge {
  readonly scheme: string;
  readonly parameters: ReadonlyMap<string, string>;
}

/**
 * Parse a `WWW-Authenticate` header into its scheme and auth-param list.
 *
 * The challenge is the entire mechanism that starts an authorization flow, and every field a client
 * consumes — `error`, `scope`, `resource_metadata` — is an auth-param on it, so the suite parses
 * rather than string-matches. Values may be quoted or bare per the grammar in RFC 9110 §11.2.
 *
 * @param header - The raw header value, or null when absent.
 * @returns The parsed challenge, or undefined when the header is absent or has no scheme.
 */
export function parseBearerChallenge(
  header: string | null,
): BearerChallenge | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  const spaceAt = trimmed.indexOf(" ");
  const scheme = spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt);
  if (!scheme) return undefined;
  const parameters = new Map<string, string>();
  if (spaceAt !== -1) {
    const rest = trimmed.slice(spaceAt + 1);
    const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g;
    let match = pattern.exec(rest);
    while (match !== null) {
      parameters.set(
        match[1].toLowerCase(),
        (match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1"),
      );
      match = pattern.exec(rest);
    }
  }
  return { scheme, parameters };
}
