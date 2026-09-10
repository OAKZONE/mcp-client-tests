/**
 * When a page has finished registering, and how long a run is willing to wait to find out.
 *
 * **The defect this exists to prevent.** `registerTool()` is a script call, so "what has this page
 * registered?" has no answer until the script that registers has run. A read taken at `load` is
 * therefore not an early read — it is a read taken before the normal case can have happened at all.
 * The imperative API exists to hand a *live application's* own functions to an agent, and a live
 * application registers from a framework lifecycle hook — a React effect, `onMounted`, `onMount` —
 * which fires after hydration, which is after `load`. Sampling once at `load` reports every such
 * page as registering nothing, and reports it as a defect in the page.
 *
 * The shape that hides it is a fixture registering inline in the document: that one is green
 * whenever the read happens, so a suite tested only against fixtures never sees the gap.
 *
 * ## What is waited on, and why it is not "until the list is non-empty"
 *
 * A registration made by **this** document, told apart from whatever an earlier one may have left
 * behind. The difference is load-bearing: the lifetime check navigates two pages in one tab
 * precisely to catch a document that failed to release its tools, so a wait satisfied by a
 * non-empty list would be satisfied by the leak — and would then read the second page before it had
 * registered anything, inverting the assertion into a pass. The browser session keys the wait on
 * `toolchange` events raised in the new document, with a bounded poll against the names that were
 * already live as the fallback.
 *
 * ## The deadline is this package's number, and it is not a requirement
 *
 * Nothing published states when a page must have registered by — see
 * `WEBMCP.REGISTRATION_IS_UNTIMED`, graded down for exactly that reason. So the deadline can never
 * appear in an assertion's citation; it appears in the *message*, because "registered nothing
 * within 5000 ms of load" is something a reader can act on and "registered none by load" is not.
 * A page slower than the deadline raises `registrationTimeoutMs`; it is not failing a rule.
 *
 * **A timeout is still a named failure.** It is never a skip and never an empty pass: a conformance
 * run that quietly tested nothing is the worst outcome this package can produce.
 */

/**
 * How long to wait for a page to register, when a caller names no other number.
 *
 * Roughly ten times the slowest first-hand observation behind it — a Next.js 16 production build in
 * stock Chrome 152 completing its registrations 220–350 ms after `load` — because the number has to
 * survive a cold CI runner under load, where every one of those figures grows. It costs a correct
 * page nothing: the wait ends the moment a registration is seen, so only a page that really
 * registers nothing ever pays the full deadline.
 */
export const WEBMCP_REGISTRATION_DEADLINE_MS = 5_000;

/**
 * How often to re-read the tool list while waiting.
 *
 * The poll is the fallback behind the `toolchange` listener, not the primary signal, so this is
 * about the precision of the delay this run reports rather than about how fast it notices. It runs
 * inside the page, so a tight interval costs a `getTools()` call and no round trip.
 */
export const WEBMCP_REGISTRATION_POLL_MS = 25;

/** The environment variable that overrides the deadline for a whole run. */
export const REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE = "MCP_TESTS_WEBMCP_REGISTRATION_MS";

/**
 * Settle the deadline from what the consumer configured, the environment, and the default.
 *
 * Environment before default and option before environment, matching how the browser path and the
 * launch switches already resolve. A value that is not a positive finite number is ignored rather
 * than honoured: a `0` from an unset variable would turn every read back into the sample-once
 * behaviour this module exists to remove, silently.
 *
 * @param configured - The `registrationTimeoutMs` option, when the consumer passed one.
 * @param fromEnvironment - The raw environment value, or undefined. Passed in rather than read here
 *   so this stays a pure function the package's own tests can exercise.
 * @returns The deadline in milliseconds.
 */
export function resolveRegistrationDeadlineMs(
  configured?: number,
  fromEnvironment?: string,
): number {
  const usable = (value: number | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

  if (usable(configured)) return configured;
  const parsed = fromEnvironment === undefined ? Number.NaN : Number(fromEnvironment);
  if (usable(parsed)) return parsed;
  return WEBMCP_REGISTRATION_DEADLINE_MS;
}

/** How one page behaved while the run waited for it. */
export interface RegistrationTiming {
  readonly path: string;
  /** Whether a registration made by that page's own document was seen before the deadline. */
  readonly registrationObserved: boolean;
  /** Milliseconds after `load` at which it was seen — or the full wait, when it never was. */
  readonly registrationDelayMs: number;
}

/**
 * The fraction of the deadline past which a page is worth naming.
 *
 * Half, because the useful signal is not "how close did it come" but "would a slower machine have
 * missed it" — and CI runners are routinely twice as slow as a developer's laptop. A page landing
 * at 60% of the deadline here is a page that fails on a busy runner, and it is better read as a
 * number now than as a mystery failure later.
 */
const NEAR_DEADLINE_FRACTION = 0.5;

/**
 * Pages that registered, but late enough that a slower machine might not have waited long enough.
 *
 * @param timings - One entry per page read this run.
 * @param deadlineMs - The deadline that was waited to.
 * @returns The paths, slowest first. Empty when every page was comfortable.
 */
export function pagesNearDeadline(
  timings: readonly RegistrationTiming[],
  deadlineMs: number,
): readonly string[] {
  return timings
    .filter(
      (timing) =>
        timing.registrationObserved &&
        timing.registrationDelayMs > deadlineMs * NEAR_DEADLINE_FRACTION,
    )
    .slice()
    .sort((left, right) => right.registrationDelayMs - left.registrationDelayMs)
    .map((timing) => `${timing.path} (${timing.registrationDelayMs} ms)`);
}

/**
 * One sentence describing when this run's pages actually registered.
 *
 * Reported rather than asserted: the number is worth having — it is the difference between a page
 * that registers on hydration and one that waits on a network call — and no published requirement
 * exists to hold it to.
 *
 * @param timings - One entry per page read this run.
 * @returns The finding, or undefined when no page registered anything for there to be a delay of.
 */
export function registrationDelayFinding(
  timings: readonly RegistrationTiming[],
): string | undefined {
  const observed = timings.filter((timing) => timing.registrationObserved);
  if (observed.length === 0) return undefined;

  const delays = observed.map((timing) => timing.registrationDelayMs);
  const fastest = Math.min(...delays);
  const slowest = Math.max(...delays);
  const slowestPath = observed.find((timing) => timing.registrationDelayMs === slowest)?.path;

  const range = fastest === slowest ? `${slowest} ms` : `${fastest}–${slowest} ms`;
  return (
    `${observed.length} of ${timings.length} page(s) registered their tools ${range} after ` +
    `\`load\`` +
    (slowestPath !== undefined && observed.length > 1 ? `, the slowest being ${slowestPath}` : "")
  );
}
