/**
 * What one vendor's MCP client does, expressed as data the shared spine executes.
 *
 * **This is the file that keeps the suite honest.** Every field below is a statement about a
 * published client — its redirect URI, its client metadata document, how it picks scopes, which
 * discovery URLs it derives — and each is sourced from that vendor's own documentation, cited on the
 * field. Nothing here may be chosen to match what this deployment happens to accept: the profile
 * describes the client, the deployment either satisfies it or does not, and the test reports which.
 *
 * The one rule for editing a profile: **change a field only when the vendor's documentation
 * changes**, and update `verifiedAgainst` in the same commit. A profile edited to make a test pass
 * has converted a conformance suite into a regression suite for our own behaviour.
 *
 * Profiles carry no project knowledge — no scope names, no endpoint paths, no origin. Everything
 * about the deployment under test is either discovered from the wire or supplied by the single
 * project adapter, which is what makes this directory portable to another MCP server unchanged.
 */

import type { SpecificationClause } from "./specifications.js";

/** How the client obtains a `client_id`. */
export type ClientRegistrationMethod =
  | "client_id_metadata_document"
  | "dynamic_client_registration";

/** How the client authenticates at the token endpoint. */
export type TokenEndpointAuthMethod = "none" | "private_key_jwt";

/** The inputs a client has when choosing the `scope` it will request. */
export interface ScopeSelectionInputs {
  /** The `scope` attribute of the transport's `WWW-Authenticate` challenge, when it sent one. */
  readonly challengeScope: string | undefined;
  /** `scopes_supported` from the protected-resource metadata. */
  readonly protectedResourceScopes: readonly string[];
  /** `scopes_supported` from the authorization-server metadata. */
  readonly authorizationServerScopes: readonly string[];
}

export interface VendorProfile {
  /** Stable identifier used in test names and fixture paths. */
  readonly id: string;
  /** How the surface is referred to in the vendor's own documentation. */
  readonly displayName: string;
  /** The vendor documentation this profile is transcribed from. */
  readonly documentation: SpecificationClause;
  /**
   * The client build or documentation revision every field below was read against.
   *
   * Client behaviour moves: one vendor changed its scope selection in a point release and its
   * redirect form in another. A profile without this is a claim with no expiry.
   */
  readonly verifiedAgainst: string;

  /** The registration path this surface elects first. */
  readonly registration: ClientRegistrationMethod;

  /**
   * The exact redirect URI the vendor sends.
   *
   * Registered verbatim: guessing or wildcarding one is the single most common reason a working
   * server is unreachable from a given client.
   */
  readonly redirectUri: string;

  /**
   * The client's published metadata document, verbatim.
   *
   * For a CIMD client this is served by the harness at {@link clientMetadataPath} and the `client_id`
   * is the URL it is served from — the document IS the identity, so it is transcribed from the
   * vendor's live document rather than authored here.
   */
  readonly clientMetadata: Readonly<Record<string, unknown>>;

  /** Path on the harness document origin where {@link clientMetadata} is published. */
  readonly clientMetadataPath: string;

  /** Path on the harness document origin where the client's public JWKS is published, if any. */
  readonly clientJwksPath?: string;

  /** The method the client actually authenticates with — not merely the one it declares. */
  readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod;

  /** Whether the client sends RFC 8707 `resource` on authorization and token requests. */
  readonly sendsResourceParameter: boolean;

  /** Whether the client sends `state` on the authorization request. */
  readonly sendsStateParameter: boolean;

  /**
   * Whether the client appends `offline_access` when the AUTHORIZATION SERVER metadata advertises it.
   *
   * The document, not the resource: a server advertising it only in protected-resource metadata
   * never gets it appended, so it never issues a refresh token, so its users re-authenticate
   * forever. Modelling the source document is the only way that shows up as a test failure.
   */
  readonly appendsOfflineAccessFromAuthorizationServerMetadata: boolean;

  /**
   * The client's scope-selection ladder.
   *
   * Returns the `scope` parameter value the client would send, or `undefined` when the client sends
   * no `scope` parameter at all — which is documented behaviour for at least one shipping client and
   * which a conformant server must accept (`scope` is OPTIONAL).
   */
  selectScope(inputs: ScopeSelectionInputs): string | undefined;

  /**
   * The authorization-server discovery URLs this client derives from an issuer, in the order it
   * tries them.
   *
   * Derived by the profile rather than by the harness because the orders genuinely differ, and
   * because the defect this suite was born from was a URL that was published but never derived.
   *
   * @param issuer - The issuer identifier taken from protected-resource metadata.
   * @returns Absolute URLs, most-preferred first.
   */
  authorizationServerProbeOrder(issuer: string): readonly string[];

  /**
   * The protected-resource discovery URLs this client derives from an MCP server URL, in order.
   *
   * @param mcpServerUrl - The URL a user typed into the client.
   * @returns Absolute URLs, most-preferred first.
   */
  protectedResourceProbeOrder(mcpServerUrl: string): readonly string[];
}

/**
 * Insert the well-known segment into a URL's path, per the metadata-discovery rule shared by
 * authorization-server and protected-resource metadata.
 *
 * The transformation is INSERTION, not appending: for `https://host/a/b` the document lives at
 * `https://host/.well-known/<segment>/a/b`. Appending (`https://host/a/b/.well-known/<segment>`)
 * is the shape that looks healthy in a browser and is never requested by any client.
 *
 * @param base - The issuer or resource identifier.
 * @param wellKnownSegment - e.g. `oauth-authorization-server`.
 * @returns The derived document URL.
 */
export function wellKnownInsertion(
  base: string,
  wellKnownSegment: string,
): string {
  const parsed = new URL(base);
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return `${parsed.origin}/.well-known/${wellKnownSegment}${path}`;
}
