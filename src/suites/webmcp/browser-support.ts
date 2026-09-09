/**
 * The one check both browser-driven WebMCP suites must make before believing anything else.
 *
 * A Chrome without the API answers every page with an empty tool list, which is indistinguishable
 * from a page that registers nothing and from a tool that failed to register. Two suites now read
 * pages through a browser, so the check lives here rather than in either of them: one message, one
 * citation, and no way for the two to drift into disagreeing about what an empty reading means.
 */

import { expect } from "vitest";

import { WEBMCP, cite } from "../../harness/specifications.js";
import {
  WEBMCP_LAUNCH_ARGS,
  type RegisteredToolReading,
} from "../../harness/webmcp-browser.js";

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
        "  Confirm any of them in DevTools under Application → WebMCP — but read an empty pane " +
        "as saying nothing on its own: the pane and the API ship on different switches, so it is " +
        "equally consistent with a browser that has no API and a page that registered no tools.",
    ),
  ).toBeGreaterThan(0);
}
