/**
 * Whether a registration dies with the document that made it.
 *
 * **There is no `unregisterTool`.** A registration is taken back by aborting the `AbortSignal`
 * handed to `registerTool`, and each `Document` has its own `ModelContext` holding its own tool map.
 * So the question "did this page release its tools?" has exactly one observable form: navigate away,
 * and see what is still there.
 *
 * ## Why the failure is worth a suite of its own
 *
 * It is silent, cumulative, and invisible to every arrangement that reads one page at a time. A
 * suite that opens a fresh tab per page — which is the natural way to write one — cannot see a leak
 * at all, because every reading starts from nothing. The user's session does not: they navigate,
 * and each navigation adds to what the last one left behind.
 *
 * What accumulates has no error to raise. It grows until the tool list is mostly stale entries an
 * agent can no longer call, and community reports put a hard ceiling somewhere past which WebMCP
 * stops working for the whole document, with nothing thrown and nothing to feature-detect.
 *
 * ## Two readings, because names are not unique across pages
 *
 * A leak shows up either as a name that belongs to a page already left, or — when two pages register
 * the same names — as a count larger than the page registers on its own. Both are reported: the
 * first names the culprit, the second catches the case the first cannot see.
 */

/** What one document held, at one moment. */
export interface DocumentToolReading {
  /** The path whose document was loaded. */
  readonly path: string;
  /** The tool names live at the moment of reading, in the order the surface returned them. */
  readonly toolNames: readonly string[];
}

/**
 * The registrations still live after navigating away from the document that made them.
 *
 * @param walk - Readings taken in **one tab**, one per navigation, in visit order.
 * @param solo - What each path registers on its own, in a document of its own. A path missing from
 *   here is skipped rather than guessed at: without it there is nothing to compare against.
 * @returns One sentence per leak, in walk order. Empty when every document released its tools.
 */
export function leakedRegistrations(
  walk: readonly DocumentToolReading[],
  solo: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const leaks: string[] = [];

  for (let step = 1; step < walk.length; step += 1) {
    const current = walk[step];
    const registers = solo.get(current.path);
    if (!registers) continue;

    const own = new Set(registers);
    const earlier = new Set<string>();
    for (let previous = 0; previous < step; previous += 1) {
      for (const name of solo.get(walk[previous].path) ?? []) earlier.add(name);
    }

    const foreign = [...new Set(current.toolNames)].filter(
      (name) => !own.has(name) && earlier.has(name),
    );
    if (foreign.length > 0) {
      leaks.push(
        `after navigating to ${current.path}, ${foreign.map((name) => `\`${name}\``).join(", ")} ` +
          "from an earlier document is still registered",
      );
      continue;
    }

    // Same names on both pages hide the leak above, so the count is the other half of the reading.
    const excess = current.toolNames.length - registers.length;
    if (excess > 0) {
      leaks.push(
        `after navigating to ${current.path}, ${current.toolNames.length} tools are live where ` +
          `that page registers ${registers.length} on its own — ${excess} outlived an earlier document`,
      );
    }
  }

  return leaks;
}
