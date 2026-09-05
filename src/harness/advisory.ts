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
 * Advisories are also where the package puts a fact it is not certain enough of to assert — and
 * since the client-gate sweep, that is most of what is known about how a tool actually gets to run.
 * A clause graded below `strong` (see `specifications.ts`) is **structurally unable** to fail a run:
 * `cite()` refuses it, so it can only arrive here. Where a distilled vendor document leaves a
 * field's placement unstated, or a tool ceiling circulates that no vendor has ever published,
 * pinning it as a requirement would risk failing a correct server; recording it here says what was
 * observed, and prints the grade beside it, without claiming a clause that may not say it.
 */

import { offers, reports, type SpecificationClause } from "./specifications.js";

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
  /** The clause that offers, or reports, the thing. */
  readonly source: SpecificationClause;
  /**
   * How the source relates to the finding, when the default reads wrong.
   *
   * The default is derived from the clause's grade — `strong` offers, anything lower reports — and
   * it is right almost always. The exception is a **well-established fact that is nonetheless only
   * worth reporting**: a client rewriting a root-level schema combinator is documented and certain,
   * but nothing *offers* it and no server can prevent it, so *offered by* would read as nonsense.
   *
   * **Only `"reports"` is honoured.** Downgrading a claim is always safe; upgrading one is the
   * failure this package exists to prevent, so a clause graded below `strong` renders as *reported
   * by* whatever is passed here.
   */
  readonly relation?: "reports";
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
 * Every entry carries its citation in the same shape a failure would — including the date the
 * clause was last read, which is what tells a reader six months from now whether the advice has
 * expired — while the relation stays honest about what the source actually does.
 *
 * **The relation is chosen from the clause's grade, never by the caller.** A `strong` clause states
 * something, so its advisory reads *offered by*; anything graded down was reported rather than
 * stated, so it reads *reported by* and prints its grade and caveat. Deriving that here rather than
 * asking each call site for it is what keeps a THIN community number from ever being presented to a
 * consumer as though a vendor had published it.
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
    const render =
      advisory.source.grade === "strong" && advisory.relation !== "reports"
        ? offers
        : reports;
    const body = render(advisory.source, advisory.finding)
      .split("\n")
      .map((line) => `      ${line}`)
      .join("\n");
    return `  ⚠ ${advisory.subject}\n${body}\n      costs you:   ${advisory.consequence}`;
  });
  const reported = advisories.filter(
    (advisory) => advisory.source.grade !== "strong",
  ).length;
  return [
    "",
    rule,
    `mcp-client-tests · ${advisories.length} ` +
      `${advisories.length === 1 ? "advisory" : "advisories"} · ${scope}`,
    "Not failures — nothing here is required of you. Each is either something a specification",
    "offers that this server does not publish, or a client behaviour worth designing around.",
    ...(reported > 0
      ? [
          `${reported} of them cite a source graded below STRONG: a reported or contested fact,`,
          "printed with its grade so you can weigh it rather than take it as published.",
        ]
      : []),
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
