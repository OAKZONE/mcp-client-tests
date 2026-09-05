/**
 * What stands between a published tool and its execution, as pure functions over what came off the
 * wire.
 *
 * **The question this file answers is not the one the rest of the package asks.** The OAuth family
 * asks whether a client can *reach* this server; the protocol family asks what it *finds* when it
 * gets there. This one asks the question a working, authorized, correctly-versioned server still
 * fails: **will the client actually let the model call your tool?**
 *
 * Between `tools/list` and execution sit five layers the client owns, and a call can die at any of
 * them without a message that reaches the server:
 *
 * 1. **Admission** — may this server run here at all? An organization policy can refuse the
 *    connection, and on one client that policy is *off by default* for the subscribers it covers.
 * 2. **Enablement** — is your tool in the list the model receives? Caps, per-tool toggles,
 *    org-level per-tool blocks, and client-side schema validation all remove tools here, mostly
 *    silently.
 * 3. **Approval** — does a human confirm the call?
 * 4. **Classification** — a safety model may veto the call after approval policy said yes.
 * 5. **Content scanning** — descriptions and results are inspected as untrusted text.
 *
 * **Only layer 3 is steerable from the wire, and `annotations` is the whole steering mechanism.**
 * Everything else is configured on the client and is invisible from here — which is exactly why the
 * checks below are worth running: they cover the part a server can actually fix, and they name the
 * part it cannot so a consumer stops debugging their own endpoint.
 *
 * ## What may fail a run, and what may only advise
 *
 * The split is mechanical, and it is the grade on the clause rather than anyone's judgement.
 * `cite()` refuses a clause graded below `strong`, so a community-reported tool ceiling is
 * *structurally unable* to turn a consumer's run red. What survives as an assertion is the small
 * set of facts a vendor states outright: a name length, a schema a client validates and drops on, a
 * read/write split a review rejects, and an attack signature with no legitimate use.
 *
 * Each function returns a **sentence naming the consequence**, not a boolean, because a finding
 * that says "fails check 4" costs the reader a trip into this file to learn what to do.
 */

import { TOOL_NAME_MAX_LENGTH } from "./mcp-surface.js";

/**
 * The tool-name budget a server should design to, which is **not** the specification's.
 *
 * The specification says 1–128 characters. Anthropic's connector review criteria state the limit
 * flatly at 64, and a field report has a longer name failing the *whole server connection* rather
 * than the one tool. So the shorter number is the one to build against, and the namespace prefix a
 * client adds is charged against it.
 */
export const CLIENT_TOOL_NAME_BUDGET = 64;

/** The characters a top-level schema property may use before one client drops the tool. */
const SCHEMA_PROPERTY_CHARACTERS = /^[A-Za-z0-9_.-]+$/;

/** The longest a top-level schema property name may be before that same check drops the tool. */
const SCHEMA_PROPERTY_MAX_LENGTH = 64;

/** HTTP methods a review treats as safe: they read and do not change state. */
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** HTTP methods a review treats as unsafe: they create, replace, modify, or delete. */
const UNSAFE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The JSON Schema keywords a client is documented to flatten when they sit at the schema root. */
const ROOT_COMBINATORS = ["allOf", "anyOf", "oneOf"] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The hints a client's gate reads, as published.
 *
 * Every field is optional because every field genuinely may be absent — and the absence is the
 * finding, not a gap to fill with a default. The specification's stated defaults for an unannotated
 * tool are *non-read-only, potentially destructive, non-idempotent and open-world*, so anything
 * this type filled in would be the opposite of what the gate assumes.
 */
export interface ToolAnnotations {
  /** The human-readable name an approval dialog shows instead of the snake_case symbol. */
  readonly title?: string;
  /** True only when the call cannot change state anywhere. */
  readonly readOnlyHint?: boolean;
  /** True on anything that modifies or deletes. */
  readonly destructiveHint?: boolean;
  /** Whether a retry with identical arguments is safe. */
  readonly idempotentHint?: boolean;
  /** False when the tool's domain is closed. */
  readonly openWorldHint?: boolean;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Read a tool's `annotations`, from the object the tools contract puts them in.
 *
 * `title` is read from **both** the tool's own top level and its `annotations`, because the tools
 * contract carries a tool-level `title` while the review criteria discuss it alongside the hints. A
 * server that publishes it in either place has published it, and reporting otherwise would be a
 * false finding.
 *
 * @param tool - A tool as published by `tools/list`.
 * @returns The hints found, or undefined when the tool publishes no `annotations` object at all —
 *   which is the distinction the whole gate turns on, and is why this returns undefined rather than
 *   an empty object.
 */
export function readToolAnnotations(tool: unknown): ToolAnnotations | undefined {
  const record = asRecord(tool);
  if (!record) return undefined;
  const annotations = asRecord(record.annotations);
  const title =
    typeof record.title === "string"
      ? record.title
      : typeof annotations?.title === "string"
        ? annotations.title
        : undefined;
  if (!annotations) return title === undefined ? undefined : { title };
  return {
    title,
    readOnlyHint: booleanOrUndefined(annotations.readOnlyHint),
    destructiveHint: booleanOrUndefined(annotations.destructiveHint),
    idempotentHint: booleanOrUndefined(annotations.idempotentHint),
    openWorldHint: booleanOrUndefined(annotations.openWorldHint),
  };
}

/**
 * Say what a tool's gate reads when it carries no usable hint at all.
 *
 * **Unannotated is not neutral; it is maximally suspicious.** The specification's stated defaults
 * assume an unannotated tool is non-read-only, potentially destructive, non-idempotent and
 * open-world, and shipping clients act on exactly that: one treats it as a write and confirms every
 * call, another withholds auto-permission, and a profile on a third can refuse it with no prompt.
 *
 * A tool declaring *any* of the four hints has told the gate something, so only a total absence is
 * reported here. Whether the hints are **true** is not knowable from the wire and is never claimed.
 *
 * @param tool - A tool as published.
 * @returns What is absent and what the gate concludes from it, or undefined when at least one hint
 *   is published.
 */
export function annotationProblem(tool: unknown): string | undefined {
  const annotations = readToolAnnotations(tool);
  const declared =
    annotations !== undefined &&
    (annotations.readOnlyHint !== undefined ||
      annotations.destructiveHint !== undefined ||
      annotations.idempotentHint !== undefined ||
      annotations.openWorldHint !== undefined);
  if (declared) return undefined;
  return (
    "publishes no behavioural hint, so every gate reads the specification's default — " +
    "non-read-only, potentially destructive, non-idempotent and open-world — and treats it as the " +
    "most dangerous thing the server could have shipped"
  );
}

/**
 * Say why a tool has no human-readable `title`.
 *
 * The `title` is what an approval dialog shows in place of the symbol, so its absence is not
 * cosmetic: it is the difference between a user approving `create_deployment` and approving
 * `svc_dpl_create_v2`. The review criteria require it.
 *
 * @param tool - A tool as published.
 * @returns What is absent, or undefined when a non-empty title is published.
 */
export function titleProblem(tool: unknown): string | undefined {
  const title = readToolAnnotations(tool)?.title;
  if (typeof title === "string" && title.trim().length > 0) return undefined;
  return (
    "publishes no `title`, so every approval dialog shows the raw symbol — the name a user " +
    "accepts or declines is the one the server chose for its code, not for them"
  );
}

/**
 * Say why a tool's hints cannot all be true at once.
 *
 * A tool declaring both `readOnlyHint: true` and `destructiveHint: true` has told the gate that it
 * cannot change state *and* that it modifies or deletes. One of those is false, and a client
 * resolving the contradiction in the server's favour is the one outcome nobody should want.
 *
 * @param tool - A tool as published.
 * @returns What contradicts what, or undefined when the hints are consistent.
 */
export function contradictoryHintProblem(tool: unknown): string | undefined {
  const annotations = readToolAnnotations(tool);
  if (!annotations) return undefined;
  if (annotations.readOnlyHint === true && annotations.destructiveHint === true) {
    return (
      "declares both `readOnlyHint: true` and `destructiveHint: true` — it cannot both be unable " +
      "to change state and modify or delete, and a client is entitled to resolve that either way"
    );
  }
  return undefined;
}

/**
 * Say why a tool name that the specification permits will still cost the server.
 *
 * Separate from {@link toolNameProblem} in `mcp-surface.ts`, which enforces the specification's
 * 1–128 vocabulary. This is the tighter budget one client publishes and another is reported to
 * enforce by failing the entire connection.
 *
 * @param name - The `name` a tool published.
 * @returns What is over budget, or undefined when the name fits. A name already illegal by the
 *   specification's own rule is left to that check rather than reported twice.
 */
export function toolNameBudgetProblem(name: unknown): string | undefined {
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (name.length > TOOL_NAME_MAX_LENGTH) return undefined;
  if (name.length <= CLIENT_TOOL_NAME_BUDGET) return undefined;
  return (
    `is ${name.length} characters — inside the specification's ${TOOL_NAME_MAX_LENGTH} but past ` +
    `the ${CLIENT_TOOL_NAME_BUDGET} a shipping client publishes as its limit, where an over-long ` +
    "name is reported to fail the whole server connection rather than the one tool"
  );
}

/**
 * The values a schema property enumerates, when it enumerates any.
 *
 * @param property - One `properties` entry.
 * @returns Its `enum` as strings, or an empty list.
 */
function enumeratedStrings(property: unknown): readonly string[] {
  const values = asRecord(property)?.enum;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}

/**
 * Say why a tool spanning read and write cannot be annotated truthfully.
 *
 * **The named rejection.** A single entry point accepting both safe (`GET`, `HEAD`, `OPTIONS`) and
 * unsafe (`POST`, `PUT`, `PATCH`, `DELETE`) methods carries neither hint honestly, so it is gated
 * as destructive even on its read paths — and a review rejects it, naming a catch-all
 * `api_request` with a `method` parameter explicitly. Documenting the difference inside the
 * description does not satisfy the requirement.
 *
 * **Detection is deliberately narrow.** Only an enumeration of HTTP methods spanning both classes
 * is reported, because that is the shape the source names. A generic `action` or `operation` enum
 * is not flagged: deciding which of somebody's verbs are state-changing would be this package
 * guessing, and a guess that fails a run is exactly what turns a conformance gate off.
 *
 * @param tool - A tool as published.
 * @returns Which parameter spans both classes and which values do it, or undefined when none does.
 */
export function mixedReadWriteProblem(tool: unknown): string | undefined {
  const properties = asRecord(asRecord(tool)?.inputSchema)?.properties;
  const record = asRecord(properties);
  if (!record) return undefined;
  for (const [parameter, property] of Object.entries(record)) {
    const values = enumeratedStrings(property).map((value) => value.toUpperCase());
    const safe = values.filter((value) => SAFE_HTTP_METHODS.has(value));
    const unsafe = values.filter((value) => UNSAFE_HTTP_METHODS.has(value));
    if (safe.length > 0 && unsafe.length > 0) {
      return (
        `takes \`${parameter}\` enumerating both safe (${safe.join(", ")}) and unsafe ` +
        `(${unsafe.join(", ")}) HTTP methods, so no hint describes it honestly — it is gated as ` +
        "destructive on its read paths, and a directory review rejects it rather than accepting a " +
        "description that explains the difference"
      );
    }
  }
  return undefined;
}

/**
 * Code-point ranges that render as nothing, and are the published concealment vector.
 *
 * **Written as numbers rather than as a character class on purpose.** A literal zero-width
 * character in this file would be invisible in this file too: nobody could see what the check
 * matches, and an edit could add or drop one silently. Escapes would read better but are the same
 * hazard one copy-paste later. Numbers cannot be mistyped invisibly.
 *
 * The ranges are the zero-width and bidirectional controls: `U+200B`–`U+200F` (zero-width space,
 * the joiners, the directional marks), `U+202A`–`U+202E` (bidi embeddings and overrides),
 * `U+2060`–`U+2064` (word joiner and the invisible operators), `U+2066`–`U+2069` (bidi isolates),
 * and `U+FEFF` (the byte-order mark, reused as a zero-width no-break space).
 */
const CONCEALED_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

/**
 * Whether text carries a character that renders as nothing.
 *
 * @param text - The text to inspect.
 * @returns True when at least one code point falls in {@link CONCEALED_RANGES}.
 */
function carriesConcealedCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (CONCEALED_RANGES.some(([low, high]) => code >= low && code <= high)) {
      return true;
    }
  }
  return false;
}

/** An HTML comment carrying text, the other half of the concealment shape. */
const HTML_COMMENT = /<!--([\s\S]*?)-->/;

/** The injection idiom: overriding whatever the model was told before. */
const OVERRIDE_IDIOM =
  /\b(ignore|disregard|override|forget)\b[^.]{0,40}\b(previous|prior|earlier|above|all|other|any)\b[^.]{0,30}\b(instruction|instructions|prompt|prompts|tool|tools|rule|rules|direction|directions)\b/i;

/**
 * Say why a description would be read as an attack rather than as guidance.
 *
 * **Only the concealed and the overriding are reported here**, because those are the two shapes
 * with no legitimate use in a description that merely describes: text a user cannot see but a
 * model reads, and text instructing the model to discard what it was told. Both are the published
 * tool-poisoning attack rather than an approximation of it.
 *
 * Everything softer — "always call this one first", a second-person imperative aimed at the
 * assistant — is left to {@link instructionShapedDescription}, which advises. The reason for the
 * line sitting exactly there is that a *legitimate* cross-tool reference is something the tool
 * design rules positively ask for ("copy one from `list_markets`"), and a matcher that cannot tell
 * that from steering would fail correct servers. A conformance gate that cries wolf gets switched
 * off, and then it catches nothing at all.
 *
 * @param description - The `description` a tool published.
 * @returns What was found and why it is treated as hostile, or undefined when nothing was.
 */
export function concealedInstructionProblem(
  description: unknown,
): string | undefined {
  if (typeof description !== "string") return undefined;
  if (carriesConcealedCharacter(description)) {
    return (
      "contains characters that render as nothing — zero-width or bidirectional-override code " +
      "points — which is the concealment half of the published tool-poisoning attack: the user " +
      "reviewing this connector cannot see the text, and the model reads it in full"
    );
  }
  const comment = HTML_COMMENT.exec(description);
  if (comment && comment[1].trim().length > 0) {
    return (
      "hides text inside an HTML comment, which a user reading the description never sees and a " +
      "model consuming it reads as ordinary content — the shape scanners are built to catch"
    );
  }
  if (OVERRIDE_IDIOM.test(description)) {
    return (
      "instructs the model to ignore or override what it was told elsewhere, which is the " +
      "canonical injection idiom and has no meaning a description legitimately needs"
    );
  }
  return undefined;
}

/** Second-person direction at the assistant, rather than description of the tool. */
const MODEL_DIRECTIVES: readonly { readonly pattern: RegExp; readonly reads: string }[] = [
  {
    pattern: /\b(always|never)\s+(call|invoke|use|run)\b/i,
    reads: "orders the model to prefer or avoid a tool",
  },
  {
    pattern: /\byou\s+(must|should|will|need\s+to|have\s+to)\b/i,
    reads: "addresses the model directly and tells it how to behave",
  },
  {
    pattern: /\b(do\s?n[o']t|do\s+not)\s+(call|invoke|use|mention|tell)\b/i,
    reads: "forbids the model something, rather than describing this tool",
  },
  {
    pattern: /\bbefore\s+(calling|invoking|using)\s+(any\s+)?(other|another|all)\b/i,
    reads: "claims priority over the server's other tools",
  },
  {
    pattern: /\b(fetch|read|load|consult)\b[^.]{0,30}\bhttps?:\/\//i,
    reads: "points the model at an external source for its behaviour",
  },
];

/**
 * Say why a description reads as an instruction, in the terms a review rejects it in.
 *
 * "Describe what the tool does. Do not tell Claude how to behave." That sentence is a vendor
 * requirement for a directory listing, and the harder half is what it means for a server that never
 * submits: a scanner cannot distinguish a *legitimate* instruction from the attack, so it treats it
 * as the attack. "Always call this one first" reads as hostile even when it is true.
 *
 * **This advises rather than asserts**, and the reason is precision rather than evidence. The
 * vendor statement is STRONG; this matcher is not the client's, and the same phrasing that is
 * hostile in one sentence is a correct cross-tool reference in another. The finding is worth
 * printing and is not worth failing a build on.
 *
 * @param description - The `description` a tool published.
 * @returns What reads as a directive, or undefined when the text only describes.
 */
export function instructionShapedDescription(
  description: unknown,
): string | undefined {
  if (typeof description !== "string") return undefined;
  const matched = MODEL_DIRECTIVES.find((directive) =>
    directive.pattern.test(description),
  );
  if (!matched) return undefined;
  return (
    `${matched.reads}, which a review rejects and a scanner reads as the tool-poisoning attack — ` +
    "a cross-cutting fact like this belongs in the server's own `instructions` metadata, the " +
    "channel built to carry it"
  );
}

/**
 * Say why a client would drop a tool before the model ever sees it.
 *
 * One client runs the API's own schema checks at load time and **excludes** each tool that fails,
 * writing the reason only to its own log. The user sees a shorter tool list; the server sees
 * nothing at all. A tool that works in one client and is missing in another is this check far more
 * often than it is an authorization problem — which is why it is worth a failing assertion here,
 * where the reason is visible.
 *
 * @param schema - The published `inputSchema`.
 * @returns Which property name fails and how, or undefined when every top-level name passes. A
 *   schema that is not an object is left to `inputSchemaProblem`, which reports it once.
 */
export function schemaPropertyNameProblem(schema: unknown): string | undefined {
  const properties = asRecord(asRecord(schema)?.properties);
  if (!properties) return undefined;
  for (const name of Object.keys(properties)) {
    if (name.length === 0 || name.length > SCHEMA_PROPERTY_MAX_LENGTH) {
      return (
        `names a property ${JSON.stringify(name)} of ${name.length} characters, outside the ` +
        `1–${SCHEMA_PROPERTY_MAX_LENGTH} a client validates against before offering the tool`
      );
    }
    if (!SCHEMA_PROPERTY_CHARACTERS.test(name)) {
      return (
        `names a property ${JSON.stringify(name)}, outside the \`A-Z a-z 0-9 _ . -\` a client ` +
        "validates against — that client drops the whole tool at load time and reports it only to " +
        "its own log, so the tool is simply missing rather than broken"
      );
    }
  }
  return undefined;
}

/**
 * Say what a client will do to a schema that branches at its root.
 *
 * `allOf`, `anyOf` and `oneOf` at the schema root are **rewritten rather than rejected**: flattened
 * into one object, with a sentence prepended to the tool's *description* naming which parameter
 * groups belong together. `allOf` keeps each branch's `required`; `anyOf` and `oneOf` have theirs
 * described in prose instead of enforced.
 *
 * Nothing here fails a run. The tool still works, and no requirement is unmet — but a server
 * relying on a root combinator for correctness is relying on a constraint that stops existing at
 * the boundary, which is worth saying once.
 *
 * @param schema - The published `inputSchema`.
 * @returns Which combinator sits at the root and what becomes of it, or undefined when none does.
 */
export function rootSchemaCombinatorProblem(schema: unknown): string | undefined {
  const record = asRecord(schema);
  if (!record) return undefined;
  const found = ROOT_COMBINATORS.filter((keyword) => Array.isArray(record[keyword]));
  if (found.length === 0) return undefined;
  const enforced = found.every((keyword) => keyword === "allOf");
  return (
    `branches at the schema root on ${found.map((keyword) => `\`${keyword}\``).join(" and ")}, ` +
    "which a client flattens into a single object and describes in prose prepended to your " +
    `description${enforced ? "" : " — the branch's `required` list stops being enforced"}; ` +
    "enforce the constraint server-side, because the schema the model is shown no longer does"
  );
}

/**
 * How many tools would run without a per-call prompt on a client that honours annotations.
 *
 * **This is the figure that moves when the fixes land**, which is why it is computed rather than
 * described. A read-only tool runs unprompted where the hints determine auto-permissions; every
 * other tool — annotated destructive, or not annotated at all — prompts, is refused, or is dropped.
 * A surface where this number is zero is a surface whose users confirm every single call.
 *
 * It is an upper bound, not a promise: a client may still prompt, an organization may still set a
 * tool to `ask`, and a classifier may still veto. Nothing a server publishes can raise it further.
 *
 * @param tools - Every tool as published, in list order.
 * @returns How many declare `readOnlyHint: true` without also declaring themselves destructive.
 */
export function unpromptedToolCount(tools: readonly unknown[]): number {
  return tools.filter((tool) => {
    const annotations = readToolAnnotations(tool);
    return (
      annotations?.readOnlyHint === true && annotations.destructiveHint !== true
    );
  }).length;
}
