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
 *
 * **Re-read 2026-08-29 against the `2026-07-28` revision. No OAuth field moved**, and three
 * behaviours were recorded that change what a server owes this client:
 *
 * - Its v2 runtime is on MCP TypeScript SDK 2.0 and **asks HTTP and claude.ai connector servers
 *   whether they support revision `2026-07-28`, using it with those that do** — so `server/discover`
 *   is traffic this surface actually sends. The protocol family asserts that.
 * - It **fails a sign-in outright when the authorization response names an unexpected issuer**, the
 *   RFC 9207 validation the revision requires of clients. It presents as a broken consent screen
 *   rather than as an issuer error, which is why this suite asserts `iss` explicitly.
 * - It **refreshes on `list_changed`** for tools, prompts and resources over a stream it holds open,
 *   under hard reopen limits: a stream that keeps closing within ten seconds is reopened three times
 *   and then abandoned. That is a deployment property (proxy idle timeouts), not an OAuth one, so it
 *   is recorded here rather than asserted.
 *
 * **Re-read 2026-09-22 against the published `CHANGELOG.md` through v2.1.278. No OAuth field
 * moved**, and one statement above is corrected while five behaviours are added.
 *
 * **🔴 The correction: the `2026-07-28` probe no longer has an install carve-out, and this profile
 * never recorded that it had one.** The bullet above describes the probe as reaching HTTP and
 * claude.ai connector servers, without saying that Bedrock, Vertex, Foundry and telemetry-disabled
 * installs were excluded from it. Claude Code v2.1.278 changed those installs to use the v2 MCP
 * client and `2026-07-28` negotiation with direct HTTP servers by default, as other installs
 * already did — so the bullet is now true of every install rather than of most of them, and the
 * omission has stopped being wrong instead of having been right. The opt-outs are a user's, not a
 * server's: `MCP_SDK_GENERATION=v1` or `MCP_PROTOCOL_NEGOTIATION=legacy` stops the probe entirely.
 * A server that sees no `server/discover` from a modern client is looking at one of those two
 * variables, or at a build below the v2.1.232 runtime floor.
 *
 * **🔴 A `403 insufficient_scope` is diagnosed correctly now — and that is the whole of the
 * change.** Until v2.1.278 a correct `403 insufficient_scope` was reported to the user as an
 * expired sign-in, so a server doing exactly the right thing produced a support report about a
 * broken login; the error now names the missing permissions and points at `/mcp` re-authentication.
 * **Nothing about the scope behaviour moved.** Claude Code still re-authorizes with its existing
 * pinned set and still does not union the challenge's `scope`, exactly as the third bullet at the
 * top of this file says — so a scope that exists only in a `403` challenge is still never granted,
 * however clearly the error now names it. Read this as a better error message, never as step-up
 * having started to work: a server that moved a permission out of its first authorization on the
 * strength of it would break for every Claude Code user and see a clearer message about it.
 *
 * Four more behaviours, all from the same changelog:
 *
 * - **Client registrations are no longer mishandled** (v2.1.274): denying consent forced a new one,
 *   one for another redirect URI was reused, and a concurrent write could delete a valid one or keep
 *   a mismatched one. Each is visible from the server's side as a registration pattern that looks
 *   like abuse — a burst after a cancelled consent screen, a registration presented against the
 *   wrong redirect URI, a client that vanishes mid-session. Get the client version before tightening
 *   a registration rate limit on that evidence.
 * - **`list_changed` is honoured for prompts and resources even when the server never declared
 *   `listChanged`** (v2.1.278). Declare the capability anyway: it is the only form every client
 *   version acts on, and an older client still ignores the undeclared notification.
 * - **An unattended run can now leave a slow server behind on purpose** (v2.1.274):
 *   `CLAUDE_CODE_MCP_STARTUP_WAIT_MS` bounds how long the first non-interactive turn waits for
 *   connecting servers, with `0` meaning do not wait at all. The run then proceeds with these tools
 *   absent rather than failing, so a handshake that depends on an upstream call is a liability here.
 * - **A mid-session disconnect is announced** (v2.1.273), when automatic reconnection gives up. It
 *   is a notice to a human pointing at `/mcp`, so it helps an interactive user and does nothing for
 *   an unattended run.
 *
 * Two facts about Claude Code's gate rather than its OAuth are recorded in
 * `harness/specifications.ts` beside the clauses that state them, because a server cannot see or
 * fix either: the managed-configuration off-switches that were silently ignored until v2.1.273 and
 * the unparseable `managed-mcp.json` that now fails closed
 * ({@link VENDOR.ANTHROPIC_MANAGED_MCP}), and the auto-mode classifier now existing in a local and
 * a server-side implementation with a billing difference between them
 * ({@link VENDOR.ANTHROPIC_AUTO_MODE}).
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
      "2026-08-29 for the 2026-07-28 revision; CHANGELOG v2.1.49–v2.1.278, re-read 2026-09-22 — " +
      "no OAuth field moved in either pass. The 2026-09-22 pass read the changelog only: the " +
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
