/** Pure judgements of the published Skills extension manifest, never a consumer's implementation. */

/** The extension's identifier, shared by discovery and per-request negotiation. */
export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Check the mandatory manifest fields without turning recommendations into limits.
 *
 * Different URI schemes, duplicate skill names, large manifests, and `dynamic` are all allowed.
 * This checks manifest structure; verifying file bytes and YAML frontmatter needs resources/read.
 *
 * @param entry - One entry from skills/list or skills/get.
 * @returns The mandatory fields that cannot be consumed as published.
 */
export function skillManifestProblems(entry: unknown): readonly string[] {
  const skill = record(entry);
  if (!skill) return ["entry is not an object"];
  const problems: string[] = [];
  if (typeof skill.uri !== "string" || skill.uri.length === 0) problems.push("missing skill URI");
  const frontmatter = record(skill.frontmatter);
  for (const field of ["name", "description"] as const) {
    if (typeof frontmatter?.[field] !== "string" || frontmatter[field].length === 0) {
      problems.push(`frontmatter.${field} is not a non-empty string`);
    }
  }
  if (skill.resources === "dynamic") return problems;
  if (!Array.isArray(skill.resources)) return [...problems, 'resources must be an array or "dynamic"'];

  const uris = new Set<string>();
  for (const [index, value] of skill.resources.entries()) {
    const file = record(value);
    const label = `resources[${index}]`;
    if (typeof file?.uri !== "string" || file.uri.length === 0) {
      problems.push(`${label} has no file URI`);
    } else {
      if (uris.has(file.uri)) problems.push(`${label} duplicates ${file.uri}`);
      uris.add(file.uri);
    }
    if (typeof file?.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(file.digest)) {
      problems.push(`${label} has no lowercase SHA-256 digest`);
    }
    if (typeof file?.size !== "number" || !Number.isInteger(file.size) || file.size < 0) {
      problems.push(`${label} has no non-negative integer byte size`);
    }
  }
  if (typeof skill.uri === "string" && !uris.has(skill.uri)) {
    problems.push("resources omits the skill's own SKILL.md entry");
  }
  return problems;
}
