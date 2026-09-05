/**
 * Reading tags and attributes out of served HTML.
 *
 * **Extracted rather than duplicated.** The modelled browser has parsed form and input attributes
 * since this package's first commit; the WebMCP surface needs exactly the same parse over `<form>`,
 * `<input>`, `<select>` and `<textarea>`. Two copies of an attribute parser is two places for a
 * quoting bug to live, and a quoting bug here would misreport a consumer's page as publishing
 * something it does not — the class of harness defect `harness.test.ts` exists to catch.
 *
 * This is deliberately a tag scanner and not a DOM. Everything the callers need is carried on the
 * element's own attributes, so nesting, namespaces and character references never come up; building
 * a tree would add a dependency and a great deal of behaviour nothing here asserts on.
 */

/** One parsed element: its tag name, and its attributes lowercased by name. */
export interface HtmlTag {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
}

/**
 * Parse one HTML tag's attributes, tolerating any attribute order.
 *
 * Attribute names are lowercased, because HTML attribute names are case-insensitive and a page
 * writing `toolName=` means the same thing as `toolname=`. A valueless attribute maps to the empty
 * string, so `has()` answers presence and `get()` answers value without the two being confused.
 *
 * @param tag - The raw tag text, from `<` to `>`.
 * @returns The attributes, by lowercased name.
 */
export function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match = pattern.exec(tag);
  // The first match is the tag name itself; skip it.
  match = pattern.exec(tag);
  while (match !== null) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    match = pattern.exec(tag);
  }
  return attributes;
}

/**
 * Every occurrence of the named elements in a document, in source order.
 *
 * @param html - The rendered document.
 * @param names - Element names to collect, lowercase.
 * @returns Each matching element's name and attributes, first occurrence first.
 */
export function collectTags(
  html: string,
  names: readonly string[],
): readonly HtmlTag[] {
  const pattern = new RegExp(`<(${names.join("|")})\\b[^>]*>`, "gi");
  const found: HtmlTag[] = [];
  let match = pattern.exec(html);
  while (match !== null) {
    found.push({
      name: match[1].toLowerCase(),
      attributes: parseAttributes(match[0]),
    });
    match = pattern.exec(html);
  }
  return found;
}
