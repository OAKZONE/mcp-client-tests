/**
 * ChatGPT (Desktop, web, and mobile — Developer mode and published plugins).
 *
 * Transcribed from OpenAI's Plugins authentication, build, and troubleshooting documentation. Every
 * field cites the statement it comes from; none was chosen to match this deployment.
 *
 * **Two things this profile models that Claude's does not**, both of which are where a server that
 * works for Claude typically fails for ChatGPT:
 *
 * - **`private_key_jwt` client authentication.** ChatGPT's metadata document advertises `none` and
 *   `private_key_jwt` and declares the latter; the method actually used is the intersection of what
 *   both sides advertise. OpenAI's documentation is explicit that a missing assertion is a failed
 *   exchange to capture and escalate — **never** permission to relabel an authenticated client as
 *   public. A server that silently rewrites the method to `none` will pass a naive test and has in
 *   fact accepted an unauthenticated client.
 * - **A three-URL authorization-server discovery order**, which differs from Claude's two.
 *
 * **What is deliberately not asserted.** OpenAI does not document how ChatGPT merges its scope
 * sources or its step-up retry bound. Those are recorded as unverified rather than guessed; the
 * suite pins this deployment's behaviour there and says so in the test's own docstring. The MCP
 * revision this surface negotiates is Unverified for the same reason.
 *
 * **Re-read 2026-08-29 against the plugin changelog to 2026-08-21. No field moved**, and one new
 * fact changes what a server gains by emitting RFC 9207 `iss`: since 2026-08-21 **a plugin can use
 * a stable OAuth redirect URL together with client-ID metadata when the authorization server
 * returns `iss`**, which removes the per-connection callback churn this profile still models. The
 * per-connection URI remains the documented default, so it stays what the suite drives; the `iss`
 * assertion lives in the Claude Code suite, where a client is documented to fail without it.
 */

import { VENDOR } from "../harness/specifications.js";
import {
  wellKnownInsertion,
  type VendorProfile,
} from "../harness/vendor-profile.js";

/**
 * A per-connection ChatGPT callback.
 *
 * New connections use `https://chatgpt.com/connector/oauth/{callback_id}`; the exact value is shown
 * in the plugin management surface and must be allowlisted exactly rather than guessed or
 * wildcarded. The id below is an arbitrary opaque value standing in for one issued connection —
 * what the suite exercises is that an exact, previously unseen per-connection URI registers and
 * round-trips, which is the property that matters.
 */
export const CHATGPT_REDIRECT_URI =
  "https://chatgpt.com/connector/oauth/c0nf0rmance-callback-id";

/**
 * The legacy shared callback, retained by OpenAI only for already-published apps.
 *
 * Modelled so a deployment can check it does not accidentally depend on it.
 */
export const CHATGPT_LEGACY_REDIRECT_URI =
  "https://chatgpt.com/connector_platform_oauth_redirect";

const CLIENT_METADATA_PATH = "/chatgpt/oauth/client-metadata";
const CLIENT_JWKS_PATH = "/chatgpt/oauth/jwks.json";

/**
 * ChatGPT's Client ID Metadata Document, in the shape OpenAI documents.
 *
 * The two auth-method fields are quoted directly from OpenAI's documentation: the plural field is
 * the supported set without preference order, the singular legacy field is the preference, and the
 * authorization server chooses from the intersection of what both sides advertise. `jwks_uri` is
 * where the server fetches the public keys that verify the client's signed assertion — OpenAI
 * publishes it on the CIMD metadata origin, which is what this mirrors.
 *
 * @param clientIdUrl - The URL this document will be served from (the `client_id`).
 * @param jwksUrl - Where the client's public key set is served.
 * @returns The document to publish.
 */
export function chatgptClientMetadata(
  clientIdUrl: string,
  jwksUrl: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    client_id: clientIdUrl,
    client_name: "ChatGPT",
    client_uri: "https://chatgpt.com",
    redirect_uris: [CHATGPT_REDIRECT_URI],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_method: "private_key_jwt",
    jwks_uri: jwksUrl,
  });
}

/**
 * ChatGPT's profile.
 *
 * @param clientMetadataUrl - Where the harness serves the metadata document.
 * @param jwksUrl - Where the harness serves the client's public key set.
 * @returns The profile.
 */
export function chatgptDesktopProfile(
  clientMetadataUrl: string,
  jwksUrl: string,
): VendorProfile {
  return {
    id: "chatgpt-desktop",
    displayName: "ChatGPT (Developer mode / published plugin)",
    documentation: VENDOR.OPENAI_PLUGIN_AUTH,
    verifiedAgainst:
      "OpenAI Plugins documentation plus live ChatGPT Desktop connector, verified 2026-08-15 and " +
      "re-read 2026-08-29 including the plugin changelog to 2026-08-21 — no field moved",

    // ChatGPT supports CIMD, DCR, and pre-registration, and the plugin builder can select DCR even
    // when CIMD is available — so a deployment advertising both must keep both paths working. This
    // profile drives CIMD; the DCR path is exercised separately in the same suite.
    registration: "client_id_metadata_document",
    redirectUri: CHATGPT_REDIRECT_URI,
    clientMetadata: chatgptClientMetadata(clientMetadataUrl, jwksUrl),
    clientMetadataPath: CLIENT_METADATA_PATH,
    clientJwksPath: CLIENT_JWKS_PATH,

    // The declared preference, and the method the suite actually authenticates with. OpenAI signs
    // the token request server-side with a managed key; the server validates it against the JWKS
    // published on the metadata origin.
    tokenEndpointAuthMethod: "private_key_jwt",

    // "ChatGPT sends the exact [protected-resource metadata `resource`] value as `resource` on
    // authorization and token requests."
    sendsResourceParameter: true,
    sendsStateParameter: true,

    // Observed on the live desktop connector: ChatGPT registers the refresh-token grant but does
    // not append `offline_access` from authorization-server metadata. Servers that inherit an
    // OIDC-only issuance policy consequently strand the connection when the access token expires.
    appendsOfflineAccessFromAuthorizationServerMetadata: false,

    /**
     * ChatGPT's baseline comes from the transport challenge's `scope`, falling back to the
     * protected-resource metadata's `scopes_supported`, plus per-tool `securitySchemes` scopes and
     * the OIDC scopes it requests when discovery advertises them.
     *
     * **The merge algorithm is not documented**, and OpenAI says explicitly not to invent a
     * precedence rule — so this models only the two rungs that are documented and stated. Tests
     * that would depend on the undocumented part assert this deployment's behaviour and name the
     * uncertainty.
     */
    selectScope(inputs) {
      const base = inputs.challengeScope
        ? inputs.challengeScope.split(" ").filter(Boolean)
        : [...inputs.protectedResourceScopes];
      return base.length > 0 ? base.join(" ") : undefined;
    },

    /**
     * OpenAI documents a three-URL order for a path-bearing issuer such as
     * `https://example.com/api/oauth`:
     *
     * 1. `https://example.com/.well-known/oauth-authorization-server/api/oauth`
     * 2. `https://example.com/.well-known/openid-configuration/api/oauth`
     * 3. `https://example.com/api/oauth/.well-known/openid-configuration`
     *
     * The third is the OpenID Connect Discovery append form — the only place any covered client
     * derives an append-shaped URL, and only for the OIDC document.
     */
    authorizationServerProbeOrder(issuer) {
      const parsed = new URL(issuer);
      const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
      return [
        wellKnownInsertion(issuer, "oauth-authorization-server"),
        wellKnownInsertion(issuer, "openid-configuration"),
        `${parsed.origin}${path}/.well-known/openid-configuration`,
      ];
    },

    /**
     * "For an MCP endpoint `https://example.com/public/mcp`, serve and test
     * `https://example.com/.well-known/oauth-protected-resource/public/mcp` and
     * `https://example.com/.well-known/oauth-protected-resource`."
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
