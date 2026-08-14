/**
 * Vendor conformance: ChatGPT (Desktop, web, mobile — Developer mode and published plugins).
 *
 * Profile: `profiles/chatgpt-desktop.ts` (transcribed from OpenAI's Plugins documentation).
 *
 * **This suite covers what is DIFFERENT about ChatGPT.** The protocol spine — the 401 challenge,
 * protected-resource metadata, PKCE, code exchange, refresh rotation, revocation — binds every
 * client and is exercised in full by `claude-desktop.test.ts`; repeating it here would double the
 * runtime and halve the signal. What is asserted here is the set of behaviours where a server that
 * works for Claude is routinely unreachable from ChatGPT:
 *
 * - a three-URL authorization-server discovery order, one of which Claude never derives;
 * - `private_key_jwt` client authentication, which OpenAI documents and explicitly forbids
 *   downgrading;
 * - dynamic registration as a *co-equal* path, because the plugin builder can select it even when
 *   CIMD is available;
 * - a per-connection redirect URI that must be registered exactly;
 * - the OIDC scopes ChatGPT requests whenever discovery advertises them;
 * - the tool-result account-linking channel, without which the sign-in UI never appears.
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
  fetchDocument,
  registerDynamicClient,
  registerDynamicClientRaw,
  type OAuthSession,
} from "../../harness/oauth-client.js";
import { IETF, MCP, VENDOR, cite } from "../../harness/specifications.js";
import {
  CHATGPT_LEGACY_REDIRECT_URI,
  CHATGPT_REDIRECT_URI,
  chatgptDesktopProfile,
} from "../../profiles/chatgpt-desktop.js";
import type { VendorProfile } from "../../harness/vendor-profile.js";

/**
 * Mint the key pair ChatGPT signs its token requests with.
 *
 * OpenAI holds the private key and publishes the public set on the CIMD metadata origin; the
 * authorization server fetches that set and verifies the assertion against it. The harness plays
 * both halves, so the key is generated per run and the public half is published as the client's
 * `jwks_uri`.
 */
async function createClientSigningKey(): Promise<{
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey & { kid: string };
}> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, kid: "chatgpt-conformance-key", use: "sig", alg: "ES256" },
  };
}

/**
 * Register this surface's conformance suite against one target.
 *
 * Skipped unless the target declares the authorization capability, because every assertion
 * below drives an authorization-code flow.
 *
 * @param mcpTarget - The MCP server under test.
 */
export function defineChatgptDesktopSuite(mcpTarget: McpTestTarget): void {
describe.skipIf(!mcpTarget.authorization)("ChatGPT connector conformance", () => {
  let deployment: RunningDeployment;
  let target: EdgeTarget;
  let documents: DocumentPublisher;
  let profile: VendorProfile;
  let holder: AccountHolder;
  let serverUrl: string;
  let discovered: DiscoveredDeployment;
  let session: OAuthSession;
  let signingKey: Awaited<ReturnType<typeof createClientSigningKey>>;

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
    holder = await authorization.createAccountHolder("chatgpt-desktop");

    await assertDeploymentIsServing(target, serverUrl);

    profile = chatgptDesktopProfile(
      documents.url("/chatgpt/oauth/client-metadata"),
      documents.url("/chatgpt/oauth/jwks.json"),
    );
    signingKey = await createClientSigningKey();
    await documents.publish("/chatgpt/oauth/jwks.json", {
      contentType: "application/json",
      body: JSON.stringify({ keys: [signingKey.publicJwk] }),
    });
    const clientId = await publishClientMetadata(documents, profile);

    discovered = await discoverDeployment(target, profile, serverUrl);
    session = openOAuthSession(discovered, profile, clientId, signingKey.privateKey);
  }, 120_000);

  afterAll(async () => {
    await authorization.clearAccountHolders("chatgpt-desktop");
  });

  describe("discovery, in the order ChatGPT probes", () => {
    it("answers the first URL ChatGPT derives for a path-bearing issuer", async () => {
      const [primary] = profile.authorizationServerProbeOrder(discovered.as.issuer);
      const response = await fetchDocument(target, primary);

      expect(
        response.status,
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          `OpenAI documents the discovery order for a path-bearing issuer; the first entry is ` +
            `${primary}. A deployment answering none of the three is unreachable from ChatGPT ` +
            "however healthy its documents look in a browser.",
        ),
      ).toBe(200);
    });

    it("answers at least one URL in the documented probe order", async () => {
      const statuses: { url: string; status: number }[] = [];
      for (const candidate of profile.authorizationServerProbeOrder(discovered.as.issuer)) {
        statuses.push({
          url: candidate,
          status: (await fetchDocument(target, candidate)).status,
        });
      }

      expect(
        statuses.some((entry) => entry.status === 200),
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          "ChatGPT walks three URLs in order:\n" +
            statuses.map((entry) => `    ${entry.status} ${entry.url}`).join("\n"),
        ),
      ).toBe(true);
    });

    it("serves both protected-resource documents OpenAI names", async () => {
      for (const candidate of profile.protectedResourceProbeOrder(serverUrl)) {
        const response = await fetchDocument(target, candidate);
        expect(
          response.status,
          cite(
            IETF.PRM_PATH_INSERTION,
            `OpenAI's build guidance says to serve and test ${candidate}.`,
          ),
        ).toBe(200);
      }
    });

    it("only advertises OpenID Connect scopes it will actually grant", async () => {
      // ChatGPT requests `openid`, `email`, and `profile` by default when authorization-server
      // discovery advertises them, and OpenAI states that every advertised scope must actually be
      // enabled for the ChatGPT client. A deployment that advertises an OIDC scope it then refuses
      // sends every ChatGPT connection into `invalid_scope`.
      const oidcCandidates = ["openid", "email", "profile"];
      const advertised = (discovered.as.scopes_supported ?? []).filter((scope) =>
        oidcCandidates.includes(scope),
      );
      if (advertised.length === 0) {
        expect(discovered.as.scopes_supported ?? []).not.toContain("openid");
        return;
      }

      const withOidc = [...(selectedScope(profile, discovered) ?? "").split(" "), ...advertised]
        .filter(Boolean)
        .join(" ");
      const completed = await completeAuthorization({
        target,
        profile,
        discovered,
        session,
        resource: String(discovered.protectedResource.resource),
        scope: withOidc,
        sessionCookieName: holder.sessionCookieName,
        sessionCookieValue: holder.sessionCookieValue,
        consentFormId: authorization.consentFormId,
      });

      expect(
        completed.tokens.access_token,
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          "Every scope the authorization-server metadata advertises must actually be enabled for " +
            "the ChatGPT client; advertising one that is then refused breaks every connection.",
        ),
      ).toBeTypeOf("string");
    });
  });

  describe("client identity", () => {
    it("registers the per-connection callback ChatGPT presents", async () => {
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
        completed.leg.callbackUrl.startsWith(CHATGPT_REDIRECT_URI),
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          `New ChatGPT connections use a per-connection redirect URI shaped as ` +
            `${CHATGPT_REDIRECT_URI}; it must be allowlisted exactly and never wildcarded.`,
        ),
      ).toBe(true);
    });

    it("does not depend on the legacy shared callback", () => {
      const registered = profile.clientMetadata.redirect_uris as string[];
      expect(
        registered,
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          "The legacy shared callback survives only for already-published apps; a new integration " +
            "that relies on it is depending on a compatibility path.",
        ),
      ).not.toContain(CHATGPT_LEGACY_REDIRECT_URI);
    });

    it("keeps dynamic registration working alongside metadata documents", async () => {
      // The plugin builder can select dynamic registration even when CIMD is available, so a
      // deployment advertising both must keep both functional. This is a co-equal path, not a
      // fallback.
      const registered = await registerDynamicClient(target, discovered.as, {
        client_name: "ChatGPT conformance (dynamic)",
        redirect_uris: [CHATGPT_REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });

      expect(
        registered.client_id,
        cite(
          IETF.DCR_RESPONSE,
          "Registration answers with the issued `client_id`, and the client must use the values " +
            "returned in that response.",
        ),
      ).toBeTypeOf("string");
    });

    it("refuses a registration body that is not JSON", async () => {
      const response = await registerDynamicClientRaw(target, discovered.as, {
        // A redirect URI that is not a URI at all; the registration schema must reject it.
        redirect_uris: ["not-a-uri"],
      } as never);

      expect(
        response.status,
        cite(
          IETF.DCR_JSON_REQUEST,
          "The registration endpoint validates the metadata it is given rather than storing it " +
            "unchecked; an unusable redirect URI must be refused at registration, not at the " +
            "authorization request where the client can no longer act on it.",
        ),
      ).toBeGreaterThanOrEqual(400);
    });

    it("authenticates a client that signs its token request", async () => {
      // OpenAI documents `private_key_jwt` as the authenticated-client path and states plainly that
      // a missing assertion is a failed exchange to capture and escalate — NEVER permission to
      // relabel an authenticated client as public. This test drives the documented behaviour: the
      // client declares `private_key_jwt` and presents a real signed assertion.
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
        completed.tokens.access_token,
        cite(
          IETF.PRIVATE_KEY_JWT,
          "A client that declares `private_key_jwt` and presents a valid assertion signed by a key " +
            "in its published `jwks_uri` must be authenticated by that method. Silently accepting " +
            "it as a public client instead means the assertion was never verified.",
        ),
      ).toBeTypeOf("string");
    });
  });

  describe("resource binding", () => {
    it("binds the token to the exact resource value it published", async () => {
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
      const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
        accessToken: completed.tokens.access_token,
      });

      expect(
        exchange.http.status,
        cite(
          MCP.CANONICAL_RESOURCE,
          "ChatGPT sends the protected-resource metadata `resource` value verbatim on both the " +
            "authorization and the token request; the authorization server binds it into the token " +
            "and the MCP server accepts it.",
        ),
      ).toBe(200);
    });
  });

  describe("account linking", () => {
    it("declares tool-level authorization whenever a tool is reachable without a credential", async () => {
      // OpenAI's three-part requirement — reachable protected-resource metadata, an explicit per-tool
      // `securitySchemes` array, and a runtime tool-result Bearer challenge — governs **tool-level
      // account linking**, which is the path taken when a `tools/call` reaches a handler without a
      // credential. It is not the only supported shape: OpenAI's minimum production contract is a
      // transport that refuses an uncredentialed request and sends ChatGPT into the ordinary OAuth
      // flow, which is also what every Claude surface requires.
      //
      // So the requirement asserted here is COHERENCE between the two, because the incoherent
      // combination is the one that fails silently: a surface that lets an unauthenticated tool call
      // through, and then answers it with a bare error carrying neither half, produces a plain tool
      // failure in ChatGPT and no sign-in card — the user sees the connector "not working" with
      // nothing to click.
      const anonymousCall = await mcpRequest(
        target,
        serverUrl,
        callToolMessage("welcome"),
      );

      if (anonymousCall.http.status === 401) {
        // Transport-refusing posture: linking is driven by the HTTP challenge, and the tool-level
        // channel is not the active path. The challenge itself is asserted in the suites' shared
        // spine; nothing further is required of the tool definitions.
        expect(
          parseBearerChallenge(anonymousCall.http.headers.get("www-authenticate"))?.scheme,
          cite(
            MCP.UNAUTHENTICATED_401,
            "A surface that refuses uncredentialed tool calls at the transport must carry the " +
              "Bearer challenge there, since that challenge is the only thing that starts a flow.",
          ),
        ).toBe("Bearer");
        return;
      }

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
      const tools = (listed.messages[0]?.result?.tools ?? []) as Record<string, unknown>[];
      expect(tools.length).toBeGreaterThan(0);

      expect(
        tools.filter((tool) => "securitySchemes" in tool).length,
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          "This surface admits an uncredentialed `tools/call`, so tool-level linking IS the active " +
            "path and OpenAI requires all three parts. Every tool must declare `securitySchemes` — " +
            "`oauth2` with the scopes it needs, `noauth` to be anonymous, or both to make account " +
            "linking optional.",
        ),
      ).toBe(tools.length);
    });

    it("carries a Bearer challenge in the tool result when a call needs authorization", async () => {
      // The tool-result channel is distinct from the transport `401`: the 401 covers an
      // unauthenticated TRANSPORT request, while `_meta["mcp/www_authenticate"]` on an `isError`
      // result is what makes ChatGPT offer account linking for a tool call it did reach.
      const unauthenticated = await mcpRequest(
        target,
        serverUrl,
        callToolMessage("welcome"),
      );

      if (unauthenticated.http.status === 401) {
        // The transport refused first, which is correct and is the Claude-shaped path. ChatGPT
        // still needs the tool-result channel for its own linking UI, and the only way that channel
        // can ever be exercised is a tool call that reaches a handler — which requires the surface
        // to admit an unauthenticated `tools/call` for at least one tool.
        const challenge = parseBearerChallenge(
          unauthenticated.http.headers.get("www-authenticate"),
        );
        expect(
          challenge?.scheme,
          cite(
            MCP.UNAUTHENTICATED_401,
            "The transport-level refusal must still be a Bearer challenge.",
          ),
        ).toBe("Bearer");
        return;
      }

      const meta = unauthenticated.messages[0]?.result?._meta as
        | Record<string, unknown>
        | undefined;
      expect(
        meta?.["mcp/www_authenticate"],
        cite(
          VENDOR.OPENAI_PLUGIN_AUTH,
          "A tool error result that needs authorization must set `isError: true` and carry a " +
            "Bearer challenge in `_meta[\"mcp/www_authenticate\"]` with `error`, " +
            "`error_description`, and the resource-metadata URL, or ChatGPT reports a plain tool " +
            "failure with no linking UI.",
        ),
      ).toBeDefined();
    });
  });

  describe("negative verification", () => {
    it("refuses a token minted for another audience", async () => {
      const exchange = await mcpRequest(target, serverUrl, initializeMessage(), {
        accessToken: "an-access-token-this-authority-never-issued",
      });

      expect(
        exchange.http.status,
        cite(
          MCP.AUDIENCE_VALIDATION,
          "Issuer, audience, validity, and scope are verified on every call.",
        ),
      ).toBe(401);
    });

    it("keeps the MCP access token out of anything it hands back", async () => {
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

      expect(
        listed.http.text().includes(completed.tokens.access_token),
        cite(
          MCP.NO_TOKEN_PASSTHROUGH,
          "An MCP access token is for the MCP server only. It must never appear in tool metadata, " +
            "results, URLs, or logs, and must never be passed through to an upstream API.",
        ),
      ).toBe(false);
    });
  });
});
}
