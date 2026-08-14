/**
 * Vendor conformance: Claude Code (CLI / IDE).
 *
 * Profile: `profiles/claude-code.ts`. See that file for why this surface cannot be folded into
 * `claude-desktop.test.ts`.
 *
 * **This suite covers what is different about a NATIVE client.** The protocol spine is exercised in
 * full by the hosted-surface suite. What is asserted here is the set of behaviours where a server
 * that works perfectly in a browser is unreachable from the CLI:
 *
 * - a loopback redirect URI on a port that changes every session;
 * - a scope ladder whose last rung is sending no `scope` parameter at all;
 * - a step-up that never unions the challenge's scope, which makes the FIRST authorization the only
 *   one that matters.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deploymentMcpUrl,
  edgeTargetFor,
  readRunningDeployment,
  type RunningDeployment,
} from "../../harness/deployment.js";
import type { AccountHolder, McpTestTarget } from "../../target.js";
import { connectDocumentHost, type DocumentPublisher } from "../../harness/document-host.js";
import type { EdgeTarget } from "../../harness/edge-transport.js";
import {
  assertDeploymentIsServing,
  completeAuthorization,
  discoverDeployment,
  openOAuthSession,
  publishClientMetadata,
  runAuthorizationLeg,
  selectedScope,
  type DiscoveredDeployment,
} from "../../harness/flow.js";
import {
  callToolMessage,
  listToolsMessage,
  mcpRequest,
  parseBearerChallenge,
} from "../../harness/mcp-client.js";
import {
  buildAuthorizationRequest,
  fetchDocument,
  type OAuthSession,
} from "../../harness/oauth-client.js";
import { IETF, MCP, VENDOR, cite } from "../../harness/specifications.js";
import {
  CLAUDE_CODE_LOOPBACK_HOSTS,
  claudeCodeProfile,
  claudeCodeRedirectUri,
} from "../../profiles/claude-code.js";
import type { VendorProfile } from "../../harness/vendor-profile.js";

const SUITE_ID = "claude-code";

/**
 * Register this surface's conformance suite against one target.
 *
 * Skipped unless the target declares the authorization capability, because every assertion
 * below drives an authorization-code flow.
 *
 * @param mcpTarget - The MCP server under test.
 */
export function defineClaudeCodeSuite(mcpTarget: McpTestTarget): void {
describe.skipIf(!mcpTarget.authorization)("Claude Code connector conformance", () => {
  let deployment: RunningDeployment;
  let target: EdgeTarget;
  let documents: DocumentPublisher;
  let profile: VendorProfile;
  let holder: AccountHolder;
  let serverUrl: string;
  let discovered: DiscoveredDeployment;
  let session: OAuthSession;

  // `describe.skipIf` prevents the tests from RUNNING, but the callback body still executes at

  // COLLECTION time — so a target without the capability must not dereference it here. The

  // placeholder is never read: every test inside is skipped.

  const authorization =

    mcpTarget.authorization ?? ({} as NonNullable<McpTestTarget["authorization"]>);

  beforeAll(async () => {
    deployment = readRunningDeployment(mcpTarget.id);
    target = edgeTargetFor(deployment);
    documents = connectDocumentHost(
      deployment.documentOrigin!,
      deployment.documentControlOrigin!,
    );
    serverUrl = deploymentMcpUrl(deployment);
    holder = await authorization.createAccountHolder(SUITE_ID);

    await assertDeploymentIsServing(target, serverUrl);

    profile = claudeCodeProfile(
      documents.url("/claude-code/oauth/claude-code-client-metadata"),
    );
    const clientId = await publishClientMetadata(documents, profile);
    discovered = await discoverDeployment(target, profile, serverUrl);
    session = openOAuthSession(discovered, profile, clientId);
  }, 120_000);

  afterAll(async () => {
    await authorization.clearAccountHolders(SUITE_ID);
  });

  describe("the loopback redirect", () => {
    it.each(CLAUDE_CODE_LOOPBACK_HOSTS)(
      "authorizes a session bound to an ephemeral port on %s",
      async (host) => {
        // The client's published document registers `http://%s/callback` with NO port; the running
        // session sends whatever port it bound. This is the entire native-client contract.
        const sessionProfile: VendorProfile = {
          ...profile,
          redirectUri: claudeCodeRedirectUri(host, 51837),
        };
        const pending = await buildAuthorizationRequest(discovered.as, sessionProfile, {
          clientId: session.client.client_id,
          scope: selectedScope(profile, discovered),
          resource: String(discovered.protectedResource.resource),
        });
        const leg = await runAuthorizationLeg({
          target,
          authorizationUrl: pending.url,
          sessionCookieName: holder.sessionCookieName,
          sessionCookieValue: holder.sessionCookieValue,
          consentFormId: authorization.consentFormId,
        });

        expect(
          leg.callbackUrl,
          cite(
            IETF.NATIVE_LOOPBACK_PORT_AGNOSTIC,
            "For a loopback redirect URI the authorization server MUST allow any port to be " +
              "specified at the time of the request, because a native client binds an ephemeral " +
              "port it cannot know in advance. Claude Code declares both `localhost` and " +
              "`127.0.0.1` portless in its metadata document and sends a fresh port every session, " +
              "so a server matching the string exactly can never authorize the CLI at all.",
          ),
        ).toContain("code=");
      },
    );

    it("authorizes a second session on a different port without re-registration", async () => {
      // The port changes per session. If the first port were somehow learned and pinned, the next
      // session would break — which is what "the port varies per session" means in practice.
      const sessionProfile: VendorProfile = {
        ...profile,
        redirectUri: claudeCodeRedirectUri("localhost", 60123),
      };
      const pending = await buildAuthorizationRequest(discovered.as, sessionProfile, {
        clientId: session.client.client_id,
        scope: selectedScope(profile, discovered),
        resource: String(discovered.protectedResource.resource),
      });
      const leg = await runAuthorizationLeg({
        target,
        authorizationUrl: pending.url,
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });

      expect(
        leg.callbackUrl,
        cite(
          IETF.NATIVE_LOOPBACK_PORT_AGNOSTIC,
          "Port-agnostic matching is per request, not a value learned once.",
        ),
      ).toContain("code=");
    });

    it("still refuses a redirect that is not the registered loopback callback", async () => {
      // Port-agnostic must not become host-agnostic or path-agnostic: everything except the port is
      // still matched exactly, or the loopback allowance becomes an open redirector.
      const sessionProfile: VendorProfile = {
        ...profile,
        redirectUri: "http://localhost:51837/stolen",
      };
      const pending = await buildAuthorizationRequest(discovered.as, sessionProfile, {
        clientId: session.client.client_id,
        scope: selectedScope(profile, discovered),
        resource: String(discovered.protectedResource.resource),
      });
      const response = await fetchDocument(target, pending.url);

      expect(
        response.status < 300 || response.status >= 400
          ? "refused"
          : (response.headers.get("location") ?? ""),
        cite(
          IETF.NATIVE_LOOPBACK_PORT_AGNOSTIC,
          "Only the port component is exempt from exact matching. A different path or host is a " +
            "different redirect URI and must be refused — and refused at the authorization " +
            "endpoint rather than by redirecting the error to the unverified target.",
        ),
      ).not.toContain("code=");
    });
  });

  describe("scope selection", () => {
    it("authorizes with the scopes a security team pinned in configuration", async () => {
      // `oauth.scopes` in `.mcp.json` takes precedence over the challenge, the protected-resource
      // metadata, and anything else discovered. A server must honour a narrower request than it
      // advertises rather than insisting on its own set.
      const leastPrivilege = (
        discovered.protectedResource.scopes_supported as string[]
      )[0];
      const pinned = claudeCodeProfile(
        documents.url("/claude-code/oauth/claude-code-client-metadata"),
        { pinnedScopes: leastPrivilege },
      );
      const completed = await completeAuthorization({
        target,
        profile: pinned,
        discovered,
        session,
        resource: String(discovered.protectedResource.resource),
        scope: selectedScope(pinned, discovered),
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });

      expect(
        completed.tokens.access_token,
        cite(
          VENDOR.ANTHROPIC_AUTH,
          "`oauth.scopes` pins the requested scopes and takes precedence over everything " +
            "discovered; it is the supported way for a security team to hold an MCP server to an " +
            "approved subset.",
        ),
      ).toBeTypeOf("string");
    });

    it("authorizes when the client sends no scope parameter at all", async () => {
      const pending = await buildAuthorizationRequest(discovered.as, profile, {
        clientId: session.client.client_id,
        scope: undefined,
        resource: String(discovered.protectedResource.resource),
      });
      const leg = await runAuthorizationLeg({
        target,
        authorizationUrl: pending.url,
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });

      expect(
        leg.callbackUrl,
        cite(
          IETF.OAUTH2_SCOPE_OPTIONAL,
          "Since v2.1.196 Claude Code deliberately sends no `scope` parameter when the server " +
            "publishes no scope guidance, having stopped requesting the authorization server's " +
            "full catalogue. `scope` is OPTIONAL, so the server defaults to least privilege rather " +
            "than refusing a conformant client.",
        ),
      ).toContain("code=");
    });
  });

  describe("what the first authorization has to carry", () => {
    it("makes every scope its tools require reachable without a step-up", async () => {
      // 🔴 The load-bearing assertion for this surface. Claude Code's documented step-up
      // "re-authenticates with the same pinned scopes" — it does NOT union the scope named in a
      // `403 insufficient_scope`. So any permission that exists only in a challenge is unreachable
      // from the CLI: the flow runs, the user consents, and the same insufficient token comes back.
      //
      // The server-side obligation that follows is checkable: everything the tools need must be
      // discoverable BEFORE the first authorization — from the `401` challenge's `scope` or the
      // protected-resource metadata — never from a `403` alone.
      const advertised = new Set<string>([
        ...((discovered.protectedResource.scopes_supported as string[]) ?? []),
        ...(discovered.challenge?.parameters.get("scope")?.split(" ").filter(Boolean) ?? []),
      ]);

      const completed = await completeAuthorization({
        target,
        profile,
        discovered,
        session,
        resource: String(discovered.protectedResource.resource),
        scope: selectedScope(profile, discovered),
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });
      const listed = await mcpRequest(target, serverUrl, listToolsMessage(), {
        accessToken: completed.tokens.access_token,
      });
      const tools = (listed.messages[0]?.result?.tools ?? []) as { name: string }[];
      expect(tools.length).toBeGreaterThan(0);

      // Probe every tool and collect any scope a refusal names. Anything that appears here but not
      // in the pre-authorization set is unreachable from this client, permanently.
      const challengedScopes = new Set<string>();
      for (const tool of tools) {
        const attempt = await mcpRequest(
          target,
          serverUrl,
          callToolMessage(tool.name),
          { accessToken: completed.tokens.access_token },
        );
        if (attempt.http.status !== 403) continue;
        const challenge = parseBearerChallenge(
          attempt.http.headers.get("www-authenticate"),
        );
        for (const scope of challenge?.parameters.get("scope")?.split(" ") ?? []) {
          if (scope) challengedScopes.add(scope);
        }
      }

      const unreachable = [...challengedScopes].filter(
        (scope) => !advertised.has(scope),
      );
      expect(
        unreachable,
        cite(
          VENDOR.ANTHROPIC_AUTH,
          "Claude Code re-authorizes with its existing pinned scopes and does not union the scope " +
            "named in a `403 insufficient_scope`, so a scope reachable only through a challenge is " +
            "never granted to this client. Every scope the tools need must therefore appear in the " +
            "`401` challenge or the protected-resource metadata, where the FIRST authorization can " +
            "ask for it.",
        ),
      ).toEqual([]);
    }, 60_000);
  });

  describe("the credential lifecycle a long-lived CLI session depends on", () => {
    it("issues a refresh token so the CLI can reconnect without a browser", async () => {
      const completed = await completeAuthorization({
        target,
        profile,
        discovered,
        session,
        resource: String(discovered.protectedResource.resource),
        scope: selectedScope(profile, discovered),
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });

      expect(
        completed.tokens.refresh_token,
        cite(
          VENDOR.ANTHROPIC_AUTH,
          "On a `401` for a signed-in server Claude Code refreshes, reconnects, and retries the " +
            "request once. With no refresh token that path degrades to a browser round trip on " +
            "every expiry — on a machine where the user may have no browser at all.",
        ),
      ).toBeTypeOf("string");
    });

    it("states a token lifetime so the CLI does not re-authenticate on a guess", async () => {
      const completed = await completeAuthorization({
        target,
        profile,
        discovered,
        session,
        resource: String(discovered.protectedResource.resource),
        scope: selectedScope(profile, discovered),
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });

      expect(
        completed.tokens.expires_in,
        cite(
          IETF.OAUTH2_TOKEN_RESPONSE,
          "Anthropic records that servers omitting `expires_in` forced Claude Code to " +
            "re-authenticate every hour before v2.1.118.",
        ),
      ).toBeTypeOf("number");
    });
  });

  describe("what this surface does not use", () => {
    it("does not need an enterprise assertion grant to be advertised", () => {
      // Claude Code's metadata document omits `urn:ietf:params:oauth:grant-type:jwt-bearer`, so
      // Enterprise Managed Auth is not offered here. Asserting the client's shape keeps the profile
      // honest against a future edit that copies the hosted document by mistake.
      expect(
        profile.clientMetadata.grant_types,
        cite(
          VENDOR.ANTHROPIC_CIMD,
          "The Claude Code document declares only the authorization-code and refresh-token grants; " +
            "the `jwt-bearer` grant appears in the HOSTED document alone.",
        ),
      ).toEqual(["authorization_code", "refresh_token"]);
    });

    it("reaches the same authorization server the hosted surfaces do", () => {
      expect(
        discovered.as.issuer,
        cite(
          MCP.CLIENT_REGISTRATION,
          "One deployment, one issuer: a native client and a hosted client discover the same " +
            "authorization server and differ only in how they identify themselves to it.",
        ),
      ).toBe((discovered.protectedResource.authorization_servers as string[])[0]);
    });
  });
});
}
