/**
 * A throwaway certificate authority, so the harness can serve `https` on loopback.
 *
 * **Why this is not optional.** A Client ID Metadata Document's `client_id` **MUST** use the `https`
 * scheme — the CIMD specification says so and `oidc-provider` enforces it before it will even
 * attempt a fetch. So a harness that hosts a client's metadata over plain HTTP cannot exercise CIMD
 * at all, and CIMD is the registration path both covered vendors elect first. Relaxing the scheme
 * check in the server under test would be worse than useless: it would make the suite pass against a
 * deployment that no real client can use.
 *
 * **Why it is written out rather than installed.** Node ships certificate *parsing*
 * (`crypto.X509Certificate`) and no certificate *generation*, and a dependency that exists only to
 * make a test possible is a dependency the whole project then carries. The structures below are
 * plain DER per the X.509 definition, and they are exercised on every conformance run, so a mistake
 * here fails loudly and immediately rather than rotting.
 *
 * The authority is generated per run, lives in memory and one temp file, and is trusted by the
 * server under test through `NODE_EXTRA_CA_CERTS` — the same mechanism an enterprise uses for an
 * internal CA. Nothing here weakens TLS verification: the server performs full chain and hostname
 * validation against a CA that exists for the lifetime of one test run.
 *
 * References:
 * - X.509 / PKIX certificate and CRL profile — <https://www.rfc-editor.org/rfc/rfc5280>
 *   (§4.1 Certificate fields, §4.2.1.6 Subject Alternative Name, §4.2.1.9 Basic Constraints)
 * - ECDSA with SHA-256 signature OID — <https://www.rfc-editor.org/rfc/rfc5758#section-3.2>
 */

import {
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

/** DER: tag, definite length, content (X.690 §8.1). */
function derEncode(tag: number, content: Buffer): Buffer {
  if (content.length < 0x80) {
    return Buffer.concat([Buffer.from([tag, content.length]), content]);
  }
  const lengthBytes: number[] = [];
  let remaining = content.length;
  while (remaining > 0) {
    lengthBytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.concat([
    Buffer.from([tag, 0x80 | lengthBytes.length, ...lengthBytes]),
    content,
  ]);
}

const sequence = (...parts: Buffer[]): Buffer =>
  derEncode(0x30, Buffer.concat(parts));
const setOf = (...parts: Buffer[]): Buffer =>
  derEncode(0x31, Buffer.concat(parts));
const octetString = (content: Buffer): Buffer => derEncode(0x04, content);
const utf8String = (value: string): Buffer =>
  derEncode(0x0c, Buffer.from(value, "utf8"));
const boolean = (value: boolean): Buffer =>
  derEncode(0x01, Buffer.from([value ? 0xff : 0x00]));
/** Context-specific, constructed, EXPLICIT tagging. */
const explicit = (number: number, content: Buffer): Buffer =>
  derEncode(0xa0 | number, content);
/** Context-specific, primitive, IMPLICIT tagging (used by GeneralName alternatives). */
const implicitPrimitive = (number: number, content: Buffer): Buffer =>
  derEncode(0x80 | number, content);

/** DER INTEGER; a leading zero is prepended when the high bit would read as negative. */
function integer(value: Buffer): Buffer {
  const trimmed = value[0] === 0 && value.length > 1 ? value.subarray(1) : value;
  return derEncode(
    0x02,
    trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed,
  );
}

/** DER BIT STRING with an explicit unused-bit count. */
function bitString(content: Buffer, unusedBits = 0): Buffer {
  return derEncode(0x03, Buffer.concat([Buffer.from([unusedBits]), content]));
}

/** DER OBJECT IDENTIFIER from dotted notation (X.690 §8.19). */
function objectIdentifier(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunks: number[] = [part & 0x7f];
    let remaining = part >> 7;
    while (remaining > 0) {
      chunks.unshift((remaining & 0x7f) | 0x80);
      remaining >>= 7;
    }
    bytes.push(...chunks);
  }
  return derEncode(0x06, Buffer.from(bytes));
}

/** DER UTCTime, `YYMMDDHHMMSSZ` (valid until 2049; ample for a per-run authority). */
function utcTime(date: Date): Buffer {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const text =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  return derEncode(0x17, Buffer.from(text, "ascii"));
}

/** A distinguished name carrying only a common name, which is all a test authority needs. */
function distinguishedName(commonName: string): Buffer {
  return sequence(
    setOf(sequence(objectIdentifier("2.5.4.3"), utf8String(commonName))),
  );
}

/** `ecdsa-with-SHA256`; the parameters field is absent for this algorithm. */
const ECDSA_SHA256 = sequence(objectIdentifier("1.2.840.10045.4.3.2"));

function extension(oid: string, critical: boolean, value: Buffer): Buffer {
  return sequence(
    objectIdentifier(oid),
    ...(critical ? [boolean(true)] : []),
    octetString(value),
  );
}

/** RFC 5280 §4.2.1.9 — a certification authority. */
const BASIC_CONSTRAINTS_CA = extension(
  "2.5.29.19",
  true,
  sequence(boolean(true)),
);

/** RFC 5280 §4.2.1.9 — an end-entity certificate. */
const BASIC_CONSTRAINTS_LEAF = extension("2.5.29.19", true, sequence());

/** RFC 5280 §4.2.1.3 — `keyCertSign` and `cRLSign` for the authority. */
const KEY_USAGE_CA = extension(
  "2.5.29.15",
  true,
  bitString(Buffer.from([0x06]), 1),
);

/** RFC 5280 §4.2.1.3 — `digitalSignature` and `keyEncipherment` for a TLS server. */
const KEY_USAGE_LEAF = extension(
  "2.5.29.15",
  true,
  bitString(Buffer.from([0xa0]), 5),
);

/** RFC 5280 §4.2.1.12 — `id-kp-serverAuth`. */
const EXTENDED_KEY_USAGE_SERVER = extension(
  "2.5.29.37",
  false,
  sequence(objectIdentifier("1.3.6.1.5.5.7.3.1")),
);

/**
 * RFC 5280 §4.2.1.6 — the names this certificate is valid for.
 *
 * Both the IP literal and `localhost` are present because the document origin is addressed by IP
 * while a future consumer of this harness may prefer the name, and a certificate that only covers
 * one of them fails hostname verification with an error that reads like a trust problem.
 */
function subjectAlternativeName(): Buffer {
  return extension(
    "2.5.29.17",
    false,
    sequence(
      // dNSName [2] IMPLICIT IA5String
      implicitPrimitive(2, Buffer.from("localhost", "ascii")),
      // iPAddress [7] IMPLICIT OCTET STRING
      implicitPrimitive(7, Buffer.from([127, 0, 0, 1])),
    ),
  );
}

function pemEncode(label: string, der: Buffer): string {
  const body = der.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function buildCertificate(options: {
  readonly subject: string;
  readonly issuer: string;
  readonly subjectPublicKey: KeyObject;
  readonly issuerPrivateKey: KeyObject;
  readonly extensions: readonly Buffer[];
}): Buffer {
  const now = new Date();
  const tbs = sequence(
    // version — v3 is the integer 2, EXPLICITly tagged [0]
    explicit(0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    ECDSA_SHA256,
    distinguishedName(options.issuer),
    sequence(
      // Backdated an hour so a clock skew between the test process and the server under test
      // cannot make a freshly minted certificate "not yet valid".
      utcTime(new Date(now.getTime() - 60 * 60 * 1000)),
      utcTime(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    ),
    distinguishedName(options.subject),
    options.subjectPublicKey.export({ type: "spki", format: "der" }),
    explicit(3, sequence(...options.extensions)),
  );
  const signature = sign("sha256", tbs, options.issuerPrivateKey);
  return sequence(tbs, ECDSA_SHA256, bitString(signature));
}

/** A per-run authority and the server credential it issued. */
export interface LoopbackTlsMaterial {
  /** PEM certificate authority, for `NODE_EXTRA_CA_CERTS`. */
  readonly caCertificatePem: string;
  /** PEM server certificate, for `tls.createServer`. */
  readonly serverCertificatePem: string;
  /** PEM server private key. */
  readonly serverKeyPem: string;
}

/**
 * Mint a certificate authority and a loopback server certificate it signed.
 *
 * @returns The CA certificate and the server credential, all PEM encoded.
 */
export function createLoopbackTlsMaterial(): LoopbackTlsMaterial {
  const authority = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const server = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  const caCertificate = buildCertificate({
    subject: "Kwantle Conformance Harness CA",
    issuer: "Kwantle Conformance Harness CA",
    subjectPublicKey: authority.publicKey,
    issuerPrivateKey: authority.privateKey,
    extensions: [BASIC_CONSTRAINTS_CA, KEY_USAGE_CA],
  });

  const serverCertificate = buildCertificate({
    subject: "localhost",
    issuer: "Kwantle Conformance Harness CA",
    subjectPublicKey: server.publicKey,
    issuerPrivateKey: authority.privateKey,
    extensions: [
      BASIC_CONSTRAINTS_LEAF,
      KEY_USAGE_LEAF,
      EXTENDED_KEY_USAGE_SERVER,
      subjectAlternativeName(),
    ],
  });

  return {
    caCertificatePem: pemEncode("CERTIFICATE", caCertificate),
    serverCertificatePem: pemEncode("CERTIFICATE", serverCertificate),
    serverKeyPem: server.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}
