/**
 * Claude Code (CLI and IDE) — a native client, not a hosted one.
 *
 * Transcribed from Anthropic's Claude Code MCP reference, its published `CHANGELOG.md`, and Claude
 * Code's live Client ID Metadata Document. Every field cites the statement it comes from.
 *
 * **Why this is a separate profile from `claude-desktop.ts`, and must stay one.** Anthropic's
 * documentation opens by warning against generalising one Claude surface to another, and lists the
 * differences as load-bearing. The hosted surfaces run OAuth on Anthropic's infrastructure with one
 * shared identity; Claude Code runs the flow **on the user's machine** and differs concretely on all
 * three of the things that decide whether a connection works at all:
 *
 * 1. **The redirect URI is an RFC 8252 loopback on an EPHEMERAL PORT.** Its metadata document
 *    registers `http://localhost/callback` and `http://127.0.0.1/callback` with no port, and the
 *    actual request carries whatever port the CLI bound this session. A server that matches redirect
 *    URIs by exact string can never authorize this client — which is the single most common way a
 *    connector that works in the browser is unreachable from the CLI.
 * 2. **The scope ladder ends in sending no `scope` parameter at all.** Since v2.1.196 Claude Code
 *    deliberately stopped requesting the authorization server's full `scopes_supported` catalog,
 *    because IdPs advertising admin-only or template scopes answered `invalid_scope`.
 * 3. **Step-up does not union the challenge's scope.** It re-authorizes with its existing pinned
 *    set, so a scope that exists only in a `403` challenge is never granted no matter how many times
 *    the user consents. Every scope the tools need must be reachable from the FIRST authorization.
 *
 * It also carries no `urn:ietf:params:oauth:grant-type:jwt-bearer` grant, so Enterprise Managed Auth
 * is not offered on this surface.
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
      "Claude Code MCP reference, CHANGELOG v2.1.49–v2.1.231, and the live Claude Code CIMD, read 2026-08-14",

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
