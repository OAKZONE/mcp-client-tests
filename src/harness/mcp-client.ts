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

/** The protocol revision the modelled OAuth clients negotiate. */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

/**
 * The stateless revision: no handshake, no session, per-request `_meta`.
 *
 * Both revisions are live — `2026-07-28` deprecates rather than deletes, on a twelve-month floor —
 * so this package speaks whichever a suite's subject requires and never assumes a server is on one.
 */
export const MCP_STATELESS_REVISION = "2026-07-28";

/** A protocol revision this package can speak. */
export type McpRevision =
  | typeof MCP_PROTOCOL_VERSION
  | typeof MCP_STATELESS_REVISION;

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
  /**
   * The revision this request is made on. Defaults to `2025-11-25`, so nothing written before the
   * stateless revision changes shape.
   *
   * On `2026-07-28` the request additionally carries the `Mcp-Method` and `Mcp-Name` routing
   * headers a gateway needs in order to route without parsing the body.
   */
  readonly revision?: McpRevision;
}

/** The JSON-RPC method a request body names, when it names one. */
function bodyMethod(body: unknown): string | undefined {
  const record = body as { method?: unknown } | null;
  return typeof record?.method === "string" ? record.method : undefined;
}

/** The primitive a request body addresses, when it addresses one by name. */
function bodyPrimitiveName(body: unknown): string | undefined {
  const record = body as { params?: { name?: unknown } } | null;
  return typeof record?.params?.name === "string" ? record.params.name : undefined;
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
  const revision = options.revision ?? MCP_PROTOCOL_VERSION;
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": revision,
  };
  if (revision === MCP_STATELESS_REVISION) {
    // The revision moved the negotiated version into each request's `_meta` and added these two so
    // a gateway can route without parsing the body. Both are sent because a client that omits them
    // exercises a path no deployed gateway sees.
    const method = bodyMethod(body);
    if (method !== undefined) headers["mcp-method"] = method;
    const name = bodyPrimitiveName(body);
    if (name !== undefined) headers["mcp-name"] = name;
  }
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

/**
 * A message on the stateless revision, carrying the `_meta` that replaced the handshake.
 *
 * There is no `initialize` to negotiate with any more: every request states its own protocol
 * version and client capabilities, which is exactly what makes a list result unable to depend on a
 * connection. Building the envelope here rather than per call site means a suite cannot accidentally
 * assert against a half-migrated request.
 *
 * @param method - The JSON-RPC method, e.g. `server/discover` or `tools/list`.
 * @param params - Method parameters; `_meta` is added to them.
 * @param id - The JSON-RPC id.
 * @returns The message.
 */
export function statelessMessage(
  method: string,
  params: Record<string, unknown> = {},
  id: string | number = 1,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_STATELESS_REVISION,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

/** The `server/discover` message, which every server on the stateless revision must answer. */
export function discoverMessage(id: string | number = 1): unknown {
  return statelessMessage("server/discover", {}, id);
}

/**
 * The result of the first JSON-RPC message in an exchange.
 *
 * @param exchange - What came back.
 * @returns The result object, or undefined when the exchange carried an error or no message.
 */
export function firstResult(
  exchange: McpExchange,
): Record<string, unknown> | undefined {
  return exchange.messages[0]?.result;
}

/**
 * The JSON-RPC error of the first message in an exchange.
 *
 * Read separately from the result because the two are different channels with different meanings:
 * an error here is a protocol error, which a model cannot fix, while a failure carried in a result
 * is an execution error, which it often can.
 *
 * @param exchange - What came back.
 * @returns The error object, or undefined when there was none.
 */
export function firstError(
  exchange: McpExchange,
): { readonly code: number; readonly message: string } | undefined {
  return exchange.messages[0]?.error;
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
