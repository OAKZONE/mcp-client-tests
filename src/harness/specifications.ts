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

/**
 * How well established the fact behind a clause is.
 *
 * **This is the axis that decides whether an expectation may fail a run.** A specification's own
 * text and a vendor's own documentation are things this package can hold a server to. A
 * reproduced field report, or a number circulating in a community issue log that no vendor has
 * ever published, is not — and asserting one would make a red test an opinion, which is the exact
 * failure mode `AGENTS.md` exists to prevent.
 *
 * The grades are the ones the distilled vendor documentation uses, kept verbatim so a reader can
 * move between that source and a failure message without re-learning a vocabulary:
 *
 * | Grade | What it means | What this package may do with it |
 * |:---|:---|:---|
 * | `strong` | A primary source read directly, or behaviour reproduced against a live deployment. | **Assert.** {@link cite} accepts it. |
 * | `moderate` | Vendor prose with no testable assertion, or a single field report. | Advise, via {@link reports}. |
 * | `thin` | An uncorroborated community report. | Advise, and say the number is not a fact. |
 * | `unverified` | A gap recorded rather than filled by guess. | Advise, or say nothing. Never assert. |
 *
 * A clause that declares no grade is `strong`: `verified` already means somebody read the primary
 * source on that date, so the interesting case — and the one that must be declared out loud — is a
 * fact this package is *not* certain of.
 */
export type EvidenceGrade = "strong" | "moderate" | "thin" | "unverified";

/** One normative clause: what it says, where to read it, and how well established it is. */
export interface SpecificationClause {
  /** Human-readable source and clause, e.g. `RFC 6750 §3.1`. */
  readonly clause: string;
  /** Direct link to the clause. */
  readonly url: string;
  /** ISO date this clause was last read against the live source. */
  readonly verified: string;
  /** How well established the fact is. Absent means {@link EvidenceGrade} `strong`. */
  readonly grade: EvidenceGrade;
  /**
   * Why the grade is below `strong`, in the reader's terms — what corroboration is missing, and
   * what they must therefore not conclude. Present only on a graded-down clause, where a bare
   * grade word would leave a reader to invent their own reason.
   */
  readonly caveat?: string;
}

function clause(
  clauseText: string,
  url: string,
  verified: string,
): SpecificationClause {
  return Object.freeze({ clause: clauseText, url, verified, grade: "strong" });
}

/**
 * A clause recording a fact this package is **not** certain enough of to assert.
 *
 * Kept as a separate constructor rather than a fourth argument to {@link clause}, so that grading a
 * fact down is a visible, deliberate act at the call site rather than a value someone can drift
 * past. Everything built with this is unusable by {@link cite} — see the guard there.
 *
 * @param clauseText - Human-readable source and clause.
 * @param url - Direct link.
 * @param verified - ISO date the source was last read.
 * @param grade - How well established the fact is.
 * @param caveat - What corroboration is missing, and what a reader must not conclude.
 * @returns The clause.
 */
function graded(
  clauseText: string,
  url: string,
  verified: string,
  grade: Exclude<EvidenceGrade, "strong">,
  caveat: string,
): SpecificationClause {
  return Object.freeze({ clause: clauseText, url, verified, grade, caveat });
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
 * When the vendor rows re-read in the 2026-09-05 sweep were last verified.
 *
 * A third stamp rather than a bulk edit of the other two, because that sweep moved a small number
 * of vendor facts and left the rest standing. Sharing one date across all of them would claim a
 * re-read that did not happen for the clauses it did not touch — and this file's whole value is
 * that a `verified` date means somebody actually looked.
 */
const READ_VENDOR_SWEEP = "2026-09-05";

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

  // ---------------------------------------------------------------------------------------------
  // The client-side gate.
  //
  // Authorization decides whether a client can REACH this server. These clauses are the separate
  // question of whether a reachable, authorized tool is offered to the model and allowed to run —
  // and a call can die at any of five layers (admission, enablement, approval, classification,
  // content scanning) without a message that reaches the server.
  //
  // `annotations` is the only one of those layers a server can steer from the wire, which is why
  // the clauses below are worth asserting at all: everything else is configured on the client and
  // is invisible from here.
  // ---------------------------------------------------------------------------------------------

  /**
   * A tool MAY carry `annotations`, and a client MUST treat them as untrusted unless the server is
   * a trusted one.
   *
   * The second half is the reason an annotation buys **less friction, never more authority**: a
   * client enforces its own policy regardless, so nothing declared here relaxes the server's own
   * obligation to authorize the call.
   */
  TOOL_ANNOTATIONS: clause(
    "MCP — Server Tools (`annotations`, and the untrusted-hint rule)",
    "https://modelcontextprotocol.io/specification/2025-11-25/server/tools",
    READ_VENDOR_SWEEP,
  ),
  /**
   * **The stated defaults for an unannotated tool**, and the single most consequential sentence in
   * this file for a tool surface: "a tool with no annotations is assumed to be non-read-only,
   * potentially destructive, non-idempotent, and open-world".
   *
   * Unannotated is therefore not neutral — it is *maximally suspicious*, and every gate downstream
   * acts on that reading. This is what makes the absence of an `annotations` object a finding
   * rather than a matter of taste.
   */
  TOOL_ANNOTATION_DEFAULTS: clause(
    "MCP — Tool annotations announcement (the assumed defaults when `annotations` is absent)",
    "https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/",
    READ_VENDOR_SWEEP,
  ),
  /** Tools, prompts, resources, templates and server identity may each carry `icons[]`. */
  ICONS: clause(
    "MCP 2026-07-28 — Server Tools (`icons[]` with `src`, `mimeType`, `sizes`, `theme`)",
    `${MCP_STATELESS}/server/tools`,
    READ_STATELESS,
  ),
  /**
   * `theme` names the ground the artwork is drawn for, and **absent is not a default of light**:
   * the schema's own words are that a client "should assume the icon can be used with any theme".
   * `sizes` reads the same way, with `"any"` the sentinel for scalable formats.
   */
  ICON_THEME: clause(
    "MCP 2026-07-28 — Schema (`Icon.theme` of `light` | `dark`, absent meaning any theme)",
    `${MCP_STATELESS}/schema`,
    READ_VENDOR_SWEEP,
  ),
  /**
   * **The specification states no rule for how a client chooses among several icons.**
   *
   * That silence is the whole constraint, and the reason the advice built on it is a hedge rather
   * than a requirement: a server publishing only `light` and `dark` variants cannot rely on any
   * client finding the one matching its ground. A client that ignores `theme`, or that simply takes
   * the first renderable entry, draws whichever came first — turning a mark that was merely untuned
   * into one drawn for the wrong ground, with no error and no fallback to report it.
   */
  ICON_SELECTION_UNSPECIFIED: clause(
    "MCP 2026-07-28 — Schema (no rule is given for choosing among several `icons[]` entries)",
    `${MCP_STATELESS}/schema`,
    READ_VENDOR_SWEEP,
  ),
  /**
   * The extensions layer: a client declares extensions per request in
   * `_meta["io.modelcontextprotocol/clientCapabilities"].extensions`, and a server declares them on
   * `server/discover` under `capabilities.extensions`.
   */
  EXTENSIONS: clause(
    "MCP Extensions — capability negotiation (`capabilities.extensions` on `server/discover`)",
    "https://modelcontextprotocol.io/extensions",
    READ_VENDOR_SWEEP,
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
 * WebMCP — the browser-side tool API, which is **not** the Model Context Protocol.
 *
 * **Read this before adding an assertion here.** WebMCP lets a page hand its own functions to an
 * in-browser agent as typed tools. It borrows MCP's vocabulary — tools, descriptions, JSON Schema —
 * and none of its wire: no JSON-RPC, no transport, no server, no OAuth. Nothing in {@link MCP}
 * applies to it, and importing a rule across that gap is how a reader ends up carrying MCP's
 * security model onto a surface that has none of its controls.
 *
 * **What this package can and cannot reach.** Only the *declarative* API — forms carrying
 * `toolname` / `tooldescription` / `toolparamdescription` — is visible in served HTML, so it is the
 * half that crosses a socket and the only half asserted here. The *imperative* API
 * (`document.modelContext.registerTool`) is a JavaScript call in the user's tab; observing it needs
 * a real browser running the origin trial, which this package does not ship. That gap is stated in
 * every WebMCP suite rather than papered over, because a suite that silently checked nothing is
 * exactly the failure this package exists to prevent.
 *
 * **The declarative half is the less finished half**, by the explainer's own account: input-schema
 * synthesis is marked TBD, the response mechanism is "under debate", and `outputSchema` support and
 * declarative visibility through `getTools()` are unresolved. So most of what this package has to
 * say about it is advisory. Only what the specification *states* is asserted.
 */
export const WEBMCP = Object.freeze({
  /** `ModelContextTool` requires `name` and `description`; the page's tools are per-`Document`. */
  TOOL_SHAPE: clause(
    "WebMCP — Draft Community Group Report (`ModelContextTool` requires `name` and `description`)",
    "https://webmachinelearning.github.io/webmcp/",
    READ_VENDOR_SWEEP,
  ),
  /**
   * The declarative API: `toolname` and `tooldescription` on a form, `toolparamdescription` on each
   * control, and validation attributes (`required`, `min`, `max`, `step`) becoming schema
   * constraints.
   */
  DECLARATIVE_API: clause(
    "WebMCP — Declarative API explainer (`toolname`, `tooldescription`, `toolparamdescription`)",
    "https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md",
    READ_VENDOR_SWEEP,
  ),
  /**
   * `toolautosubmit` lets an agent submit a form without user review.
   *
   * That is a consent decision wearing the clothes of a convenience flag: the tool runs in the
   * user's tab, in their live authenticated session, called by a model reading text it did not
   * write.
   */
  AUTOSUBMIT_IS_CONSENT: clause(
    "WebMCP — Declarative API explainer (`toolautosubmit` submits without user review)",
    "https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md",
    READ_VENDOR_SWEEP,
  ),
  /**
   * The annotations are **hints**, and nothing requires an agent to honour any of them.
   *
   * `readOnlyHint` on a tool that writes is therefore not a mislabel; it is a shipped
   * vulnerability. Set them honestly and design as though the agent ignores them.
   */
  HINTS_ARE_NOT_ENFORCEMENT: clause(
    "WebMCP — Security and privacy questionnaire (annotations are hints, not guarantees)",
    "https://github.com/webmachinelearning/webmcp/blob/main/security-privacy-questionnaire.md",
    READ_VENDOR_SWEEP,
  ),
  /**
   * Over-parameterization leaks: a tool asking for a non-minimal set of personal data causes
   * leakage simply by being called.
   */
  MINIMAL_PARAMETERS: clause(
    "WebMCP — Security and privacy questionnaire (ask for the least the operation needs)",
    "https://github.com/webmachinelearning/webmcp/blob/main/security-privacy-questionnaire.md",
    READ_VENDOR_SWEEP,
  ),
  /** Secure context, `tools` Permissions Policy defaulting to `self`, `exposedTo` widening it. */
  EXPOSURE: clause(
    "WebMCP — Chrome for Developers (secure context, `tools` Permissions Policy, `exposedTo`)",
    "https://developer.chrome.com/docs/ai/webmcp",
    READ_VENDOR_SWEEP,
  ),
  /**
   * The object moved from `navigator.modelContext` to `document.modelContext`, deprecated in
   * Chrome 150.0.7861.0 and still the spelling in much third-party writing. Feature-detect; never
   * version-detect.
   */
  DOCUMENT_MODEL_CONTEXT: clause(
    "WebMCP — `navigator` → `document` migration (webmcp#184)",
    "https://github.com/webmachinelearning/webmcp/pull/184",
    READ_VENDOR_SWEEP,
  ),
  /**
   * How a browser is made to expose the API at all.
   *
   * Chrome states the flag and the origin trial: `chrome://flags/#enable-webmcp-testing` from
   * 146.0.7672.0, and an origin trial from Chrome 149 (trial id `4163014905550602241`). Both are
   * STRONG — Chrome's own documentation.
   *
   * **The command-line spelling of that flag is not in Chrome's documentation.** It is recorded by
   * a testing vendor as `--enable-features=WebMCPTesting,DevToolsWebMCPSupport`, which is a single
   * secondary source. The harness therefore uses it as a **default it can be overridden out of**,
   * never as a fact it asserts — and it verifies the API is present before drawing any conclusion,
   * so a wrong switch produces a named stop rather than a page reported as toolless.
   *
   * **Sources disagree on the testing surface's method name**, `getTools()` versus `listTools()`.
   * The harness probes both and reports which answered rather than picking one.
   */
  CHROME_ENABLEMENT: clause(
    "WebMCP — Chrome for Developers (the `#enable-webmcp-testing` flag and the Chrome 149 origin trial)",
    "https://developer.chrome.com/docs/ai/webmcp",
    READ_VENDOR_SWEEP,
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
  /**
   * Re-read 2026-09-05, when the redirect-URI guidance was found to have been recorded backwards.
   *
   * The **stable** `https://chatgpt.com/connector_platform_oauth_redirect` is the *recommended*
   * form for any authorization server that emits RFC 9207 `iss`; the per-connection
   * `{callback_id}` form is the **fallback** for servers that do not. This package previously
   * asserted the inverse, which is why the date moved on this clause alone.
   */
  OPENAI_PLUGIN_AUTH: clause(
    "OpenAI — Plugins, Authentication",
    "https://developers.openai.com/plugins/build/auth",
    READ_VENDOR_SWEEP,
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

  // ---------------------------------------------------------------------------------------------
  // The gate: what each client does with the tool list it received.
  //
  // Ordered by grade, not by vendor, because the grade is what decides whether a suite may fail on
  // a row. Everything down to OPENAI_RISKY_ACTIONS_BLOCKED is STRONG and assertable; everything
  // below it is graded down and reaches a consumer only as advice.
  // ---------------------------------------------------------------------------------------------

  /**
   * Anthropic's connector review criteria — the clearest published statement of what Claude's gate
   * wants, and the source of four separate requirements this package asserts.
   *
   * Tool names are **64 characters or fewer**, not the specification's 128. Every tool carries a
   * `title` and the applicable hint, and those "determine auto-permissions in Claude: read-only
   * tools can run without per-call confirmation; destructive tools always prompt". A single tool
   * accepting both safe and unsafe HTTP methods is **rejected** — a catch-all `api_request` with a
   * `method` parameter is named explicitly, and "documenting safe versus unsafe operations within
   * one tool's description does not satisfy this requirement". Descriptions are rejected when they
   * instruct Claude rather than describe the tool.
   */
  ANTHROPIC_REVIEW_CRITERIA: clause(
    "Anthropic — Connector review criteria (tool names, mandatory `title` plus hint, the " +
      "read/write split, and the description rejection list)",
    "https://claude.com/docs/connectors/building/review-criteria",
    READ_VENDOR_SWEEP,
  ),
  /**
   * OpenAI's developer-mode contract, and **the strictest annotation default in this file**:
   * "We respect the `readOnlyHint` tool annotation. Tools without this hint are treated as write
   * actions." Write actions require confirmation, and approval memory lasts for one conversation —
   * a refresh prompts again — so there is no durable always-allow to design around.
   */
  OPENAI_DEVELOPER_MODE: clause(
    "OpenAI — Developer mode (`readOnlyHint` respected; an unhinted tool is a write action)",
    "https://developers.openai.com/api/docs/guides/developer-mode",
    READ_VENDOR_SWEEP,
  ),
  /**
   * The one documented hard tool cap in this file: "A chat request can have a maximum of 128 tools
   * enabled at a time", failing the whole request above it.
   *
   * It counts **every** tool in the request — the editor's built-ins, extension-contributed tools,
   * and every enabled MCP server — so it is a budget a server shares rather than one it owns. That
   * is why the figure informs advice and never an assertion about a server's own tool count.
   */
  MICROSOFT_VSCODE_AGENT_TOOLS: clause(
    "Microsoft — VS Code agent tools (the 128-tool per-request ceiling)",
    "https://code.visualstudio.com/docs/copilot/agents/agent-tools",
    READ_VENDOR_SWEEP,
  ),
  /**
   * Why description text is scanned as an attack surface rather than read as guidance.
   *
   * The disclosed attack hides instructions in a description the user never sees and the model
   * always reads. The consequence for an honest server is the part that matters here: **a
   * legitimate instruction in a description is indistinguishable from the attack**, so it is
   * treated as the attack.
   */
  INVARIANT_TOOL_POISONING: clause(
    "Invariant Labs — MCP tool-poisoning disclosure (description text as the injection vector)",
    "https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks",
    READ_VENDOR_SWEEP,
  ),
  /**
   * Claude Code's auto-mode classifier: a second gate that runs after permission policy said yes.
   *
   * The published figures are the vendor's own — a first stage instructed to "err on the side of
   * blocking" at an 8.5% false-positive rate, cut to 0.4% by a second reasoning stage that accepts
   * a 17% false-negative rate. It is **reasoning-blind by design**: the classifier sees the user's
   * messages and the bare tool call, never the server's output — so nothing a tool returns can
   * argue its way past it, and a block is a routine operating condition to design around rather
   * than a verdict on the server.
   */
  ANTHROPIC_AUTO_MODE: clause(
    "Anthropic — How we built Claude Code auto mode (the two-stage classifier, and its figures)",
    "https://www.anthropic.com/engineering/claude-code-auto-mode",
    READ_VENDOR_SWEEP,
  ),
  /**
   * Claude Code's organization controls, and the two that a server can neither see nor fix.
   *
   * `managed-mcp.json`, `allowedMcpServers` / `deniedMcpServers` and `allowManagedMcpServersOnly`
   * refuse a connection outright — a newly-blocked server "silently disappears from `/mcp` and
   * `claude mcp list` with no warning". Per tool, an organization may set `ask`, which **no allow
   * rule overrides in any permission mode**, or `blocked`, which filters the tool out before Claude
   * sees it.
   */
  ANTHROPIC_MANAGED_MCP: clause(
    "Anthropic — Control MCP server access for your organization (`managed-mcp.json`, and the " +
      "per-tool `ask` / `blocked` controls)",
    "https://code.claude.com/docs/en/managed-mcp",
    READ_VENDOR_SWEEP,
  ),
  /**
   * The surface with **no gate at all**: the Messages API connector has no user interface and
   * therefore no human to prompt.
   *
   * Read it as the design constraint behind every other row — every catalog a server publishes is
   * reachable from at least one surface where nothing will confirm anything.
   */
  ANTHROPIC_MESSAGES_CONNECTOR: clause(
    "Anthropic — Messages API MCP connector (no approval surface; the caller's own code decides)",
    "https://platform.claude.com/docs/en/agents-and-tools/mcp-connector",
    READ_VENDOR_SWEEP,
  ),
  /**
   * GitHub's organization MCP policy, and the fact that decides an enterprise support question:
   * it is **off by default** for the Business and Enterprise subscribers it covers, and it does not
   * apply to Free, Pro, Pro+ or Max at all.
   *
   * "The server does not appear for one user in an organization and works for another" is a policy
   * symptom, not a server defect.
   */
  GITHUB_COPILOT_MCP_POLICY: clause(
    "GitHub — Copilot MCP policy and the first-start trust dialog",
    "https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/manage-policies",
    READ_VENDOR_SWEEP,
  ),
  /**
   * Cursor asks before invoking an MCP tool by default, and routes non-allowlisted calls through an
   * Auto-review classifier that may allow, redirect, or ask.
   *
   * Cursor's own framing of that classifier is worth carrying: it is an **approval convenience,
   * not a security boundary**.
   */
  ANYSPHERE_CURSOR_MCP: clause(
    "Cursor — MCP (approval default, and Auto-review over non-allowlisted calls)",
    "https://docs.cursor.com/context/mcp",
    READ_VENDOR_SWEEP,
  ),
  /**
   * Codex follows its `approval_policy` and permission profile rather than a classifier over MCP
   * calls, and from v0.134.0 uses `readOnlyHint` to decide what may execute concurrently.
   */
  OPENAI_CODEX_MCP: clause(
    "OpenAI — Codex configuration (`approval_policy`, permission profiles, and `readOnlyHint` " +
      "driving concurrent execution from v0.134.0)",
    "https://learn.chatgpt.com/docs/codex/config",
    READ_VENDOR_SWEEP,
  ),
  /**
   * ChatGPT refuses some calls rather than offering them: for write or modify actions it "may ask
   * for confirmation depending on app permissions, the action's context, and the action's
   * potential impact, and some especially risky actions may be blocked instead of being presented
   * for approval".
   *
   * Vendor prose with no testable assertion behind it, so it is graded `moderate` and informs
   * advice about owning the confirmation rather than an assertion about any particular tool.
   */
  OPENAI_RISKY_ACTIONS_BLOCKED: graded(
    "OpenAI — Connector actions (some especially risky actions are blocked rather than prompted)",
    "https://developers.openai.com/plugins/build/mcp-server",
    READ_VENDOR_SWEEP,
    "moderate",
    "vendor prose naming no threshold and no tool class — it says a block can happen, never when, " +
      "so no server can predict or test which of its tools this reaches",
  ),
  /**
   * VS Code is **reported** to confirm every tool not marked `readOnlyHint: true`, and the
   * JetBrains plugin has an open request to honour the hint the same way.
   *
   * Graded `moderate` because VS Code's own MCP developer guide states nothing about annotations.
   * The practical advice is unchanged — publish them anyway, the cost is nil and two other clients
   * act on them decisively — but it is advice, not a requirement this package may fail a run on.
   */
  MICROSOFT_VSCODE_ANNOTATIONS: graded(
    "Microsoft — VS Code MCP servers (annotation handling, reported rather than documented)",
    "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    READ_VENDOR_SWEEP,
    "moderate",
    "reported behaviour; VS Code's MCP developer guide states nothing about annotations, so the " +
      "hint may be honoured, ignored, or changed without a note",
  ),
  /**
   * The reported aggregate ceiling on Claude's hosted surfaces: ~256 tools across **all** connected
   * connectors, keeping the alphabetically-first and truncating the rest.
   *
   * **Do not quote this number as fact.** It comes from a third-party issue log; Anthropic
   * documents no tool ceiling of any kind, and a re-check on 2026-09-05 found none. The *shape* is
   * what this package acts on and it is corroborated independently — a shared budget, spent across
   * every server the user connected, trimmed arbitrarily by the client. Advice written against the
   * shape holds whether or not the figure is right.
   */
  ANTHROPIC_AGGREGATE_TOOL_CEILING: graded(
    "Claude hosted surfaces — reported ~256-tool aggregate ceiling with alphabetical truncation",
    "https://github.com/anthropics/claude-ai-mcp/issues/137",
    READ_VENDOR_SWEEP,
    "thin",
    "an uncorroborated community report; Anthropic publishes no ceiling, and a 2026-09-05 re-check " +
      "found none — design to the shared-budget shape, never to the number",
  ),
  /**
   * Cursor's tool ceiling, recorded as **contested rather than as a figure**.
   *
   * ~40 is widely repeated; a 2026-03-03 forum thread reports 80+ tools with no warning and
   * attributes the change to Cursor's dynamic context discovery. There is no vendor number either
   * way and no changelog entry. An undocumented ceiling existed, may have moved, and has never been
   * published — so neither 40 nor 80 may be quoted.
   */
  CURSOR_TOOL_CEILING: graded(
    "Cursor — an undocumented tool ceiling, contested between ~40 and 80+",
    "https://docs.cursor.com/context/mcp",
    READ_VENDOR_SWEEP,
    "thin",
    "two uncorroborated community figures that contradict each other, and no vendor statement — " +
      "quote neither 40 nor 80",
  ),
  /**
   * Codex profile keys reported to **hard-block** rather than prompt: a destructive- or
   * open-world-hinted tool refused outright, with no approval offered.
   *
   * If it holds, it is the harshest consequence of an honest `destructiveHint` anywhere in this
   * file — which is exactly why it is not asserted. The confirmed half is separate and STRONG:
   * `readOnlyHint` drives concurrent execution from v0.134.0.
   */
  CODEX_PROFILE_HARD_BLOCK: graded(
    "Codex CLI — reported `destructive_enabled` / `open_world_enabled` profile keys that refuse " +
      "rather than prompt",
    "https://learn.chatgpt.com/docs/codex/config",
    READ_VENDOR_SWEEP,
    "thin",
    "a community report of key names that appear in no published configuration reference; the " +
      "behaviour may not exist, and no server can detect it",
  ),
  /**
   * Whether Cursor and Grok read a tool's `annotations` at all.
   *
   * Recorded as a gap rather than filled by guess. A server publishes annotations regardless — the
   * cost is nil and two clients act on them decisively — but nothing here may claim what these two
   * do with them.
   */
  ANNOTATION_HANDLING_UNVERIFIED: graded(
    "Cursor and Grok — whether a tool's `annotations` are read at all",
    "https://docs.cursor.com/context/mcp",
    READ_VENDOR_SWEEP,
    "unverified",
    "no vendor statement and no reproduced observation either way — publish annotations, and " +
      "assume nothing about what these clients do with them",
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
  if (source.grade !== "strong") {
    // Not a test failure — a defect in this package, raised where it is written rather than
    // reported as a finding about somebody's server (MCT05). A suite that failed a run on a
    // community report would be asserting an opinion, which is the one thing `AGENTS.md` forbids
    // outright; making that unrepresentable is cheaper than trusting every future author to
    // remember. `reports()` is the channel for a fact graded below `strong`.
    throw new Error(
      `mcp-client-tests: cannot assert on a ${source.grade.toUpperCase()}-graded clause.\n` +
        `  clause:   ${source.clause}\n` +
        `  caveat:   ${source.caveat ?? "(none recorded)"}\n` +
        "  Only a fact read from a primary source may fail a consumer's run. Record this one with " +
        "`advise()` and `reports()` instead, which says what was observed without claiming a " +
        "requirement the source does not carry.",
    );
  }
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

/**
 * Render an advisory for a fact this package is **not certain of** — a client behaviour reported
 * but not documented, a number circulating with no vendor behind it, a gap nobody has filled.
 *
 * The third relation, beside {@link cite}'s *required by* and {@link offers}'s *offered by*. It
 * exists because those two both imply a source that **states** something, and the most useful
 * things known about a client's gate are not stated anywhere: they are reproduced, reported, or
 * contested. Saying nothing would waste what the sweep learned; saying "required by" would be a
 * lie that eventually gets the whole gate switched off.
 *
 * The grade and its caveat are rendered with the citation, so a reader sees *how much to trust
 * this* in the same glance as *where it came from* — which is the difference between advice they
 * can act on and advice they have to go research.
 *
 * @param source - The clause this observation comes from. Normally graded below `strong`; a
 *   `strong` clause is accepted, for the case where a well-established fact is still only worth
 *   reporting because the server cannot act on it.
 * @param statement - What was observed, in one sentence.
 * @returns The advisory body.
 */
export function reports(
  source: SpecificationClause,
  statement: string,
): string {
  return citation(source, statement, "reported by:");
}

function citation(
  source: SpecificationClause,
  statement: string,
  relation: string,
): string {
  const lines = [
    statement,
    `  ${relation} ${source.clause}`,
    `  read it at:  ${source.url}`,
    `  verified:    ${source.verified}`,
  ];
  if (source.grade !== "strong") {
    lines.push(`  evidence:    ${source.grade.toUpperCase()} — ${source.caveat}`);
  }
  return lines.join("\n");
}
