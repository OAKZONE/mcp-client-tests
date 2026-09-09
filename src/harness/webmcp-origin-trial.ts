/**
 * Whether the API exists for the visitor at all — which is a different question from whether the
 * page registered anything.
 *
 * **Registration and reachability fail independently, and they look identical from a page.** A
 * perfectly written `registerTool` call reaches nobody if `document.modelContext` is undefined in
 * the browser that loaded it, and in a stock production browser that object exists only where the
 * response carried an origin-trial token. So a page can be flawless, its suite green, its DevTools
 * pane empty, and its tools unreachable by every real visitor.
 *
 * Chrome takes the token from the `Origin-Trial` response header or a
 * `<meta http-equiv="origin-trial">` in the document, ignores invalid or expired ones, and uses the
 * first valid token it finds.
 *
 * ## The failure this module was written for
 *
 * The token is read from **the response that carried it**. A response served without it is a
 * response with no WebMCP — so attaching the header to a rule that can decline to match disables the
 * API for exactly the visitors that rule declines, and for nobody else. A real deployment attached
 * it to a rule that also carried cache conditions: it would have been dead for exactly the visitors
 * holding one particular cookie, and perfect for every developer who ever loaded the page.
 *
 * That is invisible to a single fetch, which is why {@link conditionalDeliveryProblem} compares two.
 *
 * ## What is decoded, and what is not concluded from it
 *
 * A token's payload carries the origin it was issued for, the feature, an expiry, and whether it
 * covers subdomains. Chrome's published pages describe how to obtain and serve a token rather than
 * how one is laid out, so **a token this module cannot decode is reported as unread, never as
 * bad** — a parser artefact presented as a consumer's defect is the one thing a conformance package
 * must never produce.
 */

import { collectTags } from "./html.js";

/** Where a token was served from. */
export type OriginTrialDelivery = "header" | "meta";

/** One token, as served. */
export interface ServedOriginTrialToken {
  readonly delivery: OriginTrialDelivery;
  /** The token verbatim, as the header or the `content` attribute carried it. */
  readonly token: string;
}

/** A token's payload, as far as it could be read. */
export interface OriginTrialTokenPayload {
  /** The token format's version byte. */
  readonly version: number;
  /** The origin the token was issued for, e.g. `https://example.com:443`. */
  readonly origin: string;
  /** The trial the token enrols the origin in. */
  readonly feature: string;
  /** When it stops being honoured. */
  readonly expiry: Date;
  /** Whether it covers subdomains of {@link origin}. */
  readonly isSubdomain: boolean;
  /** Whether it is a third-party token, which only counts when served from a script. */
  readonly isThirdParty: boolean;
}

/** How a token's origin relates to the origin the page was served from. */
export type OriginTrialCoverage =
  /** The token names this exact origin. */
  | "exact"
  /** The token names a parent domain and covers subdomains. */
  | "subdomain"
  /** The token names some other origin, so this page is not enrolled by it. */
  | "mismatch";

/** The minimum length of a decodable token: version byte, signature, and payload length. */
const TOKEN_PREFIX_BYTES = 69;

/**
 * Every origin-trial token a response served, from either delivery mechanism.
 *
 * Both are collected rather than one, because which mechanism a deployment uses is its own business
 * and a suite that read only the header would report a perfectly enrolled page as unenrolled.
 *
 * @param headers - The response headers, as served.
 * @param html - The document body, for the meta-tag form.
 * @returns Each token, header tokens first, in served order.
 */
export function servedOriginTrialTokens(
  headers: Headers,
  html: string,
): readonly ServedOriginTrialToken[] {
  const served: ServedOriginTrialToken[] = [];

  // A repeated header arrives here comma-joined. Splitting on the comma is safe: a token is
  // base64, whose alphabet has no comma in it.
  const header = headers.get("origin-trial");
  if (header) {
    for (const token of header.split(",")) {
      const trimmed = token.trim();
      if (trimmed.length > 0) served.push({ delivery: "header", token: trimmed });
    }
  }

  for (const tag of collectTags(html, ["meta"])) {
    if ((tag.attributes.get("http-equiv") ?? "").toLowerCase() !== "origin-trial") continue;
    const token = (tag.attributes.get("content") ?? "").trim();
    if (token.length > 0) served.push({ delivery: "meta", token });
  }

  return served;
}

/**
 * Read a token's payload.
 *
 * The layout is a version byte, a signature, a big-endian payload length, and a JSON payload. It is
 * read back from live tokens rather than from a published specification, so anything that does not
 * fit that shape returns undefined and is reported as unread.
 *
 * @param token - The token as served.
 * @returns Its payload, or undefined when this parser could not read it.
 */
export function decodeOriginTrialToken(token: string): OriginTrialTokenPayload | undefined {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(token, "base64");
  } catch {
    return undefined;
  }
  if (bytes.byteLength <= TOKEN_PREFIX_BYTES) return undefined;

  const version = bytes[0];
  // Versions 2 and 3 share this layout; 3 adds third-party fields inside the same JSON payload.
  if (version !== 2 && version !== 3) return undefined;

  const payloadLength = bytes.readUInt32BE(65);
  if (payloadLength === 0 || TOKEN_PREFIX_BYTES + payloadLength > bytes.byteLength) return undefined;

  let payload: unknown;
  try {
    payload = JSON.parse(bytes.toString("utf8", TOKEN_PREFIX_BYTES, TOKEN_PREFIX_BYTES + payloadLength));
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null) return undefined;

  const fields = payload as Record<string, unknown>;
  if (typeof fields.origin !== "string" || typeof fields.feature !== "string") return undefined;
  if (typeof fields.expiry !== "number") return undefined;

  return {
    version,
    origin: fields.origin,
    feature: fields.feature,
    expiry: new Date(fields.expiry * 1000),
    isSubdomain: fields.isSubdomain === true,
    isThirdParty: fields.isThirdParty === true,
  };
}

/**
 * Whether a token enrols the origin the page was actually served from.
 *
 * @param payload - The decoded token.
 * @param pageOrigin - The origin the page was served from.
 * @returns How the two relate.
 */
export function originTrialCoverage(
  payload: OriginTrialTokenPayload,
  pageOrigin: string,
): OriginTrialCoverage {
  let issued: URL;
  let page: URL;
  try {
    issued = new URL(payload.origin);
    page = new URL(pageOrigin);
  } catch {
    return "mismatch";
  }

  if (issued.protocol === page.protocol && issued.host === page.host) return "exact";
  if (!payload.isSubdomain) return "mismatch";
  if (issued.protocol !== page.protocol || issued.port !== page.port) return "mismatch";
  return page.hostname.endsWith(`.${issued.hostname}`) ? "subdomain" : "mismatch";
}

/**
 * Suffixes of names that can never resolve on the public internet.
 *
 * `example.` and `example.com` are deliberately absent: RFC 6761 reserves them for documentation
 * rather than for non-resolution, and they do resolve.
 */
const UNROUTABLE_SUFFIXES = [".test", ".localhost", ".invalid"];

/** Hosts that are the loopback interface itself, spelled the three ways a URL can spell it. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Whether an origin is one a trial token could ever be issued for.
 *
 * **This is what keeps a test-shape artefact from being reported as a consumer's defect.** This
 * package tells consumers to drive their deployment under an unroutable canonical origin, so the
 * issuer stays HTTPS and port-free while the socket stays on loopback — and no origin trial can be
 * registered for a name that never resolves. A production token served by such a deployment
 * therefore *always* names a different origin, which says nothing about the deployment and
 * everything about the origin the run chose.
 *
 * The clock is a separate question and stays judgeable: an expired token is expired wherever it is
 * served.
 *
 * @param origin - The origin the page was served from.
 * @returns Whether a trial token could name this origin. False for an origin that cannot be parsed.
 */
export function originCanHoldTrialToken(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (LOOPBACK_HOSTS.has(host)) return false;
  return !UNROUTABLE_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/**
 * Say why a page's served tokens leave it unenrolled, when they do.
 *
 * **Silent when the page serves no token at all**, which is a different finding with a different
 * cause — a page may be reached with a flag, or not be meant to reach production browsers yet — and
 * belongs in an advisory rather than a failure.
 *
 * **Silent about the origin when the page's own origin is unroutable** — see
 * {@link originCanHoldTrialToken}. Expiry and the third-party flag are still judged there, because
 * neither depends on which origin the run chose.
 *
 * @param tokens - Every token the response served.
 * @param pageOrigin - The origin the page was served from.
 * @param now - The moment to judge expiry against.
 * @returns Why none of them enrols this page, or undefined when one does, or when none was served
 *   or none could be read.
 */
export function originTrialProblem(
  tokens: readonly ServedOriginTrialToken[],
  pageOrigin: string,
  now: Date,
): string | undefined {
  const decoded = tokens
    .map((served) => ({ served, payload: decodeOriginTrialToken(served.token) }))
    .filter(
      (entry): entry is { served: ServedOriginTrialToken; payload: OriginTrialTokenPayload } =>
        entry.payload !== undefined,
    );
  if (decoded.length === 0) return undefined;

  // An unroutable page origin can never be named by a token, so a mismatch against one is a fact
  // about the origin this run chose rather than about the deployment.
  const judgeOrigin = originCanHoldTrialToken(pageOrigin);

  // Chrome uses the first valid token and ignores the rest, so one working token is a pass.
  const working = decoded.filter(
    (entry) =>
      entry.payload.expiry.getTime() > now.getTime() &&
      (!judgeOrigin || originTrialCoverage(entry.payload, pageOrigin) !== "mismatch") &&
      !entry.payload.isThirdParty,
  );
  if (working.length > 0) return undefined;

  return decoded
    .map((entry) => {
      const { payload } = entry;
      if (payload.expiry.getTime() <= now.getTime()) {
        return `the \`${payload.feature}\` token served by ${entry.served.delivery} expired on ${payload.expiry.toISOString()}`;
      }
      if (payload.isThirdParty) {
        return `the \`${payload.feature}\` token served by ${entry.served.delivery} is a third-party token, which only counts when it is served from a script`;
      }
      return `the \`${payload.feature}\` token served by ${entry.served.delivery} was issued for ${payload.origin}, which does not cover ${pageOrigin}${payload.isSubdomain ? " even as a subdomain" : " and does not cover subdomains"}`;
    })
    .join("; ");
}

/**
 * Say whether a token was served to one request and withheld from another.
 *
 * The two readings differ only in something no visitor controls deliberately — an extra cookie, a
 * header — so any difference between them means the API is present for some visitors and absent for
 * others, which is the failure that survives every single-fetch check ever written against it.
 *
 * @param plain - The tokens served to the first request.
 * @param withExtraCookie - The tokens served to a request differing only by an unrelated cookie.
 * @returns What differed, or undefined when the two responses agree.
 */
export function conditionalDeliveryProblem(
  plain: readonly ServedOriginTrialToken[],
  withExtraCookie: readonly ServedOriginTrialToken[],
): string | undefined {
  const before = new Set(plain.map((served) => served.token));
  const after = new Set(withExtraCookie.map((served) => served.token));
  if (before.size === 0 && after.size === 0) return undefined;

  const lost = [...before].filter((token) => !after.has(token));
  const gained = [...after].filter((token) => !before.has(token));
  if (lost.length === 0 && gained.length === 0) return undefined;

  if (lost.length > 0 && gained.length === 0) {
    return "the token was served to a plain request and withheld from one carrying an unrelated cookie";
  }
  if (gained.length > 0 && lost.length === 0) {
    return "the token was withheld from a plain request and served to one carrying an unrelated cookie";
  }
  return "a different token was served to a request carrying an unrelated cookie";
}
