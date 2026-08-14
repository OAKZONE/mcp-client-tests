/**
 * The connection sequence every MCP client walks, assembled from the pieces around it.
 *
 * A vendor suite asserts on *steps*; this module performs them. Keeping the walk in one place means
 * the two vendor suites exercise the same sequence with their own choices plugged in — which is the
 * only way a difference in a result can be attributed to the vendor's behaviour rather than to how
 * its test happened to be written.
 *
 * The sequence, and where each step is specified:
 *
 * 1. Call the MCP endpoint with no credential → HTTP `401` with a `WWW-Authenticate: Bearer`
 *    challenge naming the protected-resource metadata (RFC 9728 §5.1, RFC 6750 §3).
 * 2. Fetch the protected-resource metadata → `resource`, `authorization_servers`, `scopes_supported`
 *    (RFC 9728 §2).
 * 3. Discover the authorization server from `authorization_servers[0]`, requiring the returned
 *    `issuer` to match (RFC 8414 §3.1, §3.3).
 * 4. Obtain a `client_id` — by publishing a client metadata document, or by dynamic registration
 *    (MCP authorization; RFC 7591).
 * 5. Navigate the user's browser to the authorization endpoint with PKCE S256 (RFC 7636) and, when
 *    the client sends them, `state` and `resource` (RFC 8707 §2).
 * 6. Authenticate and consent in the browser, then follow the redirect back to the client.
 * 7. Exchange the code at the token endpoint (RFC 6749 §4.1.3), form-encoded.
 * 8. Call a tool with the access token.
 */

import { expect } from "vitest";

import { openBrowser, findForm, type Browser } from "./browser.js";
import type { EdgeTarget, WireResponse } from "./edge-transport.js";
import type { DocumentPublisher } from "./document-host.js";
import {
  clientAuthenticationFor,
  discoverAuthorizationServer,
  fetchDocument,
  buildAuthorizationRequest,
  exchangeAuthorizationCode,
  readTokenResponse,
  validateAuthorizationResponse,
  oauth,
  type OAuthSession,
} from "./oauth-client.js";
import {
  initializeMessage,
  mcpRequest,
  parseBearerChallenge,
  type BearerChallenge,
} from "./mcp-client.js";
import type { VendorProfile } from "./vendor-profile.js";

/** What a client learns before it can start an authorization. */
export interface DiscoveredDeployment {
  /** The unauthenticated response that started everything. */
  readonly challengeResponse: WireResponse;
  /** The parsed `WWW-Authenticate` challenge, when one was sent. */
  readonly challenge: BearerChallenge | undefined;
  /** The protected-resource metadata document, as served. */
  readonly protectedResource: Record<string, unknown>;
  /** The URL the protected-resource metadata was actually read from. */
  readonly protectedResourceUrl: string;
  /** The discovered authorization-server metadata. */
  readonly as: oauth.AuthorizationServer;
}

/**
 * Walk discovery exactly as a client with only the MCP URL would.
 *
 * The `resource_metadata` pointer on the challenge is preferred, because it is the only path that
 * works for a deployment that cannot serve `/.well-known/*` at its origin root; the profile's probe
 * order is used when no pointer is present.
 *
 * @param target - The deployment.
 * @param profile - The vendor client being modelled.
 * @param mcpServerUrl - The URL the user typed.
 * @returns Everything discovered, including the raw challenge response.
 */
export async function discoverDeployment(
  target: EdgeTarget,
  profile: VendorProfile,
  mcpServerUrl: string,
): Promise<DiscoveredDeployment> {
  const unauthenticated = await mcpRequest(
    target,
    mcpServerUrl,
    initializeMessage(),
  );
  const challenge = parseBearerChallenge(
    unauthenticated.http.headers.get("www-authenticate"),
  );

  const pointer = challenge?.parameters.get("resource_metadata");
  const candidates = pointer
    ? [pointer, ...profile.protectedResourceProbeOrder(mcpServerUrl)]
    : profile.protectedResourceProbeOrder(mcpServerUrl);

  let protectedResource: Record<string, unknown> | undefined;
  let protectedResourceUrl = "";
  for (const candidate of candidates) {
    const response = await fetchDocument(target, candidate);
    if (!response.ok) continue;
    protectedResource = (await response.json()) as Record<string, unknown>;
    protectedResourceUrl = candidate;
    break;
  }
  if (!protectedResource) {
    throw new Error(
      "No protected-resource metadata was reachable at any URL this client derives:\n" +
        candidates.map((url) => `  ${url}`).join("\n") +
        "\nA client that cannot find this document never reaches the authorization server at all.",
    );
  }

  const issuers = protectedResource.authorization_servers;
  if (!Array.isArray(issuers) || typeof issuers[0] !== "string") {
    throw new Error(
      "Protected-resource metadata carries no usable `authorization_servers` entry.",
    );
  }
  // The first entry only: no covered client falls back to a later one.
  const as = await discoverAuthorizationServer(target, issuers[0]);

  return {
    challengeResponse: unauthenticated.http,
    challenge,
    protectedResource,
    protectedResourceUrl,
    as,
  };
}

/** The scope string this client would request, given what it discovered. */
export function selectedScope(
  profile: VendorProfile,
  discovered: DiscoveredDeployment,
): string | undefined {
  const protectedResourceScopes = Array.isArray(
    discovered.protectedResource.scopes_supported,
  )
    ? (discovered.protectedResource.scopes_supported as string[])
    : [];
  return profile.selectScope({
    challengeScope: discovered.challenge?.parameters.get("scope"),
    protectedResourceScopes,
    authorizationServerScopes: discovered.as.scopes_supported ?? [],
  });
}

/**
 * Publish the vendor's client metadata document and adopt the resulting identity.
 *
 * In CIMD the `client_id` *is* the document's URL, so there is no registration request: publishing
 * the document is the registration. The authorization server fetches it on first use.
 *
 * @param documents - The document host the server under test can reach.
 * @param profile - The vendor client being modelled.
 * @returns The `client_id` the client will present.
 */
export async function publishClientMetadata(
  documents: DocumentPublisher,
  profile: VendorProfile,
): Promise<string> {
  const clientId = documents.url(profile.clientMetadataPath);
  await documents.publish(profile.clientMetadataPath, {
    contentType: "application/json",
    body: JSON.stringify(profile.clientMetadata),
  });
  return clientId;
}

/** Build the OAuth session object the exchange functions consume. */
export function openOAuthSession(
  discovered: DiscoveredDeployment,
  profile: VendorProfile,
  clientId: string,
  privateKey?: CryptoKey,
): OAuthSession {
  return {
    as: discovered.as,
    client: { client_id: clientId },
    clientAuth: clientAuthenticationFor(profile.tokenEndpointAuthMethod, privateKey),
    redirectUri: profile.redirectUri,
  };
}

/**
 * The `name` a consent screen's permission checkboxes carry when its target does not say.
 *
 * A default rather than a required field because every consumer written before the setting existed
 * used this name, and a required field would have turned a portability improvement into a breaking
 * change for all of them.
 */
export const DEFAULT_CONSENT_SCOPE_FIELD = "scope";

/**
 * The consent-screen facts a browser leg needs, read off a target's authorization capability.
 *
 * Spread into a leg's options (`...consentControls(authorization)`) so a new consent-screen fact is
 * added in one place rather than at every call site that drives a browser.
 *
 * @param authorization - The target's authorization capability.
 * @returns The consent form's id and the name of its permission controls.
 */
export function consentControls(authorization: {
  readonly consentFormId: string;
  readonly consentScopeFieldName?: string;
}): { consentFormId: string; consentScopeFieldName: string } {
  return {
    consentFormId: authorization.consentFormId,
    consentScopeFieldName: authorization.consentScopeFieldName ?? DEFAULT_CONSENT_SCOPE_FIELD,
  };
}

/** What the browser leg produced. */
export interface AuthorizationLeg {
  /** The URL the browser was finally redirected to at the client's callback. */
  readonly callbackUrl: string;
  /** The consent screen's response, so its headers and controls can be asserted on. */
  readonly consentPage: WireResponse;
  /** Every scope the consent screen offered, and how it presented each. */
  readonly offeredScopes: readonly {
    readonly value: string;
    readonly checked: boolean;
    readonly disabled: boolean;
  }[];
  /** The browser session, still holding its cookies. */
  readonly browser: Browser;
}

export interface AuthorizationLegOptions {
  readonly target: EdgeTarget;
  readonly authorizationUrl: string;
  readonly sessionCookieName: string;
  readonly sessionCookieValue: string;
  readonly consentFormId: string;
  /** The `name` the consent screen's permission checkboxes carry. Defaults to `scope`. */
  readonly consentScopeFieldName?: string;
  /** Extra permissions the holder ticks beyond what the client asked for. */
  readonly additionalScopes?: readonly string[];
  /** `allow` completes the authorization; `deny` refuses it. */
  readonly decision?: "allow" | "deny";
  /** Reuse a browser session, so a second authorization sees the same cookies. */
  readonly browser?: Browser;
}

/**
 * Drive the browser leg: navigate, consent, and follow back to the client's callback.
 *
 * The consent screen is real application UI rendered by the real server, and the POST carries the
 * `Origin` a browser would compute from that page's own `Referrer-Policy`. That derivation is not
 * decoration: a server whose hardening header and whose CSRF check disagree rejects every consent
 * decision, and only a modelled browser makes that a test failure rather than a production incident.
 *
 * @param options - Where to start, who is signed in, and what the holder decides.
 * @returns The callback URL and what the consent screen offered.
 * @throws Error when the flow does not reach a consent screen or a callback, with the page's own
 *   title quoted so the failure names what was rendered instead.
 */
export async function runAuthorizationLeg(
  options: AuthorizationLegOptions,
): Promise<AuthorizationLeg> {
  const browser = options.browser ?? openBrowser(options.target);
  browser.setCookie(options.sessionCookieName, options.sessionCookieValue);

  const toConsent = await browser.navigate(options.authorizationUrl);
  if (toConsent.stoppedAt) {
    throw new Error(
      `The authorization request redirected straight to ${toConsent.stoppedAt} without a consent ` +
        "screen. When that URL carries `error=`, the authorization endpoint refused the request.",
    );
  }
  const html = toConsent.response.text();
  let form;
  try {
    form = findForm(html, options.consentFormId);
  } catch (error) {
    // The navigation chain is the diagnosis: a consent screen that never rendered was either
    // refused upstream, redirected somewhere unexpected, or answered with a status that carries no
    // document. Quoting the whole walk turns "the form is missing" into a locatable step.
    const walk = toConsent.steps
      .map(
        (step) =>
          `    ${step.status} ${step.url}${step.location ? ` → ${step.location}` : ""}`,
      )
      .join("\n");
    throw new Error(
      `${(error as Error).message}\n  navigation:\n${walk}\n  final content-type: ` +
        `${toConsent.response.headers.get("content-type") ?? "(none)"}`,
    );
  }

  const scopeField = options.consentScopeFieldName ?? DEFAULT_CONSENT_SCOPE_FIELD;
  const offeredScopes = form.checkboxes
    .filter((control) => control.name === scopeField)
    .map((control) => ({
      value: control.value,
      checked: control.checked,
      disabled: control.disabled,
    }));

  // A browser submits a checkbox only when it is checked AND enabled; a disabled control sends
  // nothing at all. Modelling that exactly is what makes "the server re-adds what the client asked
  // for" an observable property rather than an assumption.
  const submitted: (readonly [string, string])[] = form.checkboxes
    .filter((control) => control.checked && !control.disabled)
    .map((control) => [control.name, control.value] as const);
  for (const extra of options.additionalScopes ?? []) {
    if (!submitted.some(([, value]) => value === extra)) {
      submitted.push([scopeField, extra]);
    }
  }
  submitted.push(["decision", options.decision ?? "allow"]);

  const decisionResponse = await browser.submitForm(
    form,
    toConsent.response,
    submitted,
  );

  const location = decisionResponse.headers.get("location");
  if (!location) {
    throw new Error(
      `The consent decision answered ${decisionResponse.status} with no redirect. ` +
        "A completed interaction must send the browser onward.",
    );
  }
  const onward = await browser.navigate(
    new URL(location, options.target.canonicalOrigin).toString(),
  );
  if (!onward.stoppedAt) {
    throw new Error(
      `The consent decision never reached the client's callback; it stopped at ` +
        `${onward.steps.at(-1)?.url ?? "an unknown URL"} with status ${onward.response.status}.`,
    );
  }

  return {
    callbackUrl: onward.stoppedAt,
    consentPage: toConsent.response,
    offeredScopes,
    browser,
  };
}

/** A completed authorization: the credential set and how it was reached. */
export interface CompletedAuthorization {
  readonly tokens: oauth.TokenEndpointResponse;
  readonly leg: AuthorizationLeg;
  readonly session: OAuthSession;
  readonly pending: Awaited<ReturnType<typeof buildAuthorizationRequest>>;
  readonly callbackParameters: URLSearchParams;
}

export interface CompleteAuthorizationOptions {
  readonly target: EdgeTarget;
  readonly profile: VendorProfile;
  readonly discovered: DiscoveredDeployment;
  readonly session: OAuthSession;
  readonly resource: string;
  readonly scope: string | undefined;
  readonly sessionCookieName: string;
  readonly sessionCookieValue: string;
  readonly consentFormId: string;
  readonly consentScopeFieldName?: string;
  readonly additionalScopes?: readonly string[];
  readonly browser?: Browser;
  /** Extra authorization-request parameters; see `buildAuthorizationRequest`. */
  readonly extraParameters?: Readonly<Record<string, string>>;
}

/**
 * Run the whole authorization from a discovered deployment to a token set.
 *
 * Used by the tests whose subject is what happens *after* authorization — refresh, revocation,
 * expiry, tool calls — so those tests are not each re-implementing the flow. Every step still runs
 * for real; nothing is cached between calls.
 *
 * @param options - The client, the holder, and what to ask for.
 * @returns The tokens and every intermediate the caller may need to assert on.
 */
export async function completeAuthorization(
  options: CompleteAuthorizationOptions,
): Promise<CompletedAuthorization> {
  const pending = await buildAuthorizationRequest(
    options.discovered.as,
    options.profile,
    {
      clientId: options.session.client.client_id,
      scope: options.scope,
      resource: options.resource,
      extraParameters: options.extraParameters,
    },
  );
  const leg = await runAuthorizationLeg({
    target: options.target,
    authorizationUrl: pending.url,
    sessionCookieName: options.sessionCookieName,
    sessionCookieValue: options.sessionCookieValue,
    consentFormId: options.consentFormId,
    consentScopeFieldName: options.consentScopeFieldName,
    additionalScopes: options.additionalScopes,
    browser: options.browser,
  });

  const callbackParameters = validateAuthorizationResponse(
    options.session,
    leg.callbackUrl,
    pending.state,
  );
  const response = await exchangeAuthorizationCode(
    options.target,
    options.session,
    callbackParameters,
    pending.codeVerifier,
    { resource: options.profile.sendsResourceParameter ? options.resource : undefined },
  );
  const tokens = await readTokenResponse(options.session, response);

  return { tokens, leg, session: options.session, pending, callbackParameters };
}

/**
 * Assert the deployment answered at all, so a broken harness never reads as a broken deployment.
 *
 * Called once per suite before anything else. If the server is not serving, every later assertion
 * would fail for the same uninformative reason; failing here instead says so plainly.
 *
 * @param target - The deployment.
 * @param mcpServerUrl - The MCP endpoint.
 */
export async function assertDeploymentIsServing(
  target: EdgeTarget,
  mcpServerUrl: string,
): Promise<void> {
  const exchange = await mcpRequest(target, mcpServerUrl, initializeMessage());
  expect(
    exchange.http.status,
    "The deployment under test did not answer its MCP endpoint at all. This is a harness or " +
      "deployment fault, not a conformance finding — check the server log named at startup.",
  ).toBeGreaterThan(0);
}
