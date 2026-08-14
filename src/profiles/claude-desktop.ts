/**
 * Claude Desktop (and claude.ai web, mobile, and Cowork — one hosted infrastructure).
 *
 * Transcribed from Anthropic's connector documentation and from Claude's live Client ID Metadata
 * Document. Every field cites the statement it comes from; none was chosen to match this
 * deployment.
 *
 * **Scope of this profile.** Anthropic runs the OAuth flow for these surfaces on its own
 * infrastructure with one shared client identity, so they share a redirect URI, a metadata document,
 * and a scope ladder. **Claude Code is deliberately NOT covered here** — it runs the flow on the
 * user's machine with its own metadata document, an ephemeral loopback redirect, a different scope
 * ladder, and a step-up that does not union the challenge's scope. Anthropic's documentation opens
 * by warning against generalising one surface to another; modelling them with one profile would be
 * exactly that mistake.
 */

import { VENDOR } from "../harness/specifications.js";
import {
  wellKnownInsertion,
  type VendorProfile,
} from "../harness/vendor-profile.js";

/**
 * The hosted redirect URI, registered verbatim.
 *
 * Source: Anthropic, *Authentication for connectors* — "callback URLs".
 */
export const CLAUDE_HOSTED_REDIRECT_URI =
  "https://claude.ai/api/mcp/auth_callback";

/** Where the harness publishes Claude's metadata document on the document origin. */
const CLIENT_METADATA_PATH = "/claude/oauth/mcp-oauth-client-metadata";

/**
 * Build Claude's Client ID Metadata Document as published, rehosted at the harness origin.
 *
 * The document below is Claude's live one, field for field, retrieved 2026-08-14 from
 * <https://claude.ai/oauth/mcp-oauth-client-metadata>. **One field is necessarily different**:
 * `client_id`. In CIMD the identifier *is* the URL the document is served from, and an authorization
 * server is required to check that the document is self-referential — so a document served by the
 * harness must name the harness URL or it would (correctly) be rejected for a reason that has
 * nothing to do with conformance. Every other field, including the `jwt-bearer` grant that signals
 * Enterprise Managed Auth support, is Claude's.
 *
 * @param clientIdUrl - The URL this document will be served from.
 * @returns The document to publish.
 */
export function claudeClientMetadata(
  clientIdUrl: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    client_id: clientIdUrl,
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: [CLAUDE_HOSTED_REDIRECT_URI],
    grant_types: [
      "authorization_code",
      "refresh_token",
      // Enterprise Managed Auth (RFC 7523). Present in Claude's live hosted document and absent
      // from Claude Code's — Anthropic reads the server's `grant_types_supported` to decide whether
      // to offer EMA at all, so a client declaring it is part of that negotiation.
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    ],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

/**
 * Claude's hosted-surface profile.
 *
 * @param clientMetadataUrl - Where the harness serves the metadata document.
 * @returns The profile.
 */
export function claudeDesktopProfile(clientMetadataUrl: string): VendorProfile {
  return {
    id: "claude-desktop",
    displayName: "Claude Desktop / claude.ai (hosted surfaces)",
    documentation: VENDOR.ANTHROPIC_AUTH,
    verifiedAgainst: "Anthropic connector documentation and live CIMD, read 2026-08-14",

    // Spec priority is pre-registration → CIMD → DCR, and Claude elects CIMD when the server
    // advertises BOTH `client_id_metadata_document_supported: true` and `"none"` among the
    // token-endpoint auth methods. Anthropic additionally warns that DCR scales badly here because
    // a new client is registered on every fresh connection.
    registration: "client_id_metadata_document",
    redirectUri: CLAUDE_HOSTED_REDIRECT_URI,
    clientMetadata: claudeClientMetadata(clientMetadataUrl),
    clientMetadataPath: CLIENT_METADATA_PATH,

    // Claude's CIMD client is a public client; the token endpoint must accept a PKCE-only request
    // with no client secret.
    tokenEndpointAuthMethod: "none",

    // "RFC 8707 `resource` is sent on authorization and token requests, set to the canonical MCP
    // server URL … including the path."
    sendsResourceParameter: true,
    sendsStateParameter: true,

    // "Plus `offline_access`, appended when your AUTHORIZATION SERVER metadata lists it in
    // `scopes_supported`." Anthropic calls this the single highest-value line for anyone debugging
    // "users must re-authenticate constantly": advertising it only in the protected-resource
    // document means it is never appended, so no refresh token is ever issued.
    appendsOfflineAccessFromAuthorizationServerMetadata: true,

    /**
     * Claude's hosted scope ladder: the challenge's `scope` if present, otherwise the
     * protected-resource metadata's `scopes_supported`; then `offline_access` when the
     * authorization-server metadata advertises it.
     *
     * The authorization server's own `scopes_supported` is deliberately NOT a rung: the hosted
     * ladder stops at the resource's list.
     */
    selectScope(inputs) {
      const base = inputs.challengeScope
        ? inputs.challengeScope.split(" ").filter(Boolean)
        : [...inputs.protectedResourceScopes];
      if (
        inputs.authorizationServerScopes.includes("offline_access") &&
        !base.includes("offline_access")
      ) {
        base.push("offline_access");
      }
      return base.length > 0 ? base.join(" ") : undefined;
    },

    /**
     * Claude tries RFC 8414 first, then OpenID Connect Discovery; only one needs to answer and a
     * `404` on the other is expected. For a path-bearing issuer the well-known segment is inserted
     * (RFC 8414 §3.1), which is the transformation the library performs and this list mirrors.
     */
    authorizationServerProbeOrder(issuer) {
      return [
        wellKnownInsertion(issuer, "oauth-authorization-server"),
        wellKnownInsertion(issuer, "openid-configuration"),
      ];
    },

    /**
     * Protected-resource discovery: the `resource_metadata` pointer on the `401` is preferred and is
     * tested separately; absent that, Claude probes the resource-path insertion and then the origin
     * root.
     */
    protectedResourceProbeOrder(mcpServerUrl) {
      const parsed = new URL(mcpServerUrl);
      return [
        wellKnownInsertion(mcpServerUrl, "oauth-protected-resource"),
        `${parsed.origin}/.well-known/oauth-protected-resource`,
      ];
    },
  };
}
