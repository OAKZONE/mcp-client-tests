/**
 * What both browser-driven WebMCP suites must do identically, before believing anything else.
 *
 * A Chrome without the API answers every page with an empty tool list, which is indistinguishable
 * from a page that registers nothing and from a tool that failed to register. Two suites read pages
 * through a browser, so the check lives here rather than in either of them: one message, one
 * citation, and no way for the two to drift into disagreeing about what an empty reading means.
 *
 * The registration-timing advisory is here for the same reason. Both suites wait for a page to
 * register and both know how long it took; a consumer registering either one should get the number,
 * and the two must not describe it differently.
 */

import { expect } from "vitest";

import { advise } from "../../harness/advisory.js";
import { WEBMCP, cite } from "../../harness/specifications.js";
import {
  WEBMCP_LAUNCH_ARGS,
  type RegisteredToolReading,
} from "../../harness/webmcp-browser.js";
import {
  pagesNearDeadline,
  registrationDelayFinding,
} from "../../harness/webmcp-registration.js";

/**
 * Fail the run, precisely, when the browser had no WebMCP API to ask.
 *
 * @param readings - Every page read through the browser this run.
 */
export function assertWebMcpApiPresent(readings: readonly RegisteredToolReading[]): void {
  const exposed = readings.filter((reading) => reading.apiPresent);

  expect(
    exposed.length,
    cite(
      WEBMCP.CHROME_ENABLEMENT,
      "No page exposed a WebMCP object, so this browser does not have the API switched on and " +
        "every reading below is empty for that reason rather than because your pages register " +
        "nothing.\n" +
        `  The suite launched Chrome with ${WEBMCP_LAUNCH_ARGS.join(" ")}, which is the ` +
        "command-line spelling of `chrome://flags/#enable-webmcp-testing`. Chrome documents " +
        "the flag itself (146.0.7672.0+) and the origin trial (Chrome 149+); it does not " +
        "document the switch, so it may have been renamed.\n" +
        "  Ways out, cheapest first:\n" +
        "    1. Check the Chrome being launched is 149 or newer — `MCP_TESTS_CHROME_PATH` " +
        "picks a specific binary, and an old stable build has no flag to set.\n" +
        "    2. Enable it by hand at `chrome://flags/#enable-webmcp-testing` and confirm " +
        "`document.modelContext` in that browser's console, then pass the switch that build " +
        "uses via `launchArgs` or `MCP_TESTS_CHROME_ARGS`.\n" +
        "    3. Serve an origin-trial token on these pages, which is what production does and " +
        "needs no switch at all.\n" +
        "    4. If the page needs a visible context, pass `headless: false`.\n" +
        "    5. In CI, `npx playwright-core install --with-deps chrome` installs a current Chrome. " +
        "GitHub's `ubuntu-latest` already ships one new enough; a container or a pinned older " +
        "image may not, and that is what this failure looks like there.\n" +
        "  Confirm any of them in DevTools under Application → WebMCP — but read an empty pane " +
        "as saying nothing on its own: the pane and the API ship on different switches, so it is " +
        "equally consistent with a browser that has no API and a page that registered no tools.",
    ),
  ).toBeGreaterThan(0);
}

/**
 * Record when this run's pages actually registered, and name any that cut it close.
 *
 * Advisory rather than assertion because nothing published states when a page must have registered
 * by ({@link WEBMCP.REGISTRATION_IS_UNTIMED}). The number is still worth having: it separates a page
 * that registers on hydration from one that waits on a network call, and a page landing late here
 * is a page that fails on a busier machine, which is far better read as a measurement now than as a
 * mystery failure later.
 *
 * @param scope - The reporting scope of the calling suite.
 * @param readings - Every page read through the browser this run.
 * @param deadlineMs - The deadline the run waited to.
 */
export function adviseRegistrationTiming(
  scope: string,
  readings: readonly RegisteredToolReading[],
  deadlineMs: number,
): void {
  const timings = readings
    .filter((reading) => reading.status === 200 && reading.apiPresent)
    .map((reading) => ({
      path: reading.path,
      registrationObserved: reading.registrationObserved,
      registrationDelayMs: reading.registrationDelayMs,
    }));

  const finding = registrationDelayFinding(timings);
  if (!finding) return;

  const close = pagesNearDeadline(timings, deadlineMs);
  advise(scope, {
    subject: "when your pages registered their tools",
    finding: `${finding}, against a ${deadlineMs} ms deadline this run waited to`,
    consequence:
      "Nothing requires a page to register by any particular moment, so this is a measurement of " +
      "your pages rather than a rule they meet. It is here because the read has to wait for it: a " +
      "registration made from a framework lifecycle hook lands after hydration, therefore after " +
      "`load`, and a run that sampled once at `load` would report every such page as registering " +
      "nothing." +
      (close.length > 0
        ? `\n  Cutting it fine — ${close.join(", ")} — past half the deadline. A CI runner is ` +
          "routinely twice as slow as the machine you measured on, so raise " +
          "`registrationTimeoutMs` (or `MCP_TESTS_WEBMCP_REGISTRATION_MS`) before this becomes an " +
          "intermittent red run, or move the registration earlier than the work it waits on."
        : ""),
    source: WEBMCP.REGISTRATION_IS_UNTIMED,
  });
}
