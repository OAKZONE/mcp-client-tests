/**
 * A loopback HTTPS origin the *server under test* fetches client documents from.
 *
 * Two of the things an authorization server does on a client's behalf require it to make an outbound
 * request of its own, and neither can be exercised by a test that only speaks to the server's
 * inbound side:
 *
 * - **A Client ID Metadata Document.** The `client_id` IS an HTTPS URL, and the authorization server
 *   fetches it to learn the client's redirect URIs and token-endpoint auth method. Both covered
 *   vendors elect CIMD before dynamic registration, so a harness that cannot host one can only ever
 *   test the path neither vendor takes first.
 * - **A client JWKS.** `private_key_jwt` client authentication is verified against a key set the
 *   client publishes, which for ChatGPT lives on the CIMD metadata origin.
 *
 * **The documents are served over real TLS**, because the CIMD specification requires the `client_id`
 * to use the `https` scheme and `oidc-provider` enforces that before it will fetch anything. The
 * certificate comes from a per-run authority (`tls-certificate.ts`) that the server under test trusts
 * through `NODE_EXTRA_CA_CERTS`; verification is fully enabled on both ends.
 *
 * **Two listeners, deliberately.** Documents are served on HTTPS — that is the surface under test.
 * Registration is a separate plain-HTTP control listener, because it is harness plumbing crossing a
 * process boundary (the host starts in the Vitest main process, documents are published by workers)
 * and giving it its own port keeps it impossible to confuse the two.
 */

import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";

import { createLoopbackTlsMaterial } from "./tls-certificate.js";

/** What the host returns for one registered path. */
export interface HostedDocument {
  readonly status?: number;
  readonly contentType?: string;
  /** The exact bytes to serve. Registered as a string so a malformed document can be modelled. */
  readonly body: string;
}

/** Publication controls, usable from any process. */
export interface DocumentPublisher {
  /** The HTTPS origin the server under test fetches from. */
  readonly origin: string;
  /** Absolute HTTPS URL for a path on this host. */
  url(documentPath: string): string;
  /** Publish (or replace) the document served at `documentPath`. */
  publish(documentPath: string, document: HostedDocument): Promise<void>;
  /** Stop serving `documentPath`; subsequent fetches answer 404. */
  withdraw(documentPath: string): Promise<void>;
}

export interface DocumentHost extends DocumentPublisher {
  /** The plain-HTTP control origin publication requests are sent to. */
  readonly controlOrigin: string;
  /** The authority the server under test must trust, PEM encoded. */
  readonly caCertificatePem: string;
  /** How many times each path has been fetched, so a caching claim can be checked. */
  fetchCount(documentPath: string): number;
  close(): Promise<void>;
}

function normalizePath(rawPath: string): string {
  return rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
}

async function listen(server: Server | HttpsServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/**
 * Start the loopback document origin and its control listener.
 *
 * @returns A handle exposing both origins, the CA to trust, and publication controls.
 */
export async function startDocumentHost(): Promise<DocumentHost> {
  const documents = new Map<string, HostedDocument>();
  const fetches = new Map<string, number>();
  const tls = createLoopbackTlsMaterial();

  const documentServer = createHttpsServer(
    { key: tls.serverKeyPem, cert: tls.serverCertificatePem },
    (request, response) => {
      const documentPath = normalizePath((request.url ?? "/").split("?")[0]);
      fetches.set(documentPath, (fetches.get(documentPath) ?? 0) + 1);
      const document = documents.get(documentPath);
      if (!document) {
        response.statusCode = 404;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      response.statusCode = document.status ?? 200;
      response.setHeader("content-type", document.contentType ?? "application/json");
      // No caching here: a test that replaces a document mid-flow must see it take effect, and any
      // caching the AUTHORIZATION SERVER performs is behaviour under test, not ours to influence.
      response.setHeader("cache-control", "no-store");
      response.end(document.body);
    },
  );

  const controlServer = createHttpServer((request, response) => {
    if (request.method !== "PUT") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const documentPath = normalizePath((request.url ?? "/").split("?")[0]);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const parsed = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as HostedDocument | null;
        if (parsed === null) documents.delete(documentPath);
        else documents.set(documentPath, parsed);
        response.statusCode = 204;
        response.end();
      } catch {
        response.statusCode = 400;
        response.end();
      }
    });
  });

  const documentPort = await listen(documentServer);
  const controlPort = await listen(controlServer);
  const origin = `https://127.0.0.1:${documentPort}`;
  const controlOrigin = `http://127.0.0.1:${controlPort}`;
  const publisher = connectDocumentHost(origin, controlOrigin);

  return {
    ...publisher,
    controlOrigin,
    caCertificatePem: tls.caCertificatePem,
    fetchCount: (documentPath) => fetches.get(normalizePath(documentPath)) ?? 0,
    close: async () => {
      await Promise.all(
        [documentServer, controlServer].map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
            }),
        ),
      );
    },
  };
}

/**
 * Control a document host started in another process.
 *
 * The host must exist before the server under test boots — its origin is part of that process's
 * environment — so it starts in the Vitest main process while documents are published by the workers
 * that run the suites. Registration therefore crosses a process boundary, which is why it is an HTTP
 * request rather than a method call.
 *
 * @param origin - The HTTPS origin documents are served from.
 * @param controlOrigin - The plain-HTTP origin registrations are sent to.
 * @returns Publication controls.
 */
export function connectDocumentHost(
  origin: string,
  controlOrigin: string,
): DocumentPublisher {
  const control = async (rawPath: string, body: string): Promise<void> => {
    const response = await fetch(`${controlOrigin}${normalizePath(rawPath)}`, {
      method: "PUT",
      body,
      headers: { "content-type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Document host refused a registration for ${rawPath}`);
    }
  };
  return {
    origin,
    url: (documentPath) => `${origin}${normalizePath(documentPath)}`,
    publish: (documentPath, document) => control(documentPath, JSON.stringify(document)),
    withdraw: (documentPath) => control(documentPath, "null"),
  };
}
