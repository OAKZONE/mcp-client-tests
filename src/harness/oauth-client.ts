/**
 * The OAuth client half of the flow, driven by `oauth4webapi` rather than by hand.
 *
 * **Why a library and not our own requests.** Every other OAuth suite in this repository builds its
 * requests from this repository's reading of the protocol, and is therefore structurally blind to a
 * wrong reading — the exact defect class that took the connectors down
 * (`docs/decisions/DEC-ARC-052-oauth-discovery-at-the-urls-clients-probe.md`). `oauth4webapi` is
 * panva's spec-exact client, the counterpart to the `oidc-provider` this deployment runs, and it has
 * never read our configuration. It derives the discovery URL itself, validates the returned `issuer`
 * itself, builds and verifies PKCE itself, and rejects a token response that violates RFC 6749
 * itself. When it disagrees with the deployment, the specification is talking.
 *
 * Everything the library will not do for us is done here explicitly and cited: the authorization
 * request is a browser navigation (`browser.ts`), not an HTTP call, and the `resource` indicator is
 * an additional parameter the library passes through untouched.
 *
 * The functions below are deliberately thin. A test asserts on what comes back — including on
 * failures, because a refusal with the right code is frequently the behaviour under test.
 */

import * as oauth from "oauth4webapi";

import { edgeFetch, type EdgeTarget } from "./edge-transport.js";
import type { VendorProfile } from "./vendor-profile.js";

/** A discovered authorization server plus the client identity in use against it. */
export interface OAuthSession {
  readonly as: oauth.AuthorizationServer;
  readonly client: oauth.Client;
  readonly clientAuth: oauth.ClientAuth;
  readonly redirectUri: string;
}

/** One authorization request in flight: what was sent, and what is needed to complete it. */
export interface PendingAuthorization {
  readonly url: string;
  readonly state: string | undefined;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/** Fetch bound to the deployment's proxy translation, handed to the library as `customFetch`. */
function transport(target: EdgeTarget): Record<symbol, typeof fetch> {
  return { [oauth.customFetch]: edgeFetch(target) };
}

/**
 * Fetch a document exactly as addressed, with no interpretation.
 *
 * Discovery probing asserts on the *status* of URLs a client derives, including the ones that must
 * answer `404`, so the raw response is what a test needs — not a parsed document.
 *
 * @param target - The deployment.
 * @param url - Absolute URL on the canonical origin.
 * @returns The raw response.
 */
export async function fetchDocument(
  target: EdgeTarget,
  url: string,
): Promise<Response> {
  return edgeFetch(target)(url, { method: "GET" });
}

/**
 * Run authorization-server metadata discovery the way a conformant client does.
 *
 * `processDiscoveryResponse` refuses a document whose `issuer` is not the issuer that was asked
 * about, so a resolved value is itself evidence of that requirement being met.
 *
 * @param target - The deployment.
 * @param issuer - The issuer identifier taken from protected-resource metadata.
 * @returns The discovered metadata.
 * @throws When the derived URL does not answer, or the document fails validation.
 */
export async function discoverAuthorizationServer(
  target: EdgeTarget,
  issuer: string,
): Promise<oauth.AuthorizationServer> {
  const issuerUrl = new URL(issuer);
  const response = await oauth.discoveryRequest(issuerUrl, {
    // RFC 8414 rather than OpenID Connect Discovery: this is an OAuth authorization server, and the
    // two algorithms derive different URLs from a path-bearing issuer.
    algorithm: "oauth2",
    ...transport(target),
  });
  return oauth.processDiscoveryResponse(issuerUrl, response);
}

/**
 * Register a client dynamically (RFC 7591).
 *
 * @param target - The deployment.
 * @param as - Discovered authorization-server metadata carrying `registration_endpoint`.
 * @param metadata - The client metadata to register.
 * @returns The registered client, including any values the server substituted.
 */
export async function registerDynamicClient(
  target: EdgeTarget,
  as: oauth.AuthorizationServer,
  metadata: Partial<oauth.Client>,
): Promise<oauth.Client> {
  const response = await oauth.dynamicClientRegistrationRequest(
    as,
    metadata,
    transport(target),
  );
  return (await oauth.processDynamicClientRegistrationResponse(
    response,
  )) as oauth.Client;
}

/** Raw dynamic-registration response, for tests asserting on refusals and status codes. */
export async function registerDynamicClientRaw(
  target: EdgeTarget,
  as: oauth.AuthorizationServer,
  metadata: Partial<oauth.Client>,
): Promise<Response> {
  return oauth.dynamicClientRegistrationRequest(as, metadata, transport(target));
}

/**
 * Build the authorization request URL a client would navigate the user's browser to.
 *
 * PKCE is always S256 and always present: the MCP authorization specification requires it of every
 * client regardless of registration method, so a profile does not get to opt out.
 *
 * `resource` and `state` are included only when the profile says its client sends them — modelling a
 * client that omits an OPTIONAL parameter is the only way to discover that a server requires it.
 *
 * @param as - Discovered authorization-server metadata.
 * @param profile - The vendor client being modelled.
 * @param options - The client identity, requested scope, and canonical resource.
 * @returns The URL plus the PKCE verifier needed to complete the exchange.
 */
export async function buildAuthorizationRequest(
  as: oauth.AuthorizationServer,
  profile: VendorProfile,
  options: {
    readonly clientId: string;
    readonly scope: string | undefined;
    readonly resource: string;
    readonly redirectUri?: string;
    /** Override the PKCE method, so a non-conformant request can be modelled deliberately. */
    readonly codeChallengeMethod?: string;
    /**
     * Extra authorization-request parameters.
     *
     * Present so a test can model a client that sends a parameter the covered vendors do not — the
     * only way to establish that a server behaviour depends on that parameter rather than on
     * something else. Never used to make a vendor's own request succeed.
     */
    readonly extraParameters?: Readonly<Record<string, string>>;
  },
): Promise<PendingAuthorization> {
  if (!as.authorization_endpoint) {
    throw new Error("Discovered metadata carries no authorization_endpoint");
  }
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = profile.sendsStateParameter
    ? oauth.generateRandomState()
    : undefined;

  const url = new URL(as.authorization_endpoint);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri ?? profile.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set(
    "code_challenge_method",
    options.codeChallengeMethod ?? "S256",
  );
  if (state !== undefined) url.searchParams.set("state", state);
  if (options.scope !== undefined) url.searchParams.set("scope", options.scope);
  if (profile.sendsResourceParameter) {
    url.searchParams.set("resource", options.resource);
  }
  for (const [name, value] of Object.entries(options.extraParameters ?? {})) {
    url.searchParams.set(name, value);
  }

  return { url: url.toString(), state, codeVerifier, codeChallenge };
}

/**
 * Validate the authorization response the browser was redirected to.
 *
 * `validateAuthResponse` checks `state` and, when the server advertises
 * `authorization_response_iss_parameter_supported`, the `iss` parameter — the mix-up defence in
 * RFC 9207. It throws on an error response, so a test expecting a refusal reads the parameters
 * directly instead.
 *
 * @param session - The discovered server and client.
 * @param callbackUrl - The redirect URI the browser stopped at, query intact.
 * @param expectedState - The `state` that was sent, or undefined when none was.
 * @returns The validated response parameters.
 */
export function validateAuthorizationResponse(
  session: OAuthSession,
  callbackUrl: string,
  expectedState: string | undefined,
): URLSearchParams {
  return oauth.validateAuthResponse(
    session.as,
    session.client,
    new URL(callbackUrl),
    expectedState ?? oauth.expectNoState,
  );
}

/**
 * Exchange an authorization code for tokens.
 *
 * @param target - The deployment.
 * @param session - The discovered server, client, and client authentication.
 * @param parameters - The validated authorization-response parameters.
 * @param codeVerifier - The PKCE verifier from {@link buildAuthorizationRequest}.
 * @param options - `resource` to send, and any parameter overrides a negative test needs.
 * @returns The raw token response, so a test can assert status and body itself.
 */
export async function exchangeAuthorizationCode(
  target: EdgeTarget,
  session: OAuthSession,
  parameters: URLSearchParams,
  codeVerifier: string,
  options: {
    readonly resource?: string;
    readonly redirectUri?: string;
  } = {},
): Promise<Response> {
  const additionalParameters = new URLSearchParams();
  if (options.resource !== undefined) {
    additionalParameters.set("resource", options.resource);
  }
  return oauth.authorizationCodeGrantRequest(
    session.as,
    session.client,
    session.clientAuth,
    parameters,
    options.redirectUri ?? session.redirectUri,
    codeVerifier,
    { ...transport(target), additionalParameters },
  );
}

/** Parse a successful token response, applying the library's RFC 6749 §5.1 validation. */
export async function readTokenResponse(
  session: OAuthSession,
  response: Response,
): Promise<oauth.TokenEndpointResponse> {
  return oauth.processAuthorizationCodeResponse(
    session.as,
    session.client,
    response,
  );
}

/**
 * Perform a refresh-token grant.
 *
 * `resource` is optional on refresh (RFC 8707 §2 gives it different force per grant: on a refresh it
 * narrows an already-granted set rather than selecting one), so it is sent only when asked for.
 */
export async function refreshTokens(
  target: EdgeTarget,
  session: OAuthSession,
  refreshToken: string,
  options: { readonly resource?: string } = {},
): Promise<Response> {
  const additionalParameters = new URLSearchParams();
  if (options.resource !== undefined) {
    additionalParameters.set("resource", options.resource);
  }
  return oauth.refreshTokenGrantRequest(
    session.as,
    session.client,
    session.clientAuth,
    refreshToken,
    { ...transport(target), additionalParameters },
  );
}

/** Parse a refresh response with the library's validation applied. */
export async function readRefreshResponse(
  session: OAuthSession,
  response: Response,
): Promise<oauth.TokenEndpointResponse> {
  return oauth.processRefreshTokenResponse(session.as, session.client, response);
}

/** Revoke a token at the revocation endpoint (RFC 7009). */
export async function revokeToken(
  target: EdgeTarget,
  session: OAuthSession,
  token: string,
  hint?: "access_token" | "refresh_token",
): Promise<Response> {
  return oauth.revocationRequest(session.as, session.client, session.clientAuth, token, {
    ...transport(target),
    ...(hint ? { additionalParameters: new URLSearchParams({ token_type_hint: hint }) } : {}),
  });
}

/**
 * Post an arbitrary body to the token endpoint.
 *
 * Needed for the requirements a well-behaved library will not let us violate: sending JSON where the
 * specification mandates form encoding, replaying a consumed code, or presenting a refresh token
 * after it has been rotated. Each of those is a documented server obligation, so each needs a
 * request the library would refuse to build.
 *
 * @param target - The deployment.
 * @param as - Discovered metadata carrying `token_endpoint`.
 * @param body - The raw body to send.
 * @param contentType - The `Content-Type` to send it under.
 * @returns The raw response.
 */
export async function postToTokenEndpoint(
  target: EdgeTarget,
  as: oauth.AuthorizationServer,
  body: string,
  contentType: string,
): Promise<Response> {
  if (!as.token_endpoint) {
    throw new Error("Discovered metadata carries no token_endpoint");
  }
  return edgeFetch(target)(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": contentType, accept: "application/json" },
    body,
  });
}

/** Build the client-authentication method a profile says its client actually uses. */
export function clientAuthenticationFor(
  method: "none" | "private_key_jwt",
  privateKey?: CryptoKey,
): oauth.ClientAuth {
  if (method === "none") return oauth.None();
  if (!privateKey) {
    throw new Error("private_key_jwt client authentication needs a private key");
  }
  return oauth.PrivateKeyJwt(privateKey);
}

export { oauth };
