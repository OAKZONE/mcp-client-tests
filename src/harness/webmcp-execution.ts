/**
 * The shapes an implementer touches on every call, as pure functions over what a browser handed
 * back.
 *
 * **This is the half of WebMCP a structural check cannot reach.** Reading served HTML says whether a
 * tool was declared; driving a browser says whether it registered. Neither says what
 * `getTools()[0].inputSchema` actually *is*, or what `executeTool` will accept — and those two are
 * touched on every single call, by every consumer of the surface.
 *
 * ## Why nothing here decides who is right
 *
 * The draft carries both answers already. Its IDL types `RegisteredTool.inputSchema` as `object`;
 * its supporting concepts type a tool definition's input schema as a *string*, and say so for the
 * imperative form outright — "the stringified representation of `inputSchema`". The shipping
 * implementation and the draft then diverge again on the argument to `executeTool`
 * (`webmachinelearning/webmcp#287`, with #278 and #279).
 *
 * So this module **classifies and records** rather than asserting an encoding. A page that builds
 * against one reading and tests against a stub of the same reading passes its own suite and fails in
 * every browser that took the other one — which is the exact class of defect this package exists to
 * catch, and it is not caught by pinning a winner. What the suites assert is only what both readings
 * agree on: there is a schema, it describes properties, and *some* argument encoding is accepted.
 *
 * ## The round-trip property, which is not WebMCP-specific at all
 *
 * **Every value a tool's result reports for a parameter must be a value that parameter accepts.** A
 * surface can print a filter as `on`, publish `{"type":"boolean"}` for it, and accept `"true"` in
 * its handler — three spellings, each internally consistent, and a model that copies the printed
 * value back earns a refusal for doing exactly what the payload invited.
 *
 * It survives ordinary testing because every test asserts the producer's output against a literal
 * instead of feeding it back through the consumer. Nothing here knows what any tool does: it walks
 * the result for keys that match parameter names and asks the tool's own published schema whether it
 * would accept what it found.
 *
 * **{@link schemaRefusal} reports a refusal only where the schema is unambiguous** — a declared
 * `type`, an `enum`, a `const`, a bound, a pattern. A schema this module cannot fully evaluate
 * (`anyOf`, `oneOf`, `$ref`) yields no refusal at all, because a conformance gate that fails correct
 * pages gets switched off, taking every true finding with it.
 */

/** How a browser encoded a tool's `inputSchema` in what `getTools()` returned. */
export type InputSchemaEncoding =
  /** A JSON Schema object, as the draft's IDL types it. */
  | "object"
  /** A string that parses as a JSON Schema object — the stringified form the draft also describes. */
  | "json-string"
  /** A string that does not parse as a JSON object. */
  | "opaque-string"
  /** No schema at all. */
  | "absent"
  /** Present, and neither an object nor a string. */
  | "other";

/** How a browser accepted arguments on the way in to `executeTool`. */
export type ArgumentEncoding =
  /** `executeTool(tool, { … })` — the draft's `optional object inputObject`. */
  | "object"
  /** `executeTool(tool, JSON.stringify({ … }))`. */
  | "json-string";

/** One attempt to execute a tool with one argument encoding. */
export interface ExecutionAttempt {
  readonly encoding: ArgumentEncoding;
  readonly accepted: boolean;
  /** Whatever the call resolved to, verbatim. The draft types this as a stringified result. */
  readonly result?: unknown;
  /** The rejection, as `Name: message`, when the call threw. */
  readonly error?: string;
}

/** One value a tool's result published under a parameter's own name. */
export interface ReportedParameterValue {
  /** Where in the result it was found, e.g. `$.filters.status`. */
  readonly path: string;
  /** The parameter whose name the key matched. */
  readonly parameter: string;
  readonly value: unknown;
}

/** How deep the result walk goes before it stops looking. */
const MAX_WALK_DEPTH = 8;

/** How many nodes the result walk visits before it stops looking. */
const MAX_WALK_NODES = 5_000;

/**
 * Which encoding a browser used for a tool's `inputSchema`.
 *
 * Reported rather than judged: the draft describes the schema as an object in its IDL and as a
 * string in its supporting concepts, so both readings are grounded and a run's job is to say which
 * one it met.
 *
 * @param value - The `inputSchema` as `getTools()` returned it.
 * @returns The encoding.
 */
export function inputSchemaEncoding(value: unknown): InputSchemaEncoding {
  if (value === undefined || value === null) return "absent";
  if (typeof value === "string") {
    const parsed = parseJson(value);
    return isPlainObject(parsed) ? "json-string" : "opaque-string";
  }
  if (isPlainObject(value)) return "object";
  return "other";
}

/**
 * A tool's input schema as an object, whichever encoding it arrived in.
 *
 * Normalizing here is what lets every assertion downstream be written once instead of twice — and
 * writing it twice is how a suite ends up quietly checking only the encoding its author had in mind.
 *
 * @param value - The `inputSchema` as `getTools()` returned it.
 * @returns The schema, or undefined when there is none to read.
 */
export function parseInputSchema(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const parsed = parseJson(value);
    return isPlainObject(parsed) ? parsed : undefined;
  }
  return isPlainObject(value) ? value : undefined;
}

/**
 * Say what is wrong with a tool's input schema, in terms both readings of the draft agree on.
 *
 * The encoding is deliberately not a problem — see this module's header. What is a problem is a
 * schema that is absent, unreadable, or that describes no properties while the tool takes
 * arguments: in each case the model is left to guess the argument shape, and it guesses.
 *
 * @param value - The `inputSchema` as `getTools()` returned it.
 * @returns What is wrong with it, or undefined when nothing is.
 */
export function registeredToolSchemaProblem(value: unknown): string | undefined {
  const encoding = inputSchemaEncoding(value);
  if (encoding === "absent") return "publishes no `inputSchema`";
  if (encoding === "opaque-string") {
    return "publishes an `inputSchema` string that does not parse as a JSON object";
  }
  if (encoding === "other") {
    return `publishes an \`inputSchema\` that is neither an object nor a string (${typeof value})`;
  }
  const schema = parseInputSchema(value);
  if (!schema) return "publishes an `inputSchema` that could not be read as an object";
  if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
    return "publishes an `inputSchema` whose `properties` is not an object";
  }
  return undefined;
}

/**
 * The properties a tool's input schema declares, by name.
 *
 * @param schema - The parsed input schema.
 * @returns Each property's own schema, by property name. Empty when the schema declares none.
 */
export function schemaProperties(
  schema: Record<string, unknown> | undefined,
): ReadonlyMap<string, Record<string, unknown>> {
  const properties = new Map<string, Record<string, unknown>>();
  if (!schema || !isPlainObject(schema.properties)) return properties;
  for (const [name, propertySchema] of Object.entries(schema.properties)) {
    if (isPlainObject(propertySchema)) properties.set(name, propertySchema);
  }
  return properties;
}

/**
 * The argument encodings a browser accepted for one tool.
 *
 * @param attempts - Every attempt made against that tool.
 * @returns The accepted encodings, in the order they were attempted.
 */
export function acceptedEncodings(
  attempts: readonly ExecutionAttempt[],
): readonly ArgumentEncoding[] {
  return attempts.filter((attempt) => attempt.accepted).map((attempt) => attempt.encoding);
}

/**
 * Say why a tool could not be executed at all, if it could not.
 *
 * **Accepting one encoding is a pass.** Which one is a fact about the browser, recorded rather than
 * required; accepting neither means an agent attached to this page cannot call the tool by either
 * spelling anyone has published, which is the same as the tool not being there.
 *
 * @param attempts - Every attempt made against that tool.
 * @returns Why it is unreachable, or undefined when some encoding worked.
 */
export function executionProblem(attempts: readonly ExecutionAttempt[]): string | undefined {
  if (attempts.length === 0) return undefined;
  if (acceptedEncodings(attempts).length > 0) return undefined;
  const rejections = attempts
    .map((attempt) => `as ${attempt.encoding}: ${attempt.error ?? "rejected with no error"}`)
    .join("; ");
  return `refused every published argument encoding (${rejections})`;
}

/**
 * The payloads a tool's result puts in front of a model, unwrapped as far as they parse.
 *
 * The draft types the result as a `DOMString` holding a stringified result, and a result that
 * carries text parts wraps the interesting text one level further in. Both are unwrapped here so the
 * round-trip walk searches what a model actually reads, rather than the envelope around it.
 *
 * @param raw - Whatever `executeTool` resolved to.
 * @returns Each payload worth searching, outermost first.
 */
export function executionResultPayloads(raw: unknown): readonly unknown[] {
  const payloads: unknown[] = [];
  const outer = typeof raw === "string" ? (parseJson(raw) ?? raw) : raw;
  payloads.push(outer);

  const content = isPlainObject(outer) ? outer.content : undefined;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!isPlainObject(part) || typeof part.text !== "string") continue;
      const parsed = parseJson(part.text);
      if (parsed !== undefined) payloads.push(parsed);
    }
  }
  return payloads;
}

/**
 * Every value a payload publishes under a name one of the tool's parameters also uses.
 *
 * **Name matching is the whole mechanism, and it is not a heuristic to apologise for.** A model
 * reading a result has no more than the key it is written under; a value published at `status` is a
 * value it will pass back as `status`, whatever the surrounding structure meant by it. Collisions
 * are therefore findings rather than false positives — the collision is what the model sees.
 *
 * Bounded in depth and node count, so a large or self-similar payload costs a fixed amount.
 *
 * @param payload - One payload from {@link executionResultPayloads}.
 * @param parameterNames - The tool's own parameter names.
 * @returns Each match, in the order the walk met it.
 */
export function reportedParameterValues(
  payload: unknown,
  parameterNames: Iterable<string>,
): readonly ReportedParameterValue[] {
  const names = new Set(parameterNames);
  const found: ReportedParameterValue[] = [];
  if (names.size === 0) return found;

  let visited = 0;
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || visited > MAX_WALK_NODES) return;
    visited += 1;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (names.has(key)) found.push({ path: childPath, parameter: key, value });
      walk(value, childPath, depth + 1);
    }
  };

  walk(payload, "$", 0);
  return found;
}

/**
 * Say why a property's own schema would refuse a value — and stay silent whenever it might not.
 *
 * Only unambiguous refusals are reported: a declared `type`, an `enum`, a `const`, a numeric bound,
 * a string length or `pattern`. A schema carrying a combinator (`anyOf`, `oneOf`, `allOf`, `not`) or
 * a `$ref` is not evaluated at all, because a partial evaluation of one of those is how a gate
 * starts failing pages that are doing nothing wrong.
 *
 * @param propertySchema - The property's own schema, as published.
 * @param value - The value the tool's result reported for it.
 * @returns Why the schema refuses it, or undefined when it does not or cannot be judged.
 */
export function schemaRefusal(
  propertySchema: Record<string, unknown>,
  value: unknown,
): string | undefined {
  for (const combinator of ["anyOf", "oneOf", "allOf", "not", "$ref"]) {
    if (propertySchema[combinator] !== undefined) return undefined;
  }

  if ("const" in propertySchema && !sameJson(propertySchema.const, value)) {
    return `declares \`const: ${render(propertySchema.const)}\`, which does not accept ${render(value)}`;
  }

  const enumeration = propertySchema.enum;
  if (Array.isArray(enumeration) && !enumeration.some((member) => sameJson(member, value))) {
    return (
      `declares \`enum: ${render(enumeration)}\`, which does not accept ${render(value)}` +
      (typeof value === "string" ? " — the spelling is the whole difference" : "")
    );
  }

  const declaredTypes = readTypes(propertySchema.type);
  if (declaredTypes.length > 0) {
    const actual = jsonType(value);
    const accepted = declaredTypes.some(
      (declared) =>
        declared === actual ||
        (declared === "number" && actual === "integer") ||
        (declared === "integer" && actual === "integer"),
    );
    if (!accepted) {
      return (
        `declares \`type: ${render(propertySchema.type)}\`, which does not accept the ` +
        `${actual} ${render(value)}`
      );
    }
  }

  if (typeof value === "string") {
    const pattern = propertySchema.pattern;
    if (typeof pattern === "string" && !matchesPattern(pattern, value)) {
      return `declares \`pattern: ${render(pattern)}\`, which does not accept ${render(value)}`;
    }
    if (typeof propertySchema.minLength === "number" && value.length < propertySchema.minLength) {
      return `declares \`minLength: ${propertySchema.minLength}\`, and reports ${render(value)}`;
    }
    if (typeof propertySchema.maxLength === "number" && value.length > propertySchema.maxLength) {
      return `declares \`maxLength: ${propertySchema.maxLength}\`, and reports ${render(value)}`;
    }
  }

  if (typeof value === "number") {
    if (typeof propertySchema.minimum === "number" && value < propertySchema.minimum) {
      return `declares \`minimum: ${propertySchema.minimum}\`, and reports ${value}`;
    }
    if (typeof propertySchema.maximum === "number" && value > propertySchema.maximum) {
      return `declares \`maximum: ${propertySchema.maximum}\`, and reports ${value}`;
    }
  }

  return undefined;
}

/**
 * The round-trip failures in one tool's result: values it reports that its own schema refuses.
 *
 * @param properties - The tool's published properties, by name.
 * @param reported - What its result published under those names.
 * @returns One sentence per failure, naming the path, the value, and what the schema says.
 */
export function roundTripViolations(
  properties: ReadonlyMap<string, Record<string, unknown>>,
  reported: readonly ReportedParameterValue[],
): readonly string[] {
  const violations: string[] = [];
  for (const entry of reported) {
    const propertySchema = properties.get(entry.parameter);
    if (!propertySchema) continue;
    const refusal = schemaRefusal(propertySchema, entry.value);
    if (refusal) {
      violations.push(`${entry.path} reports ${render(entry.value)}, but \`${entry.parameter}\` ${refusal}`);
    }
  }
  return violations;
}

/** The JSON type name of a value, with `integer` split out the way JSON Schema splits it. */
function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  return typeof value;
}

function readTypes(declared: unknown): readonly string[] {
  if (typeof declared === "string") return [declared];
  if (Array.isArray(declared)) return declared.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // An unparseable pattern is the page's business and not this checker's; refusing to judge is
    // the only safe reading, since the browser's own regex dialect may accept what this one will not.
    return true;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function render(value: unknown): string {
  try {
    const rendered = JSON.stringify(value);
    return rendered === undefined ? String(value) : rendered;
  } catch {
    return String(value);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
