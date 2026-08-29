/**
 * The channel for what a specification OFFERS and a server does not publish.
 *
 * **Why this exists rather than another assertion.** The suites in this package fail on what a
 * specification requires, because that is what makes a red test a defect report rather than an
 * opinion. But the `2026-07-28` revision also offers a great deal that is optional — server
 * `instructions`, `icons[]`, an `outputSchema`, a `listChanged` declaration — and every one of them
 * changes what a user sees in at least one shipping client. Failing on those would make the suite
 * an opinion; saying nothing would waste what the run already knows.
 *
 * So an advisory is a third outcome: **not a failure, and not silence.** It names what is absent,
 * what it costs, and the clause that offers it — in the same shape a failure would, so a reader
 * moves between the two without re-learning a format.
 *
 * **An advisory never fails a run.** That is a promise to the consumer: adopting a new version of
 * this package can turn a green run red only through a real requirement, never through advice. It
 * is also why the report is printed loudly rather than logged quietly — advice nobody reads is the
 * same as advice nobody wrote.
 *
 * Advisories are also where the package puts a fact it is not certain enough of to assert. Where a
 * distilled vendor document leaves a field's placement unstated, pinning it as a requirement would
 * risk failing a correct server; recording it here says what was observed without claiming a clause
 * that may not say it.
 */

import { offers, type SpecificationClause } from "./specifications.js";

/** One thing the server could publish and does not. */
export interface Advisory {
  /** What the advice is about, in the server's terms: `server identity`, `tools/list`, a tool name. */
  readonly subject: string;
  /** What is absent or unsafe, in one sentence. */
  readonly finding: string;
  /**
   * What it costs, named concretely — which client would have used it, and what a user sees
   * instead. Advice without a consequence is a preference.
   */
  readonly consequence: string;
  /** The clause that offers the thing. */
  readonly source: SpecificationClause;
}

/** Advisories collected this run, per scope. Module state, because a suite reports at `afterAll`. */
const collected = new Map<string, Advisory[]>();

/**
 * Record one advisory against a scope.
 *
 * @param scope - The reporting scope, normally the suite's name. Advisories are printed per scope.
 * @param advisory - What is absent, what it costs, and the clause that offers it.
 */
export function advise(scope: string, advisory: Advisory): void {
  const existing = collected.get(scope);
  if (existing) existing.push(advisory);
  else collected.set(scope, [advisory]);
}

/**
 * Take everything recorded against a scope, clearing it.
 *
 * Draining rather than reading keeps a second report from repeating the first, which matters when
 * a consumer registers the same family against two targets in one run.
 *
 * @param scope - The reporting scope.
 * @returns The advisories, in the order they were recorded.
 */
export function takeAdvisories(scope: string): readonly Advisory[] {
  const taken = collected.get(scope) ?? [];
  collected.delete(scope);
  return taken;
}

/**
 * Render a report a reader can act on without opening the suite.
 *
 * Every entry carries its citation through {@link offers}, so an advisory and a failure quote their
 * source in the same shape — including the date the clause was last read, which is what tells a
 * reader six months from now whether the advice has expired — while the relation stays honest:
 * *offered by*, never *required by*.
 *
 * @param scope - The reporting scope, printed in the header.
 * @param advisories - What was recorded.
 * @returns The report, or an empty string when there is nothing to say.
 */
export function formatAdvisories(
  scope: string,
  advisories: readonly Advisory[],
): string {
  if (advisories.length === 0) return "";
  const rule = "─".repeat(92);
  const entries = advisories.map((advisory) => {
    const body = offers(advisory.source, advisory.finding)
      .split("\n")
      .map((line) => `      ${line}`)
      .join("\n");
    return `  ⚠ ${advisory.subject}\n${body}\n      costs you:   ${advisory.consequence}`;
  });
  return [
    "",
    rule,
    `mcp-client-tests · ${advisories.length} ` +
      `${advisories.length === 1 ? "advisory" : "advisories"} · ${scope}`,
    "Not failures — nothing here is required of you. Each is something the specification offers,",
    "that this server does not publish, and that at least one shipping client would have used.",
    rule,
    ...entries,
    rule,
    "",
  ].join("\n");
}

/**
 * Print and clear a scope's advisories.
 *
 * Called from a suite's `afterAll`, so the report lands with that suite's results rather than at
 * the end of a long run where it would be scrolled past.
 *
 * @param scope - The reporting scope.
 */
export function reportAdvisories(scope: string): void {
  const report = formatAdvisories(scope, takeAdvisories(scope));
  if (report) process.stdout.write(report);
}
