/**
 * Discovery conformance: everything a client reads **before** it has a token.
 *
 * **Why this is a family of its own.** Every other authorization assertion in this package drives a
 * real authorization-code flow, which needs an account holder in the server's storage and a consent
 * screen to submit — so it can only run against a deployment this package started. But the surface
 * a client walks *first* — the `401` challenge, the protected-resource document, the
 * authorization-server document and the URLs they are derived from — is entirely public, and it is
 * where deployments most often become unreachable while looking healthy in a browser.
 *
 * That makes it the one family that can be pointed at a **remote** deployment: staging, or
 * production. It requires no capability and no credential, and it asserts nothing that would need
 * one.
 *
 * **What it cannot tell you.** That discovery is correct is not that authorization works. A token
 * exchange, a refresh, a consent screen that returns the scopes it displayed — none of that is
 * reachable without driving the flow, and a green run here is not evidence about any of it. The
 * suite says so in an advisory rather than letting a clean discovery report read as a clean
 * connector.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import {
  deploymentMcpUrl,
  edgeTargetFor,
  readRunningDeployment,
  type RunningDeployment,
} from "../../harness/deployment.js";
import { edgeRequest, type EdgeTarget } from "../../harness/edge-transport.js";
import { parseBearerChallenge, type BearerChallenge } from "../../harness/mcp-client.js";
import { IETF, MCP, VENDOR, cite } from "../../harness/specifications.js";
import { wellKnownInsertion } from "../../harness/vendor-profile.js";
import type { McpTestTarget } from "../../target.js";

const SCOPE = "Discovery — the authorization surface";

/** Everything read from the wire once, in `beforeAll`, so each assertion is a judgement not a fetch. */
interface DiscoveryReading {
  readonly serverUrl: string;
  readonly challengeStatus: number;
  readonly challenge: BearerChallenge | undefined;
  readonly invalidTokenChallenge: BearerChallenge | undefined;
  readonly invalidTokenStatus: number;
  /** The protected-resource document, and the URL it was read from. */
  readonly protectedResource: Record<string, unknown> | undefined;
  readonly protectedResourceUrl: string | undefined;
  /** Status of each protected-resource URL a covered client derives. */
  readonly protectedResourceProbes: readonly { url: string; status: number }[];
  readonly authorizationServer: Record<string, unknown> | undefined;
  readonly authorizationServerUrl: string | undefined;
  readonly authorizationServerProbes: readonly { url: string; status: number }[];
  /** The append-shaped alias no client derives, probed so a decoy can be reported. */
  readonly appendFormStatus: number | undefined;
  /**
   * The origin-level authorization-server document, when one answers.
   *
   * Probed separately from the derived URL because a deployment whose issuer carries a path does
   * not own this URL: it belongs to the issuer `https://<host>`. What it returns decides whether it
   * is harmless breadth or a document no client may use.
   */
  readonly originLevelAuthorizationServer: Record<string, unknown> | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function statusOf(target: EdgeTarget, url: string): Promise<number> {
  try {
    return (await edgeRequest(target, url, { method: "GET" })).status;
  } catch {
    return 0;
  }
}

async function documentAt(
  target: EdgeTarget,
  url: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await edgeRequest(target, url, { method: "GET" });
    if (response.status !== 200) return undefined;
    return asRecord(response.json());
  } catch {
    return undefined;
  }
}

/**
 * Register the discovery conformance suite against one target.
 *
 * Requires no capability. Runs against a spawned deployment or a remote one alike — the documents
 * it reads are the same either way, which is the whole reason this family exists.
 *
 * @param mcpTarget - The MCP server under test.
 */
export function defineAuthorizationSurfaceSuite(mcpTarget: McpTestTarget): void {
  describe("Discovery — the authorization surface", () => {
    let deployment: RunningDeployment;
    let target: EdgeTarget;
    let reading: DiscoveryReading;

    beforeAll(async () => {
      deployment = readRunningDeployment(mcpTarget.id);
      target = edgeTargetFor(deployment);
      const serverUrl = deploymentMcpUrl(deployment);

      // An unauthenticated tools/list is what a client sends before it knows anything at all.
      const challengeResponse = await edgeRequest(target, serverUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const invalidToken = await edgeRequest(target, serverUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer not-a-real-token",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

      const challenge = parseBearerChallenge(
        challengeResponse.headers.get("www-authenticate"),
      );

      // The pointer is preferred, exactly as a client prefers it — it is the only path that works
      // for a deployment that cannot serve `/.well-known/*` at its origin root.
      const pointer = challenge?.parameters.get("resource_metadata");
      const derived = [
        wellKnownInsertion(serverUrl, "oauth-protected-resource"),
        `${new URL(serverUrl).origin}/.well-known/oauth-protected-resource`,
      ];
      const protectedResourceProbes: { url: string; status: number }[] = [];
      for (const url of derived) {
        protectedResourceProbes.push({ url, status: await statusOf(target, url) });
      }
      const protectedResourceUrl = pointer ?? derived[0];
      const protectedResource = await documentAt(target, protectedResourceUrl);

      const issuer = stringList(protectedResource?.authorization_servers)[0];
      const authorizationServerProbes: { url: string; status: number }[] = [];
      let authorizationServer: Record<string, unknown> | undefined;
      let authorizationServerUrl: string | undefined;
      let appendFormStatus: number | undefined;
      let originLevelAuthorizationServer: Record<string, unknown> | undefined;
      if (issuer) {
        const insertion = wellKnownInsertion(issuer, "oauth-authorization-server");
        const oidcInsertion = wellKnownInsertion(issuer, "openid-configuration");
        for (const url of [insertion, oidcInsertion]) {
          authorizationServerProbes.push({ url, status: await statusOf(target, url) });
        }
        authorizationServerUrl = insertion;
        authorizationServer = await documentAt(target, insertion);

        const parsedIssuer = new URL(issuer);
        if (parsedIssuer.pathname !== "/") {
          appendFormStatus = await statusOf(
            target,
            `${parsedIssuer.origin}${parsedIssuer.pathname.replace(/\/$/, "")}` +
              "/.well-known/oauth-authorization-server",
          );
          // The bare well-known path belongs to the issuer `https://<host>`, not to a path-bearing
          // one, so what it serves is a separate question from whether the derived URL works.
          originLevelAuthorizationServer = await documentAt(
            target,
            `${parsedIssuer.origin}/.well-known/oauth-authorization-server`,
          );
        }
      }

      reading = {
        serverUrl,
        challengeStatus: challengeResponse.status,
        challenge,
        invalidTokenChallenge: parseBearerChallenge(
          invalidToken.headers.get("www-authenticate"),
        ),
        invalidTokenStatus: invalidToken.status,
        protectedResource,
        protectedResourceUrl,
        protectedResourceProbes,
        authorizationServer,
        authorizationServerUrl,
        authorizationServerProbes,
        appendFormStatus,
        originLevelAuthorizationServer,
      };
    }, 120_000);

    afterAll(() => {
      reportAdvisories(SCOPE);
    });

    it("refuses an unauthenticated call with a transport-level 401", () => {
      expect(
        reading.challengeStatus,
        cite(
          MCP.UNAUTHENTICATED_401,
          "An unauthenticated MCP request is refused at the transport with `401`, before the SDK " +
            "sees it. A `200` wrapping `isError: true` produces no sign-in affordance in any " +
            "client — the user sees a broken tool rather than a connect button.",
        ),
      ).toBe(401);
    });

    it("carries a Bearer challenge naming where the metadata lives", () => {
      expect(
        reading.challenge?.parameters.get("resource_metadata"),
        cite(
          IETF.PRM_WWW_AUTHENTICATE_POINTER,
          "The `401` points at the protected-resource document with `resource_metadata`. It is the " +
            "only discovery path that works when a platform cannot serve `/.well-known/*` at its " +
            "origin root, and Claude accepts the pointer at any HTTPS location.",
        ),
      ).toBeTypeOf("string");
    });

    it("answers an invalid token with `invalid_token`, not a generic refusal", () => {
      expect(
        {
          status: reading.invalidTokenStatus,
          error: reading.invalidTokenChallenge?.parameters.get("error"),
        },
        cite(
          IETF.BEARER_ERROR_CODES,
          "A token that does not validate is `401` with `error=\"invalid_token\"`. A client reads " +
            "that code to decide whether to refresh and retry or to send the user back through " +
            "consent; without it, an expired token and a revoked grant look identical.",
        ),
      ).toEqual({ status: 401, error: "invalid_token" });
    });

    it("serves protected-resource metadata at the URLs a client derives", () => {
      const unanswered = reading.protectedResourceProbes
        .filter((probe) => probe.status !== 200)
        .map((probe) => `${probe.url} answered ${probe.status}`);

      expect(
        unanswered,
        cite(
          IETF.PRM_PATH_INSERTION,
          "For a resource carrying a path the well-known segment is INSERTED, never appended, and " +
            "the origin-level document is the second shape clients probe. Serving neither is how a " +
            "deployment becomes unreachable while every document looks healthy in a browser.",
        ),
      ).toEqual([]);
    });

    it("publishes the protected-resource fields a client needs to proceed", () => {
      const document = reading.protectedResource ?? {};

      expect(
        {
          resource: document.resource,
          authorization_servers: stringList(document.authorization_servers).length > 0,
          scopes_supported: stringList(document.scopes_supported).length > 0,
        },
        cite(
          IETF.PRM_FIELDS,
          "Protected-resource metadata carries `resource`, `authorization_servers` and " +
            "`scopes_supported`. Claude uses `authorization_servers[0]` and never falls back to a " +
            "later entry, so the primary issuer belongs first.",
        ),
      ).toEqual({
        resource: reading.serverUrl,
        authorization_servers: true,
        scopes_supported: true,
      });
    });

    it("answers authorization-server metadata at the inserted well-known path", () => {
      const insertion = reading.authorizationServerProbes[0];

      expect(
        insertion?.status,
        cite(
          IETF.AS_METADATA_PATH_INSERTION,
          `For a path-bearing issuer the well-known segment is INSERTED (RFC 8414 §3.1), giving ` +
            `${insertion?.url ?? "the derived URL"}. This is the URL every covered client derives; ` +
            "publishing only an append-shaped alias looks healthy and is never requested.",
        ),
      ).toBe(200);
    });

    it("returns the issuer the client asked about", () => {
      expect(
        reading.authorizationServer?.issuer,
        cite(
          IETF.AS_METADATA_ISSUER_MATCH,
          "The `issuer` returned MUST equal the issuer the well-known URI was inserted into. A " +
            "conformant client refuses a document that names a different one, so a mismatch takes " +
            "the connection down with an error that reads like a trust problem.",
        ),
      ).toBe(stringList(reading.protectedResource?.authorization_servers)[0]);
    });

    it("advertises PKCE `S256`, which a client verifies before it starts", () => {
      expect(
        stringList(reading.authorizationServer?.code_challenge_methods_supported),
        cite(
          MCP.PKCE_REQUIRED,
          "PKCE `S256` is mandatory and MUST be advertised. Clients check the metadata before " +
            "beginning a flow; an absent list reads as no PKCE support, and a conformant client " +
            "must then refuse to authorize at all.",
        ),
      ).toContain("S256");
    });

    it("records what a clean discovery does and does not prove", () => {
      collectAdvisories(reading);
      expect(
        reading.protectedResource,
        "No protected-resource document could be read, so every assertion above inspected an " +
          "empty document.",
      ).toBeDefined();
    });
  });
}

/**
 * Record what the published surface offers, and what this family cannot reach.
 *
 * @param reading - Everything read from the wire this run.
 */
function collectAdvisories(reading: DiscoveryReading): void {
  const as = reading.authorizationServer ?? {};
  const prm = reading.protectedResource ?? {};
  const asScopes = stringList(as.scopes_supported);
  const prmScopes = stringList(prm.scopes_supported);

  // Stated every run: discovery being correct is not authorization working.
  advise(SCOPE, {
    subject: "what this family reached",
    finding:
      "this suite read the public discovery surface only — no token was exchanged, no consent " +
      "screen was submitted, and no refresh was attempted",
    consequence:
      "A clean report here means a client can find you and start; it is not evidence that the " +
      "flow completes. Registration succeeding is not token exchange succeeding, and a consent " +
      "page is not a pass. Prove a connector end to end on the surface you care about before " +
      "claiming support for it.",
    source: VENDOR.ANTHROPIC_TESTING,
  });

  if (prmScopes.includes("offline_access")) {
    advise(SCOPE, {
      subject: "`offline_access` in the protected-resource document",
      finding: "`scopes_supported` on the protected-resource metadata lists `offline_access`",
      consequence:
        "It is a client-and-authorization-server concern rather than a resource permission, and " +
        "clients append it from the AUTHORIZATION SERVER metadata. Advertising it here does not " +
        "get it appended, so no refresh token is issued and users re-authenticate forever. Keep " +
        "it out of the `401` challenge and the protected-resource document.",
      source: IETF.REFRESH_ROTATION,
    });
  }

  if (!asScopes.includes("offline_access")) {
    advise(SCOPE, {
      subject: "refresh tokens",
      finding: "the authorization-server metadata does not advertise `offline_access`",
      consequence:
        "Claude hosted and Claude Code append `offline_access` only when the authorization-server " +
        "metadata advertises it. Without it they never request a refresh token, so every " +
        "connection ends at the access token's expiry and the user reconnects by hand.",
      source: IETF.REFRESH_ROTATION,
    });
  }

  const cimdSupported = as.client_id_metadata_document_supported === true;
  const allowsNone = stringList(as.token_endpoint_auth_methods_supported).includes("none");
  if (!(cimdSupported && allowsNone)) {
    advise(SCOPE, {
      subject: "client-ID metadata documents",
      finding:
        "CIMD is not elected: " +
        `\`client_id_metadata_document_supported\` is ${String(as.client_id_metadata_document_supported)}` +
        ` and \`"none"\` is ${allowsNone ? "" : "not "}in \`token_endpoint_auth_methods_supported\``,
      consequence:
        "Claude picks CIMD only when BOTH conditions hold, and looks for a `registration_endpoint` " +
        "otherwise. Dynamic registration scales badly — a new client record per connection, with " +
        "storage, rate limits and a lifecycle for stale rows — whereas a CIMD `client_id` is a URL " +
        "and needs none of it.",
      source: MCP.CLIENT_REGISTRATION,
    });
  }

  if (as.authorization_response_iss_parameter_supported !== true) {
    advise(SCOPE, {
      subject: "RFC 9207 issuer identification",
      finding: "the authorization-server metadata does not advertise `authorization_response_iss_parameter_supported`",
      consequence:
        "Emitting `iss` is what moves ChatGPT from its per-connection callback to the stable " +
        "redirect URI, removing the callback churn entirely — and it is the identification the " +
        "2026-07-28 revision requires clients to validate, which Claude Code enforces by failing " +
        "the sign-in outright on an unexpected issuer.",
      source: IETF.ISS_RESPONSE_PARAMETER,
    });
  }

  if (typeof as.registration_endpoint !== "string" && !cimdSupported) {
    advise(SCOPE, {
      subject: "client registration",
      finding: "neither a `registration_endpoint` nor CIMD support is advertised",
      consequence:
        "A client with no way to obtain a `client_id` cannot start a flow at all unless every user " +
        "is pre-registered by hand. Offer at least two paths — CIMD with both election conditions, " +
        "plus dynamic registration — and document a pre-registered id for the exact-match clients.",
      source: MCP.CLIENT_REGISTRATION,
    });
  }

  const originLevel = reading.originLevelAuthorizationServer;
  if (originLevel && typeof originLevel.issuer === "string") {
    const origin = new URL(reading.serverUrl).origin;
    if (originLevel.issuer !== origin) {
      advise(SCOPE, {
        subject: "the origin-level authorization-server document",
        finding:
          `\`${origin}/.well-known/oauth-authorization-server\` answers with ` +
          `\`issuer: "${originLevel.issuer}"\``,
        consequence:
          "A client reaching that URL derived it from the issuer `" +
          origin +
          "`, and RFC 8414 §3.3 requires it to refuse a document naming a different issuer — so " +
          "this document cannot legitimately be used by anyone, while looking healthy to a human " +
          "checking discovery in a browser. It fails closed rather than open, so it is breadth " +
          "rather than a break; serving the inserted path alone, and `404`-ing this one, removes " +
          "the ambiguity. Serving it deliberately as defensive breadth is a defensible choice — " +
          "this advisory exists so it stays a choice rather than an accident.",
        source: IETF.AS_METADATA_ISSUER_MATCH,
      });
    }
  }

  if (reading.appendFormStatus === 200) {
    advise(SCOPE, {
      subject: "an append-shaped discovery alias",
      finding:
        "authorization-server metadata also answers at the append-shaped URL " +
        "(`<issuer-path>/.well-known/oauth-authorization-server`)",
      consequence:
        "No covered client derives that shape — RFC 8414 §3.1 inserts the well-known segment — so " +
        "it serves nobody, while looking healthy to anyone checking discovery in a browser. Worse, " +
        "a client that did reach it derived it from a different issuer identifier and must reject " +
        "the document under §3.3, so it cannot be used even by accident.",
      source: IETF.AS_METADATA_PATH_INSERTION,
    });
  }
}
