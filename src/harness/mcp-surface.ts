/**
 * What a published MCP surface must and should carry, as pure functions over what came off the wire.
 *
 * **Why these are separated from the suites that use them.** Each is a small judgement the
 * specification makes — is this tool name in the published vocabulary, does this icon load, are the
 * caching hints present — and a defect in one would make every consumer's run assert the wrong
 * thing *quietly*, reported as a finding about their server. They live here so they can be tested
 * in isolation in `harness.test.ts`, which is what stops this package from reporting its own bugs
 * as somebody else's.
 *
 * **Two of them read tolerantly on purpose.** {@link readCachingHints} and {@link serverIdentity}
 * accept the field at the result's top level or inside its `_meta`, because the revision moved
 * server identity onto `server/discover` plus each result's `_meta` and the distilled sources this
 * package is written from do not fix the placement. Reading both and *reporting which* is how a
 * suite avoids inventing a requirement it cannot cite: a server that carries the fields anywhere a
 * client can find them is not reported as missing them.
 */

/** The characters a tool name may use, per the tools contract. */
const TOOL_NAME_CHARACTERS = /^[A-Za-z0-9_.-]+$/;

/** The longest tool name the specification names. */
export const TOOL_NAME_MAX_LENGTH = 128;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Say what is wrong with a tool name, in the specification's own terms.
 *
 * A name outside the published vocabulary is not cosmetic: clients namespace tool names into their
 * own identifiers, and a character the specification excludes is one some client's parser, router,
 * or prompt template is entitled to choke on.
 *
 * @param name - The `name` a tool published.
 * @returns What is wrong with it, or undefined when nothing is.
 */
export function toolNameProblem(name: unknown): string | undefined {
  if (typeof name !== "string" || name.length === 0) {
    return "is not a non-empty string";
  }
  if (name.length > TOOL_NAME_MAX_LENGTH) {
    return `is ${name.length} characters, past the ${TOOL_NAME_MAX_LENGTH} the contract names`;
  }
  if (!TOOL_NAME_CHARACTERS.test(name)) {
    const offending = [...new Set([...name])].filter(
      (character) => !TOOL_NAME_CHARACTERS.test(character),
    );
    return (
      `uses ${offending.map((character) => JSON.stringify(character)).join(", ")}, ` +
      "outside the permitted `A-Z a-z 0-9 _ - .`"
    );
  }
  return undefined;
}

/**
 * The names published more than once.
 *
 * Uniqueness within a server is what makes a tool addressable at all; a duplicate means one of the
 * two can never be called, and which one is a race between implementations.
 *
 * @param names - Every published tool name, in order.
 * @returns Each duplicated name once, in first-seen order.
 */
export function duplicateToolNames(names: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string") continue;
    if (seen.has(name)) duplicated.add(name);
    seen.add(name);
  }
  return [...duplicated];
}

/**
 * Say what is wrong with a tool's `inputSchema`.
 *
 * The schema is what a model fills in. `null`, a bare boolean, or a schema that does not describe
 * an object leaves every client to guess a call shape, which they do differently.
 *
 * @param schema - The published `inputSchema`.
 * @returns What is wrong with it, or undefined when nothing is.
 */
export function inputSchemaProblem(schema: unknown): string | undefined {
  if (schema === undefined) return "is absent";
  if (schema === null) return "is null, which the contract forbids explicitly";
  const record = asRecord(schema);
  if (!record) {
    return `is ${Array.isArray(schema) ? "an array" : typeof schema}, not a JSON Schema object`;
  }
  if (record.type !== "object") {
    return (
      `declares type ${JSON.stringify(record.type ?? null)}, but tool arguments are an object — ` +
      'a parameterless tool publishes { "type": "object" }, never an empty or absent schema'
    );
  }
  return undefined;
}

/** The freshness hints a cacheable result carries, and where they were found. */
export interface CachingHints {
  /** Freshness in milliseconds; `0` means always stale. Absent means the client assumes `0`. */
  readonly ttlMs?: number;
  /** `public` or `private`. A public result may be served across authorization contexts. */
  readonly cacheScope?: string;
  /** Which envelope carried them, so a report can say `_meta` rather than "absent". */
  readonly carriedIn: "result" | "_meta" | "absent";
}

function pickHints(
  source: Record<string, unknown>,
): { ttlMs?: number; cacheScope?: string } | undefined {
  const ttlMs = typeof source.ttlMs === "number" ? source.ttlMs : undefined;
  const cacheScope = typeof source.cacheScope === "string" ? source.cacheScope : undefined;
  return ttlMs === undefined && cacheScope === undefined ? undefined : { ttlMs, cacheScope };
}

/**
 * Read a result's caching hints from wherever it carries them.
 *
 * @param result - A JSON-RPC result.
 * @returns The hints found, and the envelope they came from.
 */
export function readCachingHints(result: unknown): CachingHints {
  const record = asRecord(result);
  if (!record) return { carriedIn: "absent" };
  const direct = pickHints(record);
  if (direct) return { ...direct, carriedIn: "result" };
  const meta = asRecord(record._meta);
  const nested = meta ? pickHints(meta) : undefined;
  if (nested) return { ...nested, carriedIn: "_meta" };
  return { carriedIn: "absent" };
}

/** A server's own identity, as published, and where it was found. */
export interface ServerIdentity {
  /** The identity object verbatim — `name`, `title`, `version`, `websiteUrl`, `icons`, … */
  readonly fields: Readonly<Record<string, unknown>>;
  /** The path it was read from, so a report can say where a missing field belongs. */
  readonly carriedIn: string;
}

/**
 * The `_meta` key server identity rides on revision `2026-07-28`.
 *
 * There is no `serverInfo` field on a `server/discover` result: the revision moved identity into
 * each result's `_meta`, and this is the key it uses. Verified against the reference implementation
 * and observed on the wire.
 */
export const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";

/**
 * Find the server's published identity in a result.
 *
 * Two locations, both real, checked in revision order: `_meta` on `2026-07-28`, and the top-level
 * `serverInfo` an `initialize` result carries on `2025-11-25`. Nothing else is guessed at — a
 * speculative third location would only turn a missing identity into a silently wrong one.
 *
 * @param result - A `server/discover` or `initialize` result.
 * @returns The identity and where it was found, or undefined when the result carries none.
 */
export function serverIdentity(result: unknown): ServerIdentity | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  const fromMeta = asRecord(asRecord(record._meta)?.[SERVER_INFO_META_KEY]);
  if (fromMeta) return { fields: fromMeta, carriedIn: `_meta["${SERVER_INFO_META_KEY}"]` };
  const legacy = asRecord(record.serverInfo);
  if (legacy) return { fields: legacy, carriedIn: "serverInfo" };
  return undefined;
}

/**
 * The protocol revisions a `server/discover` result advertises.
 *
 * @param result - The `server/discover` result.
 * @returns Every advertised revision; an empty list when none is published.
 */
export function advertisedVersions(result: unknown): readonly string[] {
  const record = asRecord(result);
  const versions = record?.supportedVersions ?? asRecord(record?._meta)?.supportedVersions;
  if (!Array.isArray(versions)) return [];
  return versions.filter((version): version is string => typeof version === "string");
}

/**
 * Say why an icon would not load.
 *
 * The constraint that decides this is not in the protocol document: the one client documented to
 * render `icons[]` requires an HTTP server's icons to come from the same authority as the server
 * itself, allowing `file://` only for stdio servers and `data:` for anyone. An icon on a CDN or a
 * marketing domain therefore fails silently — no error, no fallback, just no icon.
 *
 * @param src - The icon's `src`.
 * @param serverOrigin - The origin the MCP server is served from.
 * @returns Why it would not load, or undefined when it would.
 */
export function iconSourcingProblem(
  src: unknown,
  serverOrigin: string,
): string | undefined {
  if (typeof src !== "string" || src.length === 0) return "has no `src`";
  if (src.startsWith("data:")) return undefined;
  if (src.startsWith("file:")) {
    return "is a `file://` URI, offered to stdio servers only — this server is served over HTTP";
  }
  let origin: string;
  let resolved: URL;
  try {
    origin = new URL(serverOrigin).origin;
    resolved = new URL(src, serverOrigin);
  } catch {
    return `is not a URL: ${String(src)}`;
  }
  if (resolved.origin === origin) return undefined;
  return (
    `is served from ${resolved.origin}, not from the server's own authority ${origin} — ` +
    "host it on the server's origin or inline it as a `data:` URI"
  );
}

/**
 * The `icons[]` an identity, tool, prompt, or resource published.
 *
 * @param published - The object that may carry icons.
 * @returns Each icon entry that is an object; an empty list when there are none.
 */
export function publishedIcons(
  published: unknown,
): readonly Record<string, unknown>[] {
  const icons = asRecord(published)?.icons;
  if (!Array.isArray(icons)) return [];
  return icons
    .map(asRecord)
    .filter((icon): icon is Record<string, unknown> => icon !== undefined);
}

/**
 * A result's `resultType`, from wherever it carries it.
 *
 * @param result - A JSON-RPC result.
 * @returns The declared type, or undefined when none is published.
 */
export function resultTypeOf(result: unknown): string | undefined {
  const record = asRecord(result);
  if (!record) return undefined;
  if (typeof record.resultType === "string") return record.resultType;
  const meta = asRecord(record._meta);
  return typeof meta?.resultType === "string" ? meta.resultType : undefined;
}
