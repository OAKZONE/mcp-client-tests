/**
 * The wire the conformance suite speaks, and the reverse proxy every deployed MCP server sits
 * behind.
 *
 * **Why a hand-written transport and not `fetch`.** Three of the properties under test are
 * properties of the raw HTTP message, and a high-level client either hides them or refuses to send
 * them: the exact `Host` header (the MCP endpoint answers `421` when it is not canonical), the
 * `set-cookie` list as an array of distinct headers, and a redirect that is *observed* rather than
 * followed. `node:http` gives all three; `fetch` forbids setting `Host` at the spec level and
 * collapses cookies. A conformance harness that cannot control the bytes is testing its own client.
 *
 * **Why the origin the client addresses is not the origin the socket dials.** A deployed MCP server
 * terminates TLS at a reverse proxy and receives plain HTTP carrying `X-Forwarded-Proto: https` and
 * the original `Host` (this deployment: `docs/decisions/DEC-ARC-007`). Its canonical identifiers —
 * issuer, `resource`, redirect targets, `Secure` cookies — are therefore all HTTPS while its socket
 * is not. Both vendors require an HTTPS canonical identifier, so testing against a plain
 * `http://127.0.0.1:PORT` origin would exercise a shape that is never deployed and would silently
 * skip the forwarded-header path, the `Secure` cookie path, and the canonical-host check. This
 * module *is* that proxy: the client addresses `https://<canonical-host>/…`, and the request is
 * delivered to the loopback port the server actually listens on with the headers a proxy adds.
 *
 * Nothing here interprets a response. Status, headers, and bytes are handed back exactly as
 * received, so every judgement lives in a test beside its citation.
 */

import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";

/** One HTTP exchange, unmodified. */
export interface WireResponse {
  readonly status: number;
  /** Response headers; repeated names (notably `set-cookie`) are preserved via {@link setCookies}. */
  readonly headers: Headers;
  /** Every `Set-Cookie` header line, in order, unparsed. */
  readonly setCookies: readonly string[];
  readonly body: Buffer;
  /** The body decoded as UTF-8, for HTML and JSON responses. */
  text(): string;
  /** The body parsed as JSON. Throws when the body is not JSON — which is itself a finding. */
  json<T = unknown>(): T;
}

/** How a request is addressed and where it is actually delivered. */
export interface EdgeTarget {
  /** The origin the client believes it is talking to, e.g. `https://kwantle.test`. */
  readonly canonicalOrigin: string;
  /** The loopback port the application process listens on. Unused when {@link remote} is set. */
  readonly appPort: number;
  /**
   * Whether the canonical origin is a real host to dial rather than a loopback port to proxy onto.
   *
   * **The proxy translation is not skipped so much as it is already real.** Against a spawned
   * deployment this module *is* the reverse proxy: it dials loopback and supplies the `Host` and
   * forwarded headers a proxy would add. A remote deployment has its own proxy in front of it, so
   * supplying a second set of forwarded headers would be describing a hop that did not happen —
   * and `Host` is the real host by construction. The request therefore goes out as an ordinary
   * client's would, which is exactly what the assertions on that surface are about.
   */
  readonly remote?: boolean;
}

export interface EdgeRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Buffer;
}

/**
 * The public source address a proxy would report for the client.
 *
 * Anthropic publishes `160.79.104.0/21` as its connector egress range, so a request that claims to
 * come from it is the shape a deployment's WAF and rate limiters actually see. It is set for
 * fidelity only — nothing in this harness depends on the value being honoured.
 */
const FORWARDED_FOR = "160.79.104.10";

function normalizeHeaderName(name: string): string {
  return name.toLowerCase();
}

/**
 * Deliver one request to the application through the proxy shape it is deployed behind.
 *
 * The URL's origin must be the canonical origin — addressing the loopback port directly would skip
 * the very translation being modelled. Redirects are never followed: a redirect is a protocol
 * observation the caller asserts on, or a navigation the browser layer performs deliberately.
 *
 * @param target - Canonical origin and the loopback port behind it.
 * @param url - Absolute URL on the canonical origin.
 * @param init - Method, headers, and body; `Host` and the forwarded headers are supplied here.
 * @returns The unmodified response.
 * @throws Error when the URL is not on the canonical origin, or the socket fails.
 */
export function edgeRequest(
  target: EdgeTarget,
  url: string | URL,
  init: EdgeRequestInit = {},
): Promise<WireResponse> {
  const parsed = typeof url === "string" ? new URL(url) : url;
  if (parsed.origin !== target.canonicalOrigin) {
    throw new Error(
      `The conformance edge only serves ${target.canonicalOrigin}; refusing ${parsed.origin}. ` +
        "Addressing the application port directly would bypass the proxy translation under test.",
    );
  }

  const canonical = new URL(target.canonicalOrigin);
  // A remote deployment already sits behind its own proxy, so the forwarded set is omitted: adding
  // one would describe a hop that did not happen, and `Host` is the real host by construction.
  const headers: OutgoingHttpHeaders = target.remote
    ? { connection: "close" }
    : {
        // Preserved from the client's request, exactly as a reverse proxy preserves it. The MCP
        // endpoint compares this against its configured canonical host.
        host: canonical.host,
        "x-forwarded-proto": canonical.protocol.replace(":", ""),
        "x-forwarded-host": canonical.host,
        "x-forwarded-for": FORWARDED_FOR,
        connection: "close",
      };
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    headers[normalizeHeaderName(name)] = value;
  }
  const body =
    init.body === undefined
      ? undefined
      : Buffer.isBuffer(init.body)
        ? init.body
        : Buffer.from(init.body, "utf8");
  if (body) headers["content-length"] = String(body.byteLength);

  const secure = target.remote === true && canonical.protocol === "https:";
  const send = secure ? httpsRequest : httpRequest;
  return new Promise<WireResponse>((resolve, reject) => {
    const outgoing = send(
      {
        host: target.remote ? canonical.hostname : "127.0.0.1",
        port: target.remote
          ? (canonical.port === "" ? (secure ? 443 : 80) : Number(canonical.port))
          : target.appPort,
        method: (init.method ?? "GET").toUpperCase(),
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        // A fresh socket per request, never the pool. Node's global agent keeps sockets alive by
        // default while this transport announces `Connection: close`, so the agent can hand back a
        // socket the server is closing at that moment; the request lands on a half-closed
        // connection and Node's HTTP parser answers with a bare `400` and no body. That failure is
        // indistinguishable from a protocol refusal by the deployment, which makes it exactly the
        // kind of harness artefact that would get mis-filed as a conformance finding.
        agent: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const collected = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            if (name === "set-cookie") continue;
            collected.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const payload = Buffer.concat(chunks);
          resolve({
            status: incoming.statusCode ?? 0,
            headers: collected,
            setCookies: Object.freeze(incoming.headers["set-cookie"] ?? []),
            body: payload,
            text: () => payload.toString("utf8"),
            json: <T,>() => JSON.parse(payload.toString("utf8")) as T,
          });
        });
        incoming.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.setTimeout(30_000, () => {
      outgoing.destroy(new Error(`Edge request timed out: ${parsed.pathname}`));
    });
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

/**
 * Adapt {@link edgeRequest} to the WHATWG `fetch` signature an OAuth client library expects.
 *
 * `oauth4webapi` builds every request itself — it derives the well-known URL, chooses the method and
 * content type, and validates the response — so handing it this function means the library drives
 * the real deployment while the harness only supplies transport. That is the whole point of using it
 * rather than hand-writing the requests: the library has never read this repository's configuration,
 * so where it disagrees with us it is the specification talking.
 *
 * @param target - Canonical origin and the loopback port behind it.
 * @returns A `fetch`-shaped function suitable for `oauth4webapi`'s `customFetch` option.
 */
export function edgeFetch(target: EdgeTarget): typeof fetch {
  return async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers: Record<string, string> = {};
    new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    ).forEach((value, name) => {
      headers[name] = value;
    });
    const method =
      init.method ?? (input instanceof Request ? input.method : "GET");
    const body =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : undefined;
    if (init.body instanceof URLSearchParams && !headers["content-type"]) {
      headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    }
    const response = await edgeRequest(target, url, { method, headers, body });
    const outgoing = new Headers(response.headers);
    for (const cookie of response.setCookies) outgoing.append("set-cookie", cookie);
    // The bytes are handed over as text because every response this harness gives a client library
    // is JSON, form-encoded, or HTML. A `Buffer` is a `Uint8Array` view whose declared type is not
    // in `BodyInit`, and copying it into a fresh `ArrayBuffer` only to satisfy that is noise.
    const bytes = response.text();
    return new Response(response.status === 204 ? null : bytes, {
      status: response.status,
      headers: outgoing,
    });
  };
}
