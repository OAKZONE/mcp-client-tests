/**
 * Claude Code's OAuth profile, transcribed from the reference and live CIMD (2026-08-14).
 *
 * Scope precedence remains pinned oauth.scopes, challenge, protected-resource scopes, then no
 * scope; offline_access is appended when advertised. The reference and CIMD have not been reopened
 * in this pass, so their verification dates remain unchanged.
 *
 * Changelog re-read 2026-10-19 through v2.1.303:
 * - v2.1.288 adds a re-authentication prompt when a tool needs more scope. This does not establish
 *   a union of challenge scopes with the pinned set; no scope-selection field changes here.
 * - v2.1.292 probes stdio for 2026-07-28 on every install. v2.1.295 and v2.1.299 extend the default
 *   negotiation to hosted connectors, cloud sessions and Remote Control without fetched flags.
 *   MCP_PROTOCOL_NEGOTIATION=legacy remains a user opt-out.
 * - v2.1.302 fixes missing tools/call failures when a 2026-07-28 server omits resultType, ttlMs or
 *   cacheScope. A tolerant client does not relax those server requirements in the specification.
 * - v2.1.292 drops a tool whose full name exceeds 128 characters. v2.1.299 narrows MCP allow rules
 *   to the named server. Neither is a reason to weaken server authorization or rename published tools.
 *
 * All wire assertions still cite their normative source; these release facts describe this one
 * client surface and never change what a conforming server owes another client.
 */

import { VENDOR } from "../harness/specifications.js";
import {
  wellKnownInsertion,
  type VendorProfile,
} from "../harness/vendor-profile.js";

/**
 * The loopback callback path Claude Code binds, and the two hosts it declares.
 *
 * RFC 8252 §7.3 requires an authorization server to allow any port for a loopback redirect URI, and
 * §8.3 discourages `localhost` in favour of the IP literal — but Claude Code declares both, so both
 * must match with the port ignored.
 */
export const CLAUDE_CODE_LOOPBACK_HOSTS = ["localhost", "127.0.0.1"] as const;

/** A plausible ephemeral port for one CLI session; the value is meant to be arbitrary. */
export const CLAUDE_CODE_SESSION_PORT = 51837;

/** The redirect URI a running Claude Code session actually sends. */
export function claudeCodeRedirectUri(
  host: (typeof CLAUDE_CODE_LOOPBACK_HOSTS)[number] = "localhost",
  port: number = CLAUDE_CODE_SESSION_PORT,
): string {
  return `http://${host}:${port}/callback`;
}

/** Where the harness publishes Claude Code's metadata document. */
const CLIENT_METADATA_PATH = "/claude-code/oauth/claude-code-client-metadata";

/**
 * Claude Code's Client ID Metadata Document as published, rehosted at the harness origin.
 *
 * Field for field from <https://claude.ai/oauth/claude-code-client-metadata>, retrieved 2026-08-14.
 * `client_id` necessarily names the harness URL instead — in CIMD the identifier IS the URL the
 * document is served from, and a server is required to check the document is self-referential.
 *
 * Note what the `redirect_uris` are: **portless**. That is the published document, not a
 * simplification; the port is supplied per session and matched per RFC 8252 §7.3.
 */
export function claudeCodeClientMetadata(
  clientIdUrl: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    client_id: clientIdUrl,
    client_name: "Claude Code",
    client_uri: "https://claude.ai",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

/**
 * Claude Code's profile.
 *
 * @param clientMetadataUrl - Where the harness serves the metadata document.
 * @param options - The pinned scopes a security team may have configured, and the session's
 *   loopback host and port.
 * @returns The profile.
 */
export function claudeCodeProfile(
  clientMetadataUrl: string,
  options: {
    /** `oauth.scopes` from `.mcp.json`, which pins the request and wins over everything discovered. */
    readonly pinnedScopes?: string;
    readonly loopbackHost?: (typeof CLAUDE_CODE_LOOPBACK_HOSTS)[number];
    readonly loopbackPort?: number;
  } = {},
): VendorProfile {
  return {
    id: "claude-code",
    displayName: "Claude Code (CLI / IDE)",
    documentation: VENDOR.ANTHROPIC_AUTH,
    verifiedAgainst:
      "Claude Code MCP reference and the live Claude Code CIMD, read 2026-08-14 and re-read " +
      "2026-08-29 for the 2026-07-28 revision; CHANGELOG through v2.1.303, re-read 2026-10-19 — " +
      "no OAuth field moved in either pass. The 2026-10-19 pass read the changelog only: the " +
      "reference page and the CIMD keep their earlier dates because neither was reopened",

    // CIMD since v2.1.81 (SEP-991), discovered automatically. Claude Code never uses
    // Anthropic-held client credentials; `--client-id` pre-registration and DCR are its alternates.
    registration: "client_id_metadata_document",

    redirectUri: claudeCodeRedirectUri(
      options.loopbackHost ?? "localhost",
      options.loopbackPort ?? CLAUDE_CODE_SESSION_PORT,
    ),
    clientMetadata: claudeCodeClientMetadata(clientMetadataUrl),
    clientMetadataPath: CLIENT_METADATA_PATH,

    // A public client on PKCE. (`client_secret_post` appears only on the pre-registered
    // `--client-secret` path, from v2.1.119.)
    tokenEndpointAuthMethod: "none",

    sendsResourceParameter: true,
    sendsStateParameter: true,

    // Appended to the pinned scopes when the authorization server advertises it — same source
    // document as the hosted surfaces.
    appendsOfflineAccessFromAuthorizationServerMetadata: true,

    /**
     * Claude Code's ladder, in its documented precedence:
     *
     * 1. `oauth.scopes` in `.mcp.json`, which **takes precedence over everything discovered** and is
     *    the supported way for a security team to hold a server to an approved subset;
     * 2. otherwise the `WWW-Authenticate` challenge's `scope`;
     * 3. otherwise the protected-resource metadata's `scopes_supported`;
     * 4. otherwise **no `scope` parameter at all** — deliberate since v2.1.196, replacing the older
     *    behaviour of requesting the authorization server's whole catalogue.
     *
     * `offline_access` is appended from the authorization-server metadata in every case.
     */
    selectScope(inputs) {
      const base = options.pinnedScopes
        ? options.pinnedScopes.split(" ").filter(Boolean)
        : inputs.challengeScope
          ? inputs.challengeScope.split(" ").filter(Boolean)
          : [...inputs.protectedResourceScopes];
      if (
        inputs.authorizationServerScopes.includes("offline_access") &&
        !base.includes("offline_access")
      ) {
        base.push("offline_access");
      }
      // Rung 4: nothing was pinned, challenged, or published, so no `scope` parameter is sent.
      return base.length > 0 ? base.join(" ") : undefined;
    },

    /** Same two documents as the hosted surfaces; Claude Code caches them locally since v2.1.49. */
    authorizationServerProbeOrder(issuer) {
      return [
        wellKnownInsertion(issuer, "oauth-authorization-server"),
        wellKnownInsertion(issuer, "openid-configuration"),
      ];
    },

    protectedResourceProbeOrder(mcpServerUrl) {
      const parsed = new URL(mcpServerUrl);
      return [
        wellKnownInsertion(mcpServerUrl, "oauth-protected-resource"),
        `${parsed.origin}/.well-known/oauth-protected-resource`,
      ];
    },
  };
}
