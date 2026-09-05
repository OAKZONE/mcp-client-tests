/**
 * What a page publishes to an in-browser agent, as pure functions over the HTML it served.
 *
 * **WebMCP is not MCP**, and nothing in `mcp-surface.ts` applies here. There is no JSON-RPC, no
 * transport, no server and no OAuth: a page calls `registerTool()` and an agent attached to the
 * browser calls the function back, in the tab, inside whatever session the user already has. The
 * two share a vocabulary and nothing else, so the tool-name grammar, the caching hints and the
 * `resultType` rules of the MCP revisions have no standing over a WebMCP tool.
 *
 * ## What is reachable from here, and what is not
 *
 * The **declarative** API is HTML: a `<form>` carrying `toolname` and `tooldescription`, whose
 * controls carry `toolparamdescription` and whose validation attributes become schema constraints.
 * All of that arrives over the same socket as everything else this package asserts on, so it is
 * read here directly.
 *
 * The **imperative** API — `document.modelContext.registerTool(...)` — is a JavaScript call, and no
 * amount of HTML parsing observes whether it ran. What *is* observable is the script text a page
 * ships, which is enough to catch the one migration that silently breaks registration: the object
 * moved from `navigator` to `document`, and a page still using the old spelling is relying on an
 * alias Chrome has deprecated and plans to remove. {@link imperativeRegistrationStyle} reports that
 * without claiming the call succeeded, because it cannot know.
 */

import { collectTags, parseAttributes } from "./html.js";

/** Controls whose `name` becomes an input-schema property. */
const CONTROL_ELEMENTS = ["input", "select", "textarea"] as const;

/** Validation attributes the declarative explainer maps onto schema constraints. */
const CONSTRAINT_ATTRIBUTES = ["min", "max", "step", "pattern", "maxlength", "minlength"] as const;

/** One parameter a declarative tool exposes, as the page declares it. */
export interface DeclarativeWebMcpParameter {
  readonly name: string;
  /** The control's `toolparamdescription`, which becomes the property's description. */
  readonly description?: string;
  readonly required: boolean;
  /** The control kind: an `<input>`'s `type`, or `select` / `textarea`. */
  readonly kind: string;
  /** Validation attributes that become schema constraints, by attribute name. */
  readonly constraints: Readonly<Record<string, string>>;
}

/** One tool a page publishes through the declarative API. */
export interface DeclarativeWebMcpTool {
  /** The form's `toolname`, which becomes the tool's name. */
  readonly name: string;
  /** The form's `tooldescription`, which becomes the tool's description. */
  readonly description?: string;
  /** Whether the form carries `toolautosubmit`, letting an agent submit without user review. */
  readonly autoSubmit: boolean;
  readonly parameters: readonly DeclarativeWebMcpParameter[];
}

function toParameter(tag: {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
}): DeclarativeWebMcpParameter | undefined {
  const name = tag.attributes.get("name");
  if (!name) return undefined;
  const kind =
    tag.name === "input" ? (tag.attributes.get("type") ?? "text").toLowerCase() : tag.name;
  // A submit button is the trigger, not an argument; the explainer's own sample carries one and
  // does not treat it as an input-schema property.
  if (kind === "submit" || kind === "button" || kind === "reset") return undefined;
  const constraints: Record<string, string> = {};
  for (const attribute of CONSTRAINT_ATTRIBUTES) {
    const value = tag.attributes.get(attribute);
    if (value !== undefined) constraints[attribute] = value;
  }
  return {
    name,
    description: tag.attributes.get("toolparamdescription") || undefined,
    required: tag.attributes.has("required"),
    kind,
    constraints,
  };
}

/**
 * Every declarative tool a served document publishes.
 *
 * A form without `toolname` is an ordinary form and is not a tool, so it is skipped rather than
 * reported — the page is entitled to have forms that no agent should see.
 *
 * Controls are associated the way HTML associates them: by nesting, or by a `form=` attribute
 * naming the form's `id`. That second path is not a curiosity — it is how a page lays a control out
 * away from its form — and the modelled browser already follows the same rule for consent screens.
 *
 * @param html - The document as served.
 * @returns Each declarative tool, in source order.
 */
export function declarativeWebMcpTools(html: string): readonly DeclarativeWebMcpTool[] {
  const tools: DeclarativeWebMcpTool[] = [];
  const lowered = html.toLowerCase();
  const formPattern = /<form\b[^>]*>/gi;
  let match = formPattern.exec(html);
  while (match !== null) {
    const attributes = parseAttributes(match[0]);
    const name = attributes.get("toolname");
    if (name !== undefined) {
      const closing = lowered.indexOf("</form>", match.index);
      const body = html.slice(match.index, closing === -1 ? undefined : closing);
      const formId = attributes.get("id");

      // Nested controls that do not point elsewhere, plus controls anywhere in the document that
      // name this form by `form=`. Deduplicated by the control's own `name`, because a control
      // nested in this form AND naming it would otherwise be counted twice.
      const nested = collectTags(body, [...CONTROL_ELEMENTS])
        .filter((tag) => !tag.attributes.has("form"))
        .map(toParameter)
        .filter((parameter): parameter is DeclarativeWebMcpParameter => parameter !== undefined);
      const claimed = new Set(nested.map((parameter) => parameter.name));
      const associated = formId
        ? collectTags(html, [...CONTROL_ELEMENTS])
            .filter((tag) => tag.attributes.get("form") === formId)
            .map(toParameter)
            .filter(
              (parameter): parameter is DeclarativeWebMcpParameter =>
                parameter !== undefined && !claimed.has(parameter.name),
            )
        : [];

      tools.push({
        name,
        description: attributes.get("tooldescription") || undefined,
        autoSubmit: attributes.has("toolautosubmit"),
        parameters: [...nested, ...associated],
      });
    }
    match = formPattern.exec(html);
  }
  return tools;
}

/**
 * Say what is wrong with a declarative tool's own declaration.
 *
 * `ModelContextTool` requires a `name` and a `description`; a form declaring `toolname` and no
 * `tooldescription` publishes a tool a model is expected to choose with nothing to choose on.
 *
 * @param tool - The tool as the page declares it.
 * @returns What is wrong with it, or undefined when nothing is.
 */
export function declarativeToolProblem(tool: DeclarativeWebMcpTool): string | undefined {
  if (tool.name.trim().length === 0) return "declares an empty `toolname`";
  if (tool.description === undefined) {
    return "declares `toolname` but no `tooldescription`, so the model choosing it sees only a name";
  }
  return undefined;
}

/**
 * The names published more than once within one document.
 *
 * Tools are per-`Document`, so two forms claiming one name leave the agent unable to address either
 * predictably — the same defect as a duplicated MCP tool name, arrived at through a different door.
 *
 * @param tools - Every declarative tool on the page, in order.
 * @returns Each duplicated name once, in first-seen order.
 */
export function duplicateDeclarativeToolNames(
  tools: readonly DeclarativeWebMcpTool[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) duplicated.add(tool.name);
    seen.add(tool.name);
  }
  return [...duplicated];
}

/**
 * The parameters a tool exposes without saying what they are for.
 *
 * A control's `toolparamdescription` becomes its property description, and a property with none
 * leaves the model inferring meaning from the form-field name — which is how an agent fills a field
 * confidently and wrongly.
 *
 * @param tool - The tool as the page declares it.
 * @returns The undescribed parameter names, in declaration order.
 */
export function undescribedParameters(tool: DeclarativeWebMcpTool): readonly string[] {
  return tool.parameters
    .filter((parameter) => parameter.description === undefined)
    .map((parameter) => parameter.name);
}

/** Which spelling of the imperative entry point a page's script text uses. */
export type ImperativeRegistrationStyle =
  /** `document.modelContext` — the current spelling. */
  | "document"
  /** `navigator.modelContext` only — deprecated in Chrome 150.0.7861.0, an alias due for removal. */
  | "navigator"
  /** Both, which is the feature-detected form the migration guidance asks for. */
  | "both"
  /** Neither: the text registers nothing imperatively, or does it somewhere this cannot see. */
  | "none";

/**
 * Which imperative entry point a page's scripts reach for.
 *
 * **This reports the spelling, never that registration succeeded.** Whether `registerTool()` ran,
 * and what it registered, is observable only in a browser executing the origin trial — which this
 * package does not ship. What it does catch is the migration that breaks registration silently: the
 * object moved from `navigator` to `document`, Chrome keeps the old name as an alias it plans to
 * remove, and a great deal of third-party writing still shows the old spelling.
 *
 * @param scriptText - Script source: a served document's inline scripts, a fetched bundle, or both.
 * @returns Which spellings appear.
 */
export function imperativeRegistrationStyle(scriptText: string): ImperativeRegistrationStyle {
  const onDocument = /\bdocument\s*\.\s*modelContext\b/.test(scriptText);
  const onNavigator = /\bnavigator\s*\.\s*modelContext\b/.test(scriptText);
  if (onDocument && onNavigator) return "both";
  if (onDocument) return "document";
  if (onNavigator) return "navigator";
  return "none";
}

/**
 * The text of every inline `<script>` in a document, concatenated.
 *
 * External bundles are not followed here; a suite that wants them fetches them and concatenates.
 * Keeping the fetch out of a pure function is what lets the parsing be tested without a network.
 *
 * @param html - The document as served.
 * @returns The inline script text, newline-separated.
 */
export function inlineScriptText(html: string): string {
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const bodies: string[] = [];
  let match = pattern.exec(html);
  while (match !== null) {
    bodies.push(match[1]);
    match = pattern.exec(html);
  }
  return bodies.join("\n");
}

/**
 * Script URLs a document loads, which is where imperative registration usually lives.
 *
 * @param html - The document as served.
 * @returns Each `src`, in source order, verbatim as written.
 */
export function scriptSources(html: string): readonly string[] {
  return collectTags(html, ["script"])
    .map((tag) => tag.attributes.get("src"))
    .filter((src): src is string => src !== undefined && src.length > 0);
}

/** A document's script URLs, sorted by whether this run is allowed to fetch them. */
export interface ScriptUrlTriage {
  /** Same-origin URLs, reachable through the deployment's own edge. */
  readonly sameOrigin: readonly string[];
  /** Cross-origin URLs on an origin the deployment declared, fetched directly. */
  readonly allowed: readonly string[];
  /** Cross-origin URLs on no declared origin. Never fetched; reported instead. */
  readonly blocked: readonly string[];
}

/**
 * Sort a document's script URLs into the ones this run may fetch and the ones it may not.
 *
 * **Cross-origin bundles are fetched only from origins the deployment declared**, and that boundary
 * is the point rather than a limitation. Following every `src` would pull an arbitrary third party's
 * CDN into a consumer's CI on every run and risk reporting somebody else's bundle as a finding about
 * this deployment. Naming the origins is the consumer saying "these are mine" — which is a fact
 * about where their pages load code from, not a switch on the tests.
 *
 * What stays unread is returned rather than dropped, so a suite can say which scripts it did not
 * look at instead of quietly reporting a page as registering nothing.
 *
 * Resolved to absolute URLs and deduplicated across all three lists, because a page listing one
 * bundle twice should not cost two round trips.
 *
 * @param html - The document as served.
 * @param pageUrl - The absolute URL the document was fetched from, used to resolve relative `src`.
 * @param allowedOrigins - Origins the deployment declares its pages load scripts from. Compared
 *   after normalization, so a trailing slash or a spelled-out default port does not miss.
 * @returns The URLs, in source order within each list, each appearing once overall.
 */
export function triageScriptUrls(
  html: string,
  pageUrl: string,
  allowedOrigins: readonly string[] = [],
): ScriptUrlTriage {
  const pageOrigin = new URL(pageUrl).origin;
  const allowed = new Set<string>();
  for (const origin of allowedOrigins) {
    try {
      allowed.add(new URL(origin).origin);
    } catch {
      // A malformed declared origin matches nothing rather than taking the run down; the scripts it
      // was meant to cover then surface as blocked, which is the visible outcome.
    }
  }

  const triage: { sameOrigin: string[]; allowed: string[]; blocked: string[] } = {
    sameOrigin: [],
    allowed: [],
    blocked: [],
  };
  const seen = new Set<string>();
  for (const src of scriptSources(html)) {
    let url: URL;
    try {
      url = new URL(src, pageUrl);
    } catch {
      // A `src` that is not a URL is the page's problem and not this parser's; skipping it keeps a
      // malformed attribute from taking the run down.
      continue;
    }
    const absolute = url.toString();
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    if (url.origin === pageOrigin) triage.sameOrigin.push(absolute);
    else if (allowed.has(url.origin)) triage.allowed.push(absolute);
    else triage.blocked.push(absolute);
  }
  return triage;
}
