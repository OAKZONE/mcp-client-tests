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
const READ = "2026-08-14";

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

/** Model Context Protocol authorization, revision 2025-11-25. */
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
  return `${requirement}\n  required by: ${source.clause}\n  read it at:  ${source.url}\n  verified:    ${source.verified}`;
}
