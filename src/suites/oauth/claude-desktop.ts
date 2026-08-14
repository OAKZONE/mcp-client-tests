/**
 * Vendor conformance: Claude Desktop / claude.ai hosted surfaces.
 *
 * Profile: `profiles/claude-desktop.ts` (transcribed from Anthropic's connector documentation and
 * Claude's live client metadata document). Harness: `harness/`.
 *
 * **What this suite is.** A real Claude-shaped client driving a real production build over a real
 * socket against a real Postgres, checking this deployment against what Anthropic and the RFCs
 * require. Every expectation cites the clause it comes from and the citation travels into the
 * failure message. Nothing here was chosen because this deployment already does it.
 *
 * **A failure here is a finding, not a broken test.** Before changing an assertion, read its
 * citation: if the clause says what the assertion says, the deployment is what needs to change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deploymentMcpUrl,
  edgeTargetFor,
  readRunningDeployment,
  readServerLogTail,
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
  initializeMessage,
  listToolsMessage,
  mcpRequest,
  parseBearerChallenge,
} from "../../harness/mcp-client.js";
import {
  buildAuthorizationRequest,
  exchangeAuthorizationCode,
  fetchDocument,
  postToTokenEndpoint,
  readRefreshResponse,
  refreshTokens,
  revokeToken,
  validateAuthorizationResponse,
  type OAuthSession,
} from "../../harness/oauth-client.js";
import { IETF, MCP, VENDOR, cite } from "../../harness/specifications.js";
import { claudeDesktopProfile } from "../../profiles/claude-desktop.js";
import type { VendorProfile } from "../../harness/vendor-profile.js";

/**
 * Register this surface's conformance suite against one target.
 *
 * Skipped unless the target declares the authorization capability, because every assertion
 * below drives an authorization-code flow.
 *
 * @param mcpTarget - The MCP server under test.
 */
export function defineClaudeDesktopSuite(mcpTarget: McpTestTarget): void {
describe.skipIf(!mcpTarget.authorization)(
  "Claude Desktop connector conformance",
  () => {
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
      holder = await authorization.createAccountHolder("claude-desktop");

      await assertDeploymentIsServing(target, serverUrl);

      profile = claudeDesktopProfile(
        documents.url("/claude/oauth/mcp-oauth-client-metadata"),
      );
      const clientId = await publishClientMetadata(documents, profile);
      discovered = await discoverDeployment(target, profile, serverUrl);
      session = openOAuthSession(discovered, profile, clientId);
    }, 120_000);

    afterAll(async () => {
      await authorization.clearAccountHolders("claude-desktop");
    });

    /** Complete one authorization with this client's own scope selection. */
    const authorize = (overrides: {
      readonly scope?: string | undefined;
      readonly additionalScopes?: readonly string[];
      readonly extraParameters?: Readonly<Record<string, string>>;
    } = {}) =>
      completeAuthorization({
        target,
        profile,
        discovered,
        session,
        resource: String(discovered.protectedResource.resource),
        scope:
          "scope" in overrides
            ? overrides.scope
            : selectedScope(profile, discovered),
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
        additionalScopes: overrides.additionalScopes,
        extraParameters: overrides.extraParameters,
      });

    describe("the challenge that starts a connection", () => {
      it("refuses an uncredentialed call at the HTTP layer, not inside a tool result", async () => {
        const exchange = await mcpRequest(target, serverUrl, initializeMessage());

        expect(
          exchange.http.status,
          cite(
            MCP.UNAUTHENTICATED_401,
            "An MCP request with no credential must fail the HTTP request with 401. Anthropic " +
              "states that a 200 wrapping `isError: true` produces no Connect card at all — the " +
              "error text is handed to the model as a tool result and the user is never offered " +
              "sign-in.",
          ),
        ).toBe(401);
        expect(
          exchange.messages.some((message) => message.result?.isError === true),
          cite(VENDOR.ANTHROPIC_LAZY_AUTH, "The refusal must not be a tool-level error result."),
        ).toBe(false);
      });

      it("carries a Bearer challenge naming the protected-resource metadata", async () => {
        const exchange = await mcpRequest(target, serverUrl, initializeMessage());
        const challenge = parseBearerChallenge(
          exchange.http.headers.get("www-authenticate"),
        );

        expect(
          challenge?.scheme,
          cite(IETF.BEARER_CHALLENGE, "The 401 must carry a `WWW-Authenticate: Bearer` challenge."),
        ).toBe("Bearer");
        expect(
          challenge?.parameters.get("resource_metadata"),
          cite(
            IETF.PRM_WWW_AUTHENTICATE_POINTER,
            "The challenge must point at the protected-resource metadata document with a " +
              "`resource_metadata` parameter; it is the only discovery path that works for a " +
              "deployment which cannot serve /.well-known/* at its origin root.",
          ),
        ).toMatch(/^https:\/\//);
      });

      it("points at a metadata document that is actually served", async () => {
        const pointer = discovered.challenge?.parameters.get("resource_metadata");
        expect(pointer, "the challenge carried no resource_metadata pointer").toBeDefined();
        const response = await fetchDocument(target, pointer!);

        expect(
          response.status,
          cite(
            IETF.PRM_WWW_AUTHENTICATE_POINTER,
            "The URL named by `resource_metadata` must serve the document.",
          ),
        ).toBe(200);
      });
    });

    describe("protected-resource metadata", () => {
      it("identifies the resource as the exact URL the user entered", () => {
        expect(
          discovered.protectedResource.resource,
          cite(
            IETF.PRM_FIELDS,
            "`resource` must equal the MCP server URL exactly as the user enters it in the " +
              "client, path included. Claude sends this value verbatim as the `resource` " +
              "indicator, and the token's audience is checked against it.",
          ),
        ).toBe(serverUrl);
      });

      it("lists the authorization server the client will use first", () => {
        const issuers = discovered.protectedResource.authorization_servers;
        expect(
          Array.isArray(issuers) && issuers.length > 0,
          cite(IETF.PRM_FIELDS, "`authorization_servers` must name at least one issuer."),
        ).toBe(true);
        expect(
          (issuers as string[])[0],
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "Claude uses `authorization_servers[0]` and never falls back to a later entry, so " +
              "the primary issuer must be first.",
          ),
        ).toBe(discovered.as.issuer);
      });

      it("keeps offline_access out of the resource's scope list", () => {
        const scopes = (discovered.protectedResource.scopes_supported ?? []) as string[];
        expect(
          scopes,
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "`offline_access` is a client/authorization-server concern, not a resource " +
              "permission. Advertising it in the protected-resource document is how a server ends " +
              "up never being granted it.",
          ),
        ).not.toContain("offline_access");
      });

      it("answers at every URL this client derives without being told where to look", async () => {
        for (const candidate of profile.protectedResourceProbeOrder(serverUrl)) {
          const response = await fetchDocument(target, candidate);
          expect(
            response.status,
            cite(
              IETF.PRM_PATH_INSERTION,
              `A client with only the server URL derives ${candidate}. The well-known segment is ` +
                "INSERTED before the resource path; a client that never read the challenge has no " +
                "other way to find the document.",
            ),
          ).toBe(200);
        }
      });

      it("is readable from a browser-context client", async () => {
        const pointer = discovered.protectedResourceUrl;
        const response = await fetchDocument(target, pointer);
        expect(
          response.headers.get("access-control-allow-origin"),
          cite(
            IETF.PRM_FIELDS,
            "A client fetching discovery from a browser context has its request refused by the " +
              "user agent before the response is read unless cross-origin reads are granted; the " +
              "server log shows a clean 200 while the connector fails.",
          ),
        ).toBe("*");
      });
    });

    describe("authorization-server metadata", () => {
      it("is discoverable at the URL an RFC 8414 client derives from a path-bearing issuer", async () => {
        const [primary] = profile.authorizationServerProbeOrder(discovered.as.issuer);
        const response = await fetchDocument(target, primary);

        expect(
          response.status,
          cite(
            IETF.AS_METADATA_PATH_INSERTION,
            `For an issuer carrying a path the well-known segment is inserted, giving ${primary}. ` +
              "Publishing only the append form leaves a document that looks healthy and that no " +
              "client ever requests.",
          ),
        ).toBe(200);
      });

      it("returns the issuer it was asked about", () => {
        // Reaching this point at all is the evidence: `processDiscoveryResponse` refuses a document
        // whose `issuer` differs from the identifier the client asked for.
        expect(
          discovered.as.issuer,
          cite(
            IETF.AS_METADATA_ISSUER_MATCH,
            "The `issuer` in the document must equal the issuer the client discovered.",
          ),
        ).toBe((discovered.protectedResource.authorization_servers as string[])[0]);
      });

      it("advertises S256 so a client can verify PKCE support before starting", () => {
        expect(
          discovered.as.code_challenge_methods_supported,
          cite(
            MCP.PKCE_REQUIRED,
            "Clients verify PKCE support from metadata before starting a flow; absence reads as " +
              "'no PKCE' and a conformant client must refuse to proceed.",
          ),
        ).toContain("S256");
      });

      it("satisfies both conditions Claude requires before it will elect CIMD", () => {
        expect(
          discovered.as.client_id_metadata_document_supported,
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "Claude elects a client-ID metadata document only when the metadata advertises " +
              "`client_id_metadata_document_supported: true` AND `\"none\"` among the " +
              "token-endpoint auth methods. Missing either sends it looking for a " +
              "`registration_endpoint` instead.",
          ),
        ).toBe(true);
        expect(
          discovered.as.token_endpoint_auth_methods_supported,
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "Claude's CIMD client authenticates as a public client, so the token endpoint must " +
              "accept PKCE-only requests with no client secret.",
          ),
        ).toContain("none");
      });

      it("advertises offline_access, which is where Claude reads it from", () => {
        expect(
          discovered.as.scopes_supported,
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "Claude appends `offline_access` only when the AUTHORIZATION SERVER metadata lists " +
              "it. A server that advertises it only in the protected-resource document is never " +
              "granted it, so it never issues a refresh token, so its users re-authenticate " +
              "constantly.",
          ),
        ).toContain("offline_access");
      });

      it("offers a registration path to a client that cannot use CIMD", () => {
        expect(
          discovered.as.registration_endpoint,
          cite(
            MCP.CLIENT_REGISTRATION,
            "The registration ladder is pre-registration, then CIMD, then dynamic registration. A " +
              "client that elects neither of the first two needs the third.",
          ),
        ).toBeTypeOf("string");
      });

      it("answers at least one of the two documents Claude tries", async () => {
        const statuses: number[] = [];
        for (const candidate of profile.authorizationServerProbeOrder(discovered.as.issuer)) {
          statuses.push((await fetchDocument(target, candidate)).status);
        }
        expect(
          statuses.some((status) => status === 200),
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "Claude tries RFC 8414 then OpenID Connect Discovery; only one needs to answer, but " +
              "closing both takes every connector down with an empty server log, because both " +
              "404s are admission returns rather than faults.",
          ),
        ).toBe(true);
      });
    });

    describe("the authorization request", () => {
      it("accepts the scope this client selects from what the deployment published", async () => {
        const scope = selectedScope(profile, discovered);
        const pending = await buildAuthorizationRequest(discovered.as, profile, {
          clientId: session.client.client_id,
          scope,
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
            VENDOR.ANTHROPIC_AUTH,
            "The scope Claude sends is derived from what this deployment published — the " +
              "challenge's `scope`, else the resource's `scopes_supported`, plus `offline_access` " +
              "from the authorization-server metadata. Refusing it refuses the client's own " +
              "documented selection.",
          ),
        ).toContain("code=");
      });

      it("accepts a request that omits the optional scope parameter", async () => {
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
            "`scope` is OPTIONAL. A server must process the request with a default rather than " +
              "refuse it; at least one shipping MCP client deliberately sends no `scope` at all " +
              "when the server publishes no scope guidance.",
          ),
        ).toContain("code=");
      });

      it("accepts a request that omits the optional state parameter", async () => {
        const stateless: VendorProfile = { ...profile, sendsStateParameter: false };
        const pending = await buildAuthorizationRequest(discovered.as, stateless, {
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
            IETF.OAUTH2_STATE_RECOMMENDED,
            "`state` is RECOMMENDED, not REQUIRED. PKCE-S256 is the mandated protection here, and " +
              "this deployment additionally advertises the RFC 9207 `iss` parameter — so a " +
              "conformant client that omits `state` must still be able to authorize.",
          ),
        ).toContain("code=");
      });

      it("refuses a scope outside the published vocabulary in the protocol, not at a login page", async () => {
        const pending = await buildAuthorizationRequest(discovered.as, profile, {
          clientId: session.client.client_id,
          scope: "definitely-not-a-published-scope",
          resource: String(discovered.protectedResource.resource),
        });
        const response = await fetchDocument(target, pending.url);
        const location = response.headers.get("location") ?? "";

        expect(
          `${response.status} ${location}`,
          cite(
            IETF.OAUTH2_TOKEN_ERROR,
            "The authorization endpoint is the last point at which a bad request can be answered " +
              "in the protocol. Past it, an opaque login page hides every cause behind one symptom.",
          ),
        ).toMatch(/error=invalid_scope/);
      });
    });

    describe("consent", () => {
      it("presents each requested permission with the consequence of granting it", async () => {
        const scope = selectedScope(profile, discovered);
        const pending = await buildAuthorizationRequest(discovered.as, profile, {
          clientId: session.client.client_id,
          scope,
          resource: String(discovered.protectedResource.resource),
        });
        const leg = await runAuthorizationLeg({
          target,
          authorizationUrl: pending.url,
          sessionCookieName: holder.sessionCookieName,
          sessionCookieValue: holder.sessionCookieValue,
          consentFormId: authorization.consentFormId,
        });

        const requested = (scope ?? "").split(" ").filter(Boolean);
        const offered = leg.offeredScopes.map((entry) => entry.value);
        for (const value of requested.filter((entry) => entry !== "offline_access")) {
          expect(
            offered,
            cite(
              VENDOR.ANTHROPIC_LAZY_AUTH,
              "Every scope the client requested must appear on the consent screen; the screen is " +
                "the whole of what the holder agrees to.",
            ),
          ).toContain(value);
        }
      });

      it("returns the client to its redirect URI with an authorization code on approval", async () => {
        const completed = await authorize();
        expect(
          completed.tokens.access_token,
          cite(
            IETF.OAUTH2_TOKEN_RESPONSE,
            "An approved authorization must produce a usable access token.",
          ),
        ).toBeTypeOf("string");
      });

      it("returns access_denied to the client's redirect URI on refusal", async () => {
        const pending = await buildAuthorizationRequest(discovered.as, profile, {
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
          decision: "deny",
        });

        expect(
          leg.callbackUrl,
          cite(
            IETF.OAUTH2_TOKEN_ERROR,
            "A refused authorization is reported to the client at its redirect URI as " +
              "`access_denied`, not left as a dead end in the browser.",
          ),
        ).toContain("error=access_denied");
      });

      it("states the granted scope whenever it differs from what the client requested", async () => {
        // The holder is offered the whole vocabulary and ticks everything on offer, which is the
        // documented purpose of the screen. Whatever the server decides to grant, RFC 6749 §3.3
        // requires the token response to SAY so when it differs from the request.
        const requested = selectedScope(profile, discovered);
        const everything = (discovered.as.scopes_supported ?? []).filter(
          (value) => !(requested ?? "").split(" ").includes(value),
        );
        const completed = await authorize({ additionalScopes: everything });

        const requestedSet = new Set((requested ?? "").split(" ").filter(Boolean));
        const grantedSet = new Set(
          (completed.tokens.scope ?? requested ?? "").split(" ").filter(Boolean),
        );
        const differs =
          grantedSet.size !== requestedSet.size ||
          [...grantedSet].some((value) => !requestedSet.has(value));

        expect(
          differs ? completed.tokens.scope : "not-applicable",
          cite(
            IETF.OAUTH2_TOKEN_RESPONSE,
            "If the issued access-token scope differs from the scope the client requested, the " +
              "authorization server MUST include the `scope` response parameter to tell the " +
              "client what was actually granted. A credential that silently covers more, or less, " +
              "than the client believes is the source of both over-broad access and " +
              "unexplained 403s.",
          ),
        ).toBeDefined();
      });
    });

    describe("token exchange", () => {
      it("accepts the form-encoded body the specification mandates", async () => {
        const completed = await authorize();
        expect(
          completed.tokens.token_type?.toLowerCase(),
          cite(
            IETF.OAUTH2_TOKEN_FORM_ENCODED,
            "The token endpoint takes `application/x-www-form-urlencoded`. Reaching a parsed " +
              "token response proves it: the client library sends nothing else.",
          ),
        ).toBe("bearer");
      });

      it("refuses a JSON body at the token endpoint rather than mis-parsing it", async () => {
        const response = await postToTokenEndpoint(
          target,
          discovered.as,
          JSON.stringify({ grant_type: "refresh_token", refresh_token: "irrelevant" }),
          "application/json",
        );
        expect(
          response.status,
          cite(
            IETF.OAUTH2_TOKEN_FORM_ENCODED,
            "The token endpoint's media type is form encoding. A JSON body is a malformed request " +
              "and must be refused with a client error, never accepted.",
          ),
        ).toBeGreaterThanOrEqual(400);
      });

      it("returns expires_in so the client does not guess the lifetime", async () => {
        const completed = await authorize();
        expect(
          completed.tokens.expires_in,
          cite(
            IETF.OAUTH2_TOKEN_RESPONSE,
            "`expires_in` is RECOMMENDED, and Anthropic records that servers omitting it forced " +
              "Claude Code to re-authenticate every hour.",
          ),
        ).toBeTypeOf("number");
      });

      it("issues a refresh token when offline_access was granted", async () => {
        const scope = selectedScope(profile, discovered);
        expect(
          scope,
          "this client's scope selection did not include offline_access; the ladder is the subject " +
            "of its own test above",
        ).toContain("offline_access");
        const completed = await authorize();

        // Self-diagnosing: when no refresh token comes back, the same authorization is repeated
        // with the OpenID Connect `prompt=consent` parameter added. OIDC Core §11 tells an
        // authorization server to ignore `offline_access` unless `prompt` contains `consent`, and
        // `oidc-provider` implements that literally (`actions/authorization/check_scope.js`) — by
        // SILENTLY REMOVING the scope, with no protocol error anywhere. No MCP client sends
        // `prompt`, so if the probe succeeds where the vendor's own request failed, the cause is
        // that rule and the fix belongs on the server. Naming it here saves the next reader the
        // half-day of tracing a scope that simply vanishes.
        let diagnosis = "";
        if (!completed.tokens.refresh_token) {
          const probe = await authorize({ extraParameters: { prompt: "consent" } });
          diagnosis = typeof probe.tokens.refresh_token === "string"
            ? "\n  DIAGNOSIS: the identical request WITH `prompt=consent` did receive a refresh " +
              "token, so `offline_access` is being dropped by the OIDC prompt rule. No MCP client " +
              "sends `prompt`, so the server must stop depending on it."
            : "\n  DIAGNOSIS: adding `prompt=consent` did not help either; the scope is being lost " +
              "elsewhere (check the granted scope on the token response and the stored grant).";
        }

        expect(
          completed.tokens.refresh_token,
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "`offline_access` is what a client asks for to obtain a refresh token; granting the " +
              "scope and issuing no refresh token leaves the client re-authorizing forever — the " +
              "exact symptom Anthropic's documentation calls the highest-value line for anyone " +
              "debugging constant re-authentication." +
              diagnosis,
          ),
        ).toBeTypeOf("string");
      }, 60_000);

      it("refuses to spend an authorization code twice", async () => {
        const completed = await authorize();
        const replay = await exchangeAuthorizationCode(
          target,
          session,
          completed.callbackParameters,
          completed.pending.codeVerifier,
          { resource: String(discovered.protectedResource.resource) },
        );
        const body = (await replay.json()) as { error?: string };

        expect(
          { status: replay.status, error: body.error },
          cite(
            IETF.OAUTH2_CODE_SINGLE_USE,
            "An authorization code is single-use. A replay must be refused as `invalid_grant`.",
          ),
        ).toEqual({ status: 400, error: "invalid_grant" });
      });

      it("refuses a code presented with the wrong PKCE verifier", async () => {
        const pending = await buildAuthorizationRequest(discovered.as, profile, {
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
        const parameters = validateAuthorizationResponse(
          session,
          leg.callbackUrl,
          pending.state,
        );
        const wrongVerifier = await exchangeAuthorizationCode(
          target,
          session,
          parameters,
          // A syntactically valid verifier that does not hash to the challenge that was sent.
          "0123456789012345678901234567890123456789012345678901234567890123",
          { resource: String(discovered.protectedResource.resource) },
        );

        expect(
          wrongVerifier.status,
          cite(
            IETF.PKCE,
            "The server must verify the code verifier against the challenge that accompanied the " +
              "authorization request, and refuse the exchange when they do not match. Without " +
              "this check PKCE protects nothing.",
          ),
        ).toBe(400);
      });

      it("refuses a token request naming a resource it does not host", async () => {
        const pending = await buildAuthorizationRequest(discovered.as, profile, {
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
        const parameters = validateAuthorizationResponse(
          session,
          leg.callbackUrl,
          pending.state,
        );
        const response = await exchangeAuthorizationCode(
          target,
          session,
          parameters,
          pending.codeVerifier,
          { resource: "https://someone-elses-resource.example/mcp" },
        );
        const body = (await response.json()) as { error?: string };

        expect(
          body.error,
          cite(
            IETF.RESOURCE_INVALID_TARGET,
            "A `resource` the authorization server will not issue a token for is `invalid_target`.",
          ),
        ).toBe("invalid_target");
      });
    });

    describe("using the credential", () => {
      it("admits an authorized client to the MCP endpoint", async () => {
        const completed = await authorize();
        const exchange = await mcpRequest(
          target,
          serverUrl,
          initializeMessage(),
          { accessToken: completed.tokens.access_token },
        );

        expect(
          exchange.http.status,
          cite(
            MCP.UNAUTHENTICATED_401,
            "A token issued by this authority for this resource must be accepted at it.",
          ),
        ).toBe(200);
      });

      it("publishes its tools to an authorized client", async () => {
        const completed = await authorize();
        const exchange = await mcpRequest(target, serverUrl, listToolsMessage(), {
          accessToken: completed.tokens.access_token,
        });
        const tools = exchange.messages[0]?.result?.tools;

        expect(
          Array.isArray(tools) && tools.length > 0,
          cite(MCP.TOOLS, "`tools/list` must publish the tools the credential can reach."),
        ).toBe(true);
      });

      it("refuses a credential presented in the URI query string", async () => {
        const completed = await authorize();
        const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
          queryAccessToken: completed.tokens.access_token,
        });

        expect(
          exchange.http.status,
          cite(
            IETF.BEARER_NO_QUERY_TOKEN,
            "Access tokens must not be accepted in the URI query string: they leak into logs, " +
              "referrers, and browser history. The MCP authorization specification restates the " +
              "prohibition.",
          ),
        ).toBe(401);
      });

      it("refuses a credential minted for a different audience", async () => {
        const completed = await authorize();
        // A syntactically well-formed bearer that this authority never issued.
        const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
          accessToken: `${completed.tokens.access_token}-tampered`,
        });

        expect(
          exchange.http.status,
          cite(
            MCP.AUDIENCE_VALIDATION,
            "Every request revalidates the credential; a token this authority did not issue for " +
              "this resource must be refused with 401.",
          ),
        ).toBe(401);
      });

      it("names the missing permission when a credential is too narrow", async () => {
        // Authorize with the least privilege the deployment will accept, then find an operation the
        // credential does not cover. What matters is the SHAPE of the refusal: a 403 that does not
        // carry `error="insufficient_scope"` is terminal to every covered client, so a recoverable
        // situation is reported as a permanent failure.
        const minimal = (discovered.protectedResource.scopes_supported as string[])[0];
        const completed = await authorize({ scope: minimal });
        const listed = await mcpRequest(target, serverUrl, listToolsMessage(), {
          accessToken: completed.tokens.access_token,
        });
        const tools = (listed.messages[0]?.result?.tools ?? []) as {
          readonly name: string;
        }[];

        let refusal: Awaited<ReturnType<typeof mcpRequest>> | undefined;
        for (const tool of tools) {
          const attempt = await mcpRequest(
            target,
            serverUrl,
            callToolMessage(tool.name),
            { accessToken: completed.tokens.access_token },
          );
          if (attempt.http.status === 403) {
            refusal = attempt;
            break;
          }
        }

        if (!refusal) {
          // Every published tool was within the minimal credential. There is nothing to assert
          // about a refusal that cannot occur, and inventing one would test the harness.
          expect(tools.length).toBeGreaterThan(0);
          return;
        }

        const challenge = parseBearerChallenge(
          refusal.http.headers.get("www-authenticate"),
        );
        expect(
          challenge?.parameters.get("error"),
          cite(
            IETF.BEARER_ERROR_CODES,
            "A valid credential lacking a permission is `403` with " +
              "`error=\"insufficient_scope\"`. Any other 403 is surfaced as a terminal error and " +
              "the user is never offered re-authorization.",
          ),
        ).toBe("insufficient_scope");
        expect(
          challenge?.parameters.get("scope"),
          cite(
            IETF.BEARER_ERROR_CODES,
            "The challenge must name the scope the operation needs — including scopes already " +
              "held, because scope accumulation is client-side and is not reliably carried " +
              "forward across a step-up.",
          ),
        ).toBeTruthy();
      });
    });

    describe("staying connected", () => {
      it("rotates the refresh token and returns the replacement in the same response", async () => {
        const completed = await authorize();
        expect(completed.tokens.refresh_token).toBeTypeOf("string");

        const response = await refreshTokens(
          target,
          session,
          completed.tokens.refresh_token!,
        );
        const refreshed = await readRefreshResponse(session, response);

        expect(
          refreshed.refresh_token,
          cite(
            IETF.REFRESH_ROTATION,
            "A public client's refresh token is rotated or sender-constrained. When it rotates, " +
              "the replacement must arrive in the same response that invalidates the old one, or " +
              "the client is left holding nothing.",
          ),
        ).toBeTypeOf("string");
        expect(
          refreshed.access_token,
          cite(IETF.OAUTH2_TOKEN_RESPONSE, "A refresh must produce a new access token."),
        ).toBeTypeOf("string");
      });

      it("refuses a rotated-away refresh token as invalid_grant", async () => {
        const completed = await authorize();
        const first = await refreshTokens(
          target,
          session,
          completed.tokens.refresh_token!,
        );
        await readRefreshResponse(session, first);

        const replay = await refreshTokens(
          target,
          session,
          completed.tokens.refresh_token!,
        );
        const body = (await replay.json()) as { error?: string };

        expect(
          { status: replay.status, error: body.error },
          cite(
            IETF.OAUTH2_INVALID_GRANT,
            "A dead refresh token is `invalid_grant` at HTTP 400 — never `invalid_request`, never " +
              "a custom code, and never an error body under HTTP 200, which clients read as " +
              "success and which has previously stopped a client from ever prompting for re-auth.",
          ),
        ).toEqual({ status: 400, error: "invalid_grant" });
      });

      it("accepts a refresh that omits the optional resource parameter", async () => {
        const completed = await authorize();
        const response = await refreshTokens(
          target,
          session,
          completed.tokens.refresh_token!,
        );

        expect(
          response.status,
          cite(
            IETF.RESOURCE_INDICATOR,
            "`resource` has different force per grant: the client sends it on the code exchange, " +
              "but on a refresh it is optional and merely narrows the already-granted set. " +
              "Requiring it turns every refresh from a client that omits it into a permanent " +
              "failure, minutes after consent.",
          ),
        ).toBe(200);
      });

      // Skipped unless the target declares its access-token lifetime: the assertion waits the
      // token out for real, so without a declared (short) lifetime there is nothing to wait for.
      it.skipIf(!authorization.accessTokenSeconds)(
        "lets an expired access token be exchanged for a working one",
        async () => {
        const completed = await authorize();
        // The deployment is started with a deliberately short access-token lifetime so this path is
        // reachable; the wait is the point of the test, not incidental.
        await new Promise((resolve) =>
          setTimeout(resolve, (authorization.accessTokenSeconds! + 2) * 1_000),
        );

        const expired = await mcpRequest(target, serverUrl, initializeMessage(), {
          accessToken: completed.tokens.access_token,
        });
        expect(
          expired.http.status,
          cite(
            IETF.BEARER_ERROR_CODES,
            "An expired credential is 401 with a Bearer challenge, which is what makes a client " +
              "refresh rather than report a failure.",
          ),
        ).toBe(401);

        const refreshed = await readRefreshResponse(
          session,
          await refreshTokens(target, session, completed.tokens.refresh_token!),
        );
        const retried = await mcpRequest(target, serverUrl, initializeMessage(), {
          accessToken: refreshed.access_token,
        });

        expect(
          retried.http.status,
          cite(
            VENDOR.ANTHROPIC_AUTH,
            "Claude refreshes reactively on 401 and proactively up to five minutes before stored " +
              "expiry, then retries. The retry must succeed or the connection is lost for good.",
          ),
          ).toBe(200);
        },
        60_000,
      );
    });

    describe("disconnecting and reconnecting", () => {
      it("revokes a refresh token when the client asks it to", async () => {
        const completed = await authorize();
        const revocation = await revokeToken(
          target,
          session,
          completed.tokens.refresh_token!,
          "refresh_token",
        );

        expect(
          revocation.status,
          cite(IETF.REVOCATION, "The revocation endpoint answers 200 for a successful revocation."),
        ).toBe(200);

        const afterwards = await refreshTokens(
          target,
          session,
          completed.tokens.refresh_token!,
        );
        const body = (await afterwards.json()) as { error?: string };
        expect(
          body.error,
          cite(
            IETF.OAUTH2_INVALID_GRANT,
            "A revoked refresh token must be refused as `invalid_grant`.",
          ),
        ).toBe("invalid_grant");
      });

      it("stops honouring an access token once its grant is revoked", async () => {
        const completed = await authorize();
        await revokeToken(target, session, completed.tokens.refresh_token!, "refresh_token");

        const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
          accessToken: completed.tokens.access_token,
        });

        expect(
          exchange.http.status,
          cite(
            MCP.AUDIENCE_VALIDATION,
            "Authority is re-established per call, so revocation takes effect immediately rather " +
              "than at the next expiry. Caching 'this session is allowed' defeats revocation.",
          ),
        ).toBe(401);
      });

      it("lets the same client identity reconnect after a disconnect", async () => {
        const first = await authorize();
        await revokeToken(target, session, first.tokens.refresh_token!, "refresh_token");

        const second = await authorize();
        const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
          accessToken: second.tokens.access_token,
        });

        expect(
          exchange.http.status,
          cite(
            MCP.CLIENT_REGISTRATION,
            "A client-ID metadata document is a stable, portable identity — the URL IS the " +
              "identifier — so reconnecting after a disconnect must work without re-registration.",
          ),
        ).toBe(200);
      });
    });

    describe("infrastructure the vendor's own troubleshooting names", () => {
      it("does not require an Origin header from a non-browser client", async () => {
        const completed = await authorize();
        const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
          accessToken: completed.tokens.access_token,
        });

        expect(
          exchange.http.status,
          cite(
            VENDOR.ANTHROPIC_TESTING,
            "Anthropic names overly strict Origin-header validation as a cause of `initialize` " +
              "timeouts. A server-to-server client sends no Origin at all.",
          ),
        ).toBe(200);
      });

      it("serves discovery without a credential", async () => {
        for (const url of [
          discovered.protectedResourceUrl,
          profile.authorizationServerProbeOrder(discovered.as.issuer)[0],
        ]) {
          const response = await fetchDocument(target, url);
          expect(
            response.status,
            cite(
              IETF.AS_METADATA_FIELDS,
              `Discovery is unauthenticated by definition — a client reads ${url} before it has ` +
                "any credential at all.",
            ),
          ).toBe(200);
        }
      });

      it("leaves no unexplained server error in the deployment log", () => {
        const log = readServerLogTail(deployment, 400);
        const serverErrors = log
          .split("\n")
          .filter((line) => line.includes('"protocolError":"server_error"'));

        expect(
          serverErrors,
          cite(
            VENDOR.ANTHROPIC_TROUBLESHOOTING,
            "`server_error` means something threw where nothing anticipated it. Every one is a " +
              "fault in this deployment, and each is invisible to a client because the protocol " +
              "collapses it into an opaque refusal.",
          ),
        ).toEqual([]);
      });
    });
  },
);
}
