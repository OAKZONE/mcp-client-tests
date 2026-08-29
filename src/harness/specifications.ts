/**
 * The normative sources this conformance suite is written against, and nothing else.
 *
 * **Read this before adding an assertion.** Every expectation in
 * `src/__tests__/integration/mcp-compliance/` must trace to a clause below. The suite exists to
 * check this deployment against what the specifications and the vendors publish — never against
 * what this repository happens to do. An assertion with no citation is an assertion about our own
 * implementation, which proves nothing (`docs/decisions/DEC-ARC-052-…`: a test written from our own
 * assumptions cannot catch a wrong assumption).
 *
 * The citation travels into the failure message via {@link cite}, so a red test in six months tells
 * the next reader *which clause* is unmet and where to read it — including for a real-world incident
 * where the question is "is the vendor wrong or are we?".
 *
 * **Vendor rows are dated.** Client behaviour changes by version: Claude Code changed scope handling
 * in v2.1.196 and its redirect form in v2.1.229→231. When a vendor row is re-verified, update its
 * `verified` date in the same commit as any assertion that moves with it.
 */

/** One normative clause: what it says, and where to read it. */
export interface SpecificationClause {
  /** Human-readable source and clause, e.g. `RFC 6750 §3.1`. */
  readonly clause: string;
  /** Direct link to the clause. */
  readonly url: string;
  /** ISO date this clause was last read against the live source. */
  readonly verified: string;
}

function clause(
  clauseText: string,
  url: string,
  verified: string,
): SpecificationClause {
  return Object.freeze({ clause: clauseText, url, verified });
}

const RFC = "https://www.rfc-editor.org/rfc";
const MCP_AUTHZ =
  "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization";
const MCP_STATELESS = "https://modelcontextprotocol.io/specification/2026-07-28";

/** When the 2025-11-25-era sources below were last read against the live document. */
const READ = "2026-08-14";

/**
 * When the `2026-07-28` revision's sources were last read.
 *
 * A separate stamp because these clauses arrived with the revision that shipped on 2026-07-28 and
 * were read later than the rest; a single date would have back-dated them or aged the others.
 */
const READ_STATELESS = "2026-08-29";

/**
 * IETF clauses. These bind every OAuth client, so an assertion citing one of these belongs in the
 * shared spine rather than a vendor profile.
 */
export const IETF = Object.freeze({
  /** `scope` is OPTIONAL; an omitting request is processed with a default or failed. */
  OAUTH2_SCOPE_OPTIONAL: clause(
    "RFC 6749 §3.3 (Access Token Scope) with §4.1.1 (Authorization Request)",
    `${RFC}/rfc6749#section-3.3`,
    READ,
  ),
  /** `state` is RECOMMENDED, not required, on the authorization request. */
  OAUTH2_STATE_RECOMMENDED: clause(
    "RFC 6749 §4.1.1 (Authorization Request) — `state` is RECOMMENDED",
    `${RFC}/rfc6749#section-4.1.1`,
    READ,
  ),
  /** The token endpoint takes `application/x-www-form-urlencoded`. */
  OAUTH2_TOKEN_FORM_ENCODED: clause(
    "RFC 6749 §4.1.3 (Access Token Request)",
    `${RFC}/rfc6749#section-4.1.3`,
    READ,
  ),
  /** `expires_in` is RECOMMENDED; `scope` is REQUIRED when it differs from the request. */
  OAUTH2_TOKEN_RESPONSE: clause(
    "RFC 6749 §5.1 (Successful Response)",
    `${RFC}/rfc6749#section-5.1`,
    READ,
  ),
  /** Token-endpoint errors are HTTP 400 with an RFC-defined `error` code (401 for `invalid_client`). */
  OAUTH2_TOKEN_ERROR: clause(
    "RFC 6749 §5.2 (Error Response)",
    `${RFC}/rfc6749#section-5.2`,
    READ,
  ),
  /** A revoked, expired, or already-used grant is `invalid_grant`. */
  OAUTH2_INVALID_GRANT: clause(
    "RFC 6749 §5.2 (Error Response) — `invalid_grant`",
    `${RFC}/rfc6749#section-5.2`,
    READ,
  ),
  /** An authorization code MUST be single-use; reuse SHOULD revoke the tokens issued from it. */
  OAUTH2_CODE_SINGLE_USE: clause(
    "RFC 6749 §4.1.2 (Authorization Response) and §10.5 (Authorization Codes)",
    `${RFC}/rfc6749#section-4.1.2`,
    READ,
  ),
  /** The Bearer challenge: `WWW-Authenticate` on a 401, with `error` and `scope` attributes. */
  BEARER_CHALLENGE: clause(
    "RFC 6750 §3 (The WWW-Authenticate Response Header Field)",
    `${RFC}/rfc6750#section-3`,
    READ,
  ),
  /** `invalid_token` ⇒ 401; `insufficient_scope` ⇒ 403 naming the required `scope`. */
  BEARER_ERROR_CODES: clause(
    "RFC 6750 §3.1 (Error Codes)",
    `${RFC}/rfc6750#section-3.1`,
    READ,
  ),
  /** Access tokens MUST NOT be sent in the URI query string. */
  BEARER_NO_QUERY_TOKEN: clause(
    "RFC 6750 §2.3 (URI Query Parameter) and §5.3, and MCP authorization",
    `${RFC}/rfc6750#section-2.3`,
    READ,
  ),
  /** Dynamic client registration takes `application/json`. */
  DCR_JSON_REQUEST: clause(
    "RFC 7591 §3.1 (Client Registration Request)",
    `${RFC}/rfc7591#section-3.1`,
    READ,
  ),
  /** Registration answers 201 with the issued `client_id`; the server MAY replace metadata values. */
  DCR_RESPONSE: clause(
    "RFC 7591 §3.2.1 (Client Information Response)",
    `${RFC}/rfc7591#section-3.2.1`,
    READ,
  ),
  /** PKCE: `S256` challenge, and a mismatched verifier is refused. */
  PKCE: clause(
    "RFC 7636 §4.2–§4.6 (Proof Key for Code Exchange)",
    `${RFC}/rfc7636#section-4.2`,
    READ,
  ),
  /** Loopback redirect URIs match with the port ignored. */
  NATIVE_LOOPBACK_PORT_AGNOSTIC: clause(
    "RFC 8252 §7.3 (Loopback Interface Redirection)",
    `${RFC}/rfc8252#section-7.3`,
    READ,
  ),
  /** Authorization-server metadata fields, including `code_challenge_methods_supported`. */
  AS_METADATA_FIELDS: clause(
    "RFC 8414 §2 (Authorization Server Metadata)",
    `${RFC}/rfc8414#section-2`,
    READ,
  ),
  /** For an issuer carrying a path, the well-known segment is INSERTED, never appended. */
  AS_METADATA_PATH_INSERTION: clause(
    "RFC 8414 §3.1 (Authorization Server Metadata Request)",
    `${RFC}/rfc8414#section-3.1`,
    READ,
  ),
  /** The returned `issuer` MUST equal the issuer the client asked about. */
  AS_METADATA_ISSUER_MATCH: clause(
    "RFC 8414 §3.3 (Authorization Server Metadata Validation)",
    `${RFC}/rfc8414#section-3.3`,
    READ,
  ),
  /** The `resource` indicator on authorization and token requests. */
  RESOURCE_INDICATOR: clause(
    "RFC 8707 §2 (Resource Parameter)",
    `${RFC}/rfc8707#section-2`,
    READ,
  ),
  /** An unacceptable `resource` is `invalid_target`. */
  RESOURCE_INVALID_TARGET: clause(
    "RFC 8707 §2 (Resource Parameter) — `invalid_target`",
    `${RFC}/rfc8707#section-2`,
    READ,
  ),
  /** The authorization response carries `iss` when the server advertises support. */
  ISS_RESPONSE_PARAMETER: clause(
    "RFC 9207 §2 (Authorization Response Issuer Identification)",
    `${RFC}/rfc9207#section-2`,
    READ,
  ),
  /** Protected-resource metadata: `resource`, `authorization_servers`, `scopes_supported`. */
  PRM_FIELDS: clause(
    "RFC 9728 §2 (Protected Resource Metadata)",
    `${RFC}/rfc9728#section-2`,
    READ,
  ),
  /** For a resource carrying a path, the well-known segment is INSERTED, never appended. */
  PRM_PATH_INSERTION: clause(
    "RFC 9728 §3.1 (Protected Resource Metadata Request)",
    `${RFC}/rfc9728#section-3.1`,
    READ,
  ),
  /** The 401 challenge points at the metadata document with `resource_metadata`. */
  PRM_WWW_AUTHENTICATE_POINTER: clause(
    "RFC 9728 §5.1 (Use of WWW-Authenticate)",
    `${RFC}/rfc9728#section-5.1`,
    READ,
  ),
  /** Public clients get rotating refresh tokens, or sender-constrained ones. */
  REFRESH_ROTATION: clause(
    "RFC 9700 §4.14 (Refresh Token Protection) — OAuth 2.0 Security BCP",
    `${RFC}/rfc9700`,
    READ,
  ),
  /** Token revocation endpoint semantics. */
  REVOCATION: clause(
    "RFC 7009 §2 (Token Revocation)",
    `${RFC}/rfc7009#section-2`,
    READ,
  ),
  /** `private_key_jwt` client authentication by signed assertion. */
  PRIVATE_KEY_JWT: clause(
    "RFC 7523 §2.2 (Using JWTs for Client Authentication) with OpenID Connect Core §9",
    `${RFC}/rfc7523#section-2.2`,
    READ,
  ),
});

/**
 * Model Context Protocol clauses: authorization on revision `2025-11-25`, and the stateless
 * `2026-07-28` revision that replaced the handshake and the session.
 *
 * **Both revisions are live.** `2026-07-28` deprecates rather than deletes, on a twelve-month floor,
 * and the clients differ on which they speak — one probes for the newer revision and uses it where
 * it is offered, four are unverified. A server is therefore expected to serve both, and an
 * assertion here names the revision it comes from so a red test cannot be read as the wrong one.
 */
export const MCP = Object.freeze({
  /** An unauthenticated MCP request is refused with HTTP 401 plus a Bearer challenge. */
  UNAUTHENTICATED_401: clause(
    "MCP Authorization 2025-11-25 — Authorization Server Discovery / error handling",
    MCP_AUTHZ,
    READ,
  ),
  /** The client sends `resource` set to the canonical MCP server URL; the token is audience-bound. */
  CANONICAL_RESOURCE: clause(
    "MCP Authorization 2025-11-25 — Resource Parameter / canonical server URI",
    MCP_AUTHZ,
    READ,
  ),
  /** Tokens are validated for audience; a token for another resource MUST be refused. */
  AUDIENCE_VALIDATION: clause(
    "MCP Authorization 2025-11-25 — Access Token Validation",
    MCP_AUTHZ,
    READ,
  ),
  /** An MCP access token is never passed through to an upstream API. */
  NO_TOKEN_PASSTHROUGH: clause(
    "MCP Authorization 2025-11-25 — Security Considerations (token passthrough)",
    MCP_AUTHZ,
    READ,
  ),
  /** Registration priority: pre-registration, then CIMD, then dynamic registration. */
  CLIENT_REGISTRATION: clause(
    "MCP Authorization 2025-11-25 — Dynamic Client Registration / Client ID Metadata Documents",
    MCP_AUTHZ,
    READ,
  ),
  /** PKCE S256 is mandatory and MUST be advertised so a client can verify before starting. */
  PKCE_REQUIRED: clause(
    "MCP Authorization 2025-11-25 — PKCE requirement",
    MCP_AUTHZ,
    READ,
  ),
  /** `tools/list` publishes each tool's schema; `tools/call` executes one. */
  TOOLS: clause(
    "MCP 2025-11-25 — Server Tools",
    "https://modelcontextprotocol.io/specification/2025-11-25/server/tools",
    READ,
  ),

  // ---------------------------------------------------------------------------------------------
  // Revision 2026-07-28 — the stateless revision.
  //
  // Mostly subtractive, which is the dangerous kind: a server built on the removed assumptions
  // keeps passing its own tests while the ground moves. Deprecations run on a twelve-month floor,
  // so both revisions are live and a server is expected to serve both.
  // ---------------------------------------------------------------------------------------------

  /** No `initialize` handshake and no `Mcp-Session-Id`: each request carries its own `_meta`. */
  STATELESS_REVISION: clause(
    "MCP 2026-07-28 — Changelog (no handshake, no session, per-request `_meta`)",
    `${MCP_STATELESS}/changelog`,
    READ_STATELESS,
  ),
  /** `server/discover` is mandatory: supported revisions, capabilities, and server identity. */
  SERVER_DISCOVER: clause(
    "MCP 2026-07-28 — Changelog (`server/discover` is mandatory)",
    `${MCP_STATELESS}/changelog`,
    READ_STATELESS,
  ),
  /** List results MUST NOT vary per connection; they MAY vary by the authorization presented. */
  LIST_CONNECTION_INVARIANT: clause(
    "MCP 2026-07-28 — Changelog (list results must not vary per connection)",
    `${MCP_STATELESS}/changelog`,
    READ_STATELESS,
  ),
  /** Every result carries `resultType` — `complete`, or `input_required`. */
  RESULT_TYPE: clause(
    "MCP 2026-07-28 — Changelog (`resultType` on every result)",
    `${MCP_STATELESS}/changelog`,
    READ_STATELESS,
  ),
  /**
   * `ttlMs` and `cacheScope` MUST be present on `server/discover`, on every list method, and on
   * `resources/read`. An absent `ttlMs` means *immediately stale*, not *cache forever*.
   */
  CACHING_HINTS: clause(
    "MCP 2026-07-28 — Utilities: Caching (`ttlMs` and `cacheScope` are required)",
    `${MCP_STATELESS}/server/utilities/caching`,
    READ_STATELESS,
  ),
  /** `cacheScope: "public"` permits a result to be served across authorization contexts. */
  CACHE_SCOPE: clause(
    "MCP 2026-07-28 — Utilities: Caching (`cacheScope` semantics)",
    `${MCP_STATELESS}/server/utilities/caching`,
    READ_STATELESS,
  ),
  /** Change notifications are opt-in: declare `listChanged`, emit over a subscribed stream. */
  LIST_CHANGED: clause(
    "MCP 2026-07-28 — Utilities: Caching (change notifications and `listChanged`)",
    `${MCP_STATELESS}/server/utilities/caching`,
    READ_STATELESS,
  ),
  /** Tool names: 1–128 characters from `A–Z a–z 0–9 _ - .`, unique within the server. */
  TOOL_NAMES: clause(
    "MCP 2026-07-28 — Server Tools (tool name constraints)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /** `inputSchema` MUST be a valid JSON Schema object, never null. */
  TOOL_INPUT_SCHEMA: clause(
    "MCP 2026-07-28 — Server Tools (`inputSchema` is a JSON Schema object)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /** `structuredContent` is result data paired with `outputSchema`; publishing one binds the server to it. */
  TOOL_OUTPUT_SCHEMA: clause(
    "MCP 2026-07-28 — Server Tools (`outputSchema` and `structuredContent`)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /** Execution errors ride the result with `isError`; malformed requests and unknown tools are JSON-RPC errors. */
  TOOL_ERROR_CHANNELS: clause(
    "MCP 2026-07-28 — Server Tools (execution errors versus protocol errors)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /** Tool order is part of the contract: it is what makes client and prompt caching work. */
  TOOL_ORDER: clause(
    "MCP 2026-07-28 — Server Tools (deterministic tool ordering)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /** Tools, prompts, resources, templates and server identity may each carry `icons[]`. */
  ICONS: clause(
    "MCP 2026-07-28 — Server Tools (`icons[]` with `src`, `mimeType`, `sizes`)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /**
   * Server identity — and with it `instructions` — rides the protocol's own metadata channel:
   * the `server/discover` result on this revision, the `initialize` result on the older one.
   */
  SERVER_INSTRUCTIONS: clause(
    "MCP 2026-07-28 — Changelog (server identity and instructions on `server/discover`)",
    `${MCP_STATELESS}/changelog`,
    READ_STATELESS,
  ),
  /** Roots, Sampling, Logging, HTTP+SSE and DCR are deprecated on a twelve-month floor. */
  DEPRECATIONS: clause(
    "MCP 2026-07-28 — Release announcement (deprecation policy)",
    "https://blog.modelcontextprotocol.io/posts/2026-07-28/",
    READ_STATELESS,
  ),
});

/**
 * Vendor-published client behaviour.
 *
 * Sourced from the vendor documentation distilled in the agent toolkit
 * (`node_modules/@oakzone/agent-toolkit/docs/vendors/`), which carries the primary-source URL and a
 * per-fact strength grade. Only facts graded STRONG are asserted here; anything the vendor records
 * as Unverified is pinned as *our* behaviour with the uncertainty named in the test's docstring, per
 * that document's own instruction not to promote an unverified row into a requirement.
 */
export const VENDOR = Object.freeze({
  ANTHROPIC_AUTH: clause(
    "Anthropic — Authentication for connectors",
    "https://claude.com/docs/connectors/building/authentication",
    READ,
  ),
  ANTHROPIC_LAZY_AUTH: clause(
    "Anthropic — Lazy authentication for connectors",
    "https://claude.com/docs/connectors/building/lazy-authentication",
    READ,
  ),
  ANTHROPIC_TROUBLESHOOTING: clause(
    "Anthropic — Troubleshooting connectors",
    "https://claude.com/docs/connectors/building/troubleshooting",
    READ,
  ),
  ANTHROPIC_TESTING: clause(
    "Anthropic — Testing your connector",
    "https://claude.com/docs/connectors/building/testing",
    READ,
  ),
  ANTHROPIC_CIMD: clause(
    "Anthropic — live Client ID Metadata Document",
    "https://claude.ai/oauth/mcp-oauth-client-metadata",
    READ,
  ),
  OPENAI_PLUGIN_AUTH: clause(
    "OpenAI — Plugins, Authentication",
    "https://developers.openai.com/plugins/build/auth",
    READ,
  ),
  OPENAI_PLUGIN_BUILD: clause(
    "OpenAI — Plugins, Build an MCP server",
    "https://developers.openai.com/plugins/build/mcp-server",
    READ,
  ),
  OPENAI_TROUBLESHOOTING: clause(
    "OpenAI — Plugins, Troubleshooting",
    "https://developers.openai.com/plugins/deploy/troubleshooting",
    READ,
  ),

  /**
   * Claude Code's MCP reference: the `2026-07-28` probe, `list_changed` refresh, and the sign-in
   * failure on an unexpected `iss`.
   */
  ANTHROPIC_CLAUDE_CODE_MCP: clause(
    "Anthropic — Claude Code MCP reference",
    "https://code.claude.com/docs/en/mcp",
    READ_STATELESS,
  ),
  /** What a tool description is for, and why an error must be actionable to the model. */
  ANTHROPIC_TOOL_DESIGN: clause(
    "Anthropic — Writing tools for agents",
    "https://www.anthropic.com/engineering/writing-tools-for-agents",
    READ_STATELESS,
  ),
  /**
   * The one client documented to render `icons[]`, and the sourcing rule that decides whether
   * yours load: same authority as the server for HTTP, `file://` for stdio, `data:` for anyone.
   */
  MICROSOFT_VSCODE_MCP: clause(
    "Microsoft — VS Code MCP developer guide (`icons[]` since 1.105, and their sourcing)",
    "https://code.visualstudio.com/api/extension-guides/ai/mcp",
    READ_STATELESS,
  ),
  /**
   * ChatGPT reads the server's MCP `instructions`, and from 2026-08-21 offers stable OAuth
   * redirect URLs to authorization servers that return RFC 9207 `iss`.
   */
  OPENAI_PLUGIN_CHANGELOG: clause(
    "OpenAI — Plugins, Changelog",
    "https://developers.openai.com/plugins/changelog",
    READ_STATELESS,
  ),
});

/**
 * Render an assertion message that names the clause the expectation comes from.
 *
 * Pass the result as `expect`'s second argument so a failure reads as "this clause is unmet",
 * not "expected true, got false" — the difference between a test that reports a defect and a test
 * that reports a symptom.
 *
 * @param source - The clause this expectation implements.
 * @param requirement - What the clause requires, in one sentence, in the clause's own terms.
 * @returns The assertion message.
 */
export function cite(
  source: SpecificationClause,
  requirement: string,
): string {
  return citation(source, requirement, "required by:");
}

/**
 * Render an advisory that names the clause OFFERING something, rather than requiring it.
 *
 * The same three lines as {@link cite}, under a different relation, because an advisory is not a
 * failure and must never read as one: "required by" on something optional is how a suite acquires a
 * reputation for crying wolf, and a reputation like that gets the whole gate switched off.
 *
 * @param source - The clause this advice comes from.
 * @param statement - What is absent or unsafe, in one sentence.
 * @returns The advisory body.
 */
export function offers(
  source: SpecificationClause,
  statement: string,
): string {
  return citation(source, statement, "offered by: ");
}

function citation(
  source: SpecificationClause,
  statement: string,
  relation: string,
): string {
  return `${statement}\n  ${relation} ${source.clause}\n  read it at:  ${source.url}\n  verified:    ${source.verified}`;
}
