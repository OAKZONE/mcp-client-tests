/**
 * WebMCP conformance: what the page actually registered, asked of a real browser.
 *
 * The declarative suite reads served HTML and therefore cannot see
 * `document.modelContext.registerTool(...)` at all. This one loads each declared page in Chrome and
 * asks it the same question an attached agent asks — `getTools()` — which is the only way to catch
 * the failure the platform documentation names: a page whose own tests are green while DevTools
 * reads zero tools, because the registration call never landed. The `navigator` → `document`
 * migration broke exactly that class of test.
 *
 * **It needs a browser, and says so loudly when it cannot get one.** `playwright-core` is an
 * optional peer dependency shipping no binaries; the browser is whatever Chrome the machine has.
 * A missing library, a missing binary, or a Chrome without the API stops the run with both ways out
 * named. None of those is a skip, because a conformance run that quietly tested nothing is the
 * worst outcome available and this is the surface where it is easiest to produce.
 *
 * **Register it alongside the declarative suite, not instead of it.** They see different halves,
 * and the interesting findings live in the difference.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import { readRunningDeployment, type RunningDeployment } from "../../harness/deployment.js";
import { WEBMCP, cite } from "../../harness/specifications.js";
import {
  openWebMcpBrowser,
  WEBMCP_LAUNCH_ARGS,
  type RegisteredToolReading,
  type WebMcpBrowserOptions,
  type WebMcpBrowserSession,
} from "../../harness/webmcp-browser.js";
import type { McpTestTarget } from "../../target.js";

const SCOPE = "WebMCP registered tools (browser)";

/**
 * Register the browser-driven WebMCP suite against one target.
 *
 * Skipped unless the target declares the `webMcp` capability. Browser availability is deliberately
 * **not** a capability: a capability describes the server, and whether this machine has Chrome is a
 * fact about the runner. An absent browser therefore fails the run rather than un-declaring it.
 *
 * @param mcpTarget - The deployment under test.
 * @param browserOptions - How to find a browser and how to switch WebMCP on. Defaults come from
 *   `MCP_TESTS_CHROME_PATH` and `MCP_TESTS_CHROME_ARGS`.
 */
export function defineWebMcpImperativeSuite(
  mcpTarget: McpTestTarget,
  browserOptions: WebMcpBrowserOptions = {},
): void {
  describe.skipIf(!mcpTarget.webMcp)("WebMCP registered tools (browser)", () => {
    let deployment: RunningDeployment;
    let session: WebMcpBrowserSession | undefined;
    let readings: RegisteredToolReading[] = [];

    const capability = mcpTarget.webMcp ?? { toolPages: [] };

    beforeAll(async () => {
      deployment = readRunningDeployment(mcpTarget.id);
      session = await openWebMcpBrowser(
        deployment.canonicalOrigin,
        deployment.appPort,
        browserOptions,
      );
      readings = [];
      for (const path of capability.toolPages) {
        readings.push(await session.read(path));
      }
    }, 180_000);

    afterAll(async () => {
      await session?.close();
      reportAdvisories(SCOPE);
    });

    it("runs in a browser that exposes the WebMCP API", () => {
      // The hard stop that keeps every assertion below honest. A Chrome without the API returns an
      // empty tool list for every page, which is indistinguishable from a page that registers
      // nothing — so this is checked first and named precisely.
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
            "  Confirm any of them in DevTools under Application → WebMCP.",
        ),
      ).toBeGreaterThan(0);
    });

    it("serves every page the target declares as publishing tools", () => {
      const unreachable = readings
        .filter((reading) => reading.status !== 200)
        .map((reading) => `${reading.path} answered ${reading.status}`);

      expect(
        unreachable,
        `The target declares these paths as publishing WebMCP tools, and they did not load: ` +
          `${unreachable.join("; ")}. Either the page moved, or it is behind a session — the ` +
          "browser carries no cookie unless the page sets one itself.",
      ).toEqual([]);
    });

    it("registers at least one tool on every page declared as publishing them", () => {
      // This is assertable precisely because the consumer declared the page. `toolPages` is the
      // claim "this page publishes tools to an agent"; a page that registers none contradicts it,
      // and both readings of that contradiction are real findings — the list is wrong, or the
      // registration never landed. Guarding on the API being present keeps a switched-off browser
      // from producing this failure for every page.
      const empty = readings
        .filter((reading) => reading.apiPresent && reading.tools.length === 0)
        .map((reading) => reading.path);

      expect(
        empty,
        cite(
          WEBMCP.DOCUMENT_MODEL_CONTEXT,
          "These pages are declared as publishing WebMCP tools and registered none by load: " +
            `${empty.join(", ")}. Either the page does not belong in \`toolPages\`, or its ` +
            "`registerTool` call never landed — the documented silent failure, and the one the " +
            "`navigator` → `document` migration causes. A page that registers only after user " +
            "interaction is the third reading; move it out of `toolPages` if so, because nothing " +
            "here can drive it.",
        ),
      ).toEqual([]);
    });

    it("gives every registered tool the name and description the IDL requires", () => {
      const problems = readings.flatMap((reading) =>
        reading.tools
          .map((tool, index) => {
            if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
              return `${reading.path}: the tool at index ${index} registered without a name`;
            }
            if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
              return `${reading.path}: \`${tool.name}\` registered without a description`;
            }
            return undefined;
          })
          .filter((entry): entry is string => entry !== undefined),
      );

      expect(
        problems,
        cite(
          WEBMCP.TOOL_SHAPE,
          "`ModelContextTool` requires `name`, `description` and `execute`. A tool registered " +
            "without a description asks the model to choose it on its name alone — and unlike the " +
            "declarative form, nothing in the page's markup reveals the omission.",
        ),
      ).toEqual([]);
    });

    it("keeps registered tool names unique within each document", () => {
      const collisions = readings.flatMap((reading) => {
        const seen = new Set<string>();
        const duplicated = new Set<string>();
        for (const tool of reading.tools) {
          if (seen.has(tool.name)) duplicated.add(tool.name);
          seen.add(tool.name);
        }
        return [...duplicated].map((name) => `${reading.path}: \`${name}\``);
      });

      expect(
        collisions,
        cite(
          WEBMCP.DECLARATIVE_API,
          "Tools are registered per `Document`, so two registrations claiming one name leave the " +
            "agent unable to address either predictably.",
        ),
      ).toEqual([]);
    });

    it("records what the registered surface offers and does not say", () => {
      collectAdvisories(readings);
      expect(readings.length, "The `webMcp` capability declared no pages to load.").toBeGreaterThan(
        0,
      );
    });
  });
}

/**
 * Record what the live tool surface exposes, and what the platform will not enforce for it.
 *
 * @param readings - What each page yielded.
 */
function collectAdvisories(readings: readonly RegisteredToolReading[]): void {
  const surfaces = [...new Set(readings.map((reading) => reading.toolSurface))].filter(
    (surface) => surface !== "none",
  );
  if (surfaces.length > 0) {
    advise(SCOPE, {
      subject: "the reader this run used",
      finding: `tools were read through ${surfaces.join(", ")}`,
      consequence:
        "Recorded because the published sources disagree about which surface exists under the " +
        "testing flag — the specification's IDL puts `getTools()` on `document.modelContext`, " +
        "while Chrome's testing flag is documented as exposing a separate " +
        "`navigator.modelContextTesting` whose reader two sources name differently. This run " +
        "probed each and reports the one that answered, so a later Chrome that moves it shows up " +
        "here as a change rather than as your pages registering nothing.",
      source: WEBMCP.CHROME_ENABLEMENT,
    });
  }

  for (const reading of readings) {
    for (const tool of reading.tools) {
      const annotations = tool.annotations ?? {};
      const declared = Object.keys(annotations).filter((key) =>
        ["readOnlyHint", "consequentialHint", "untrustedContentHint"].includes(key),
      );

      if (declared.length === 0) {
        advise(SCOPE, {
          subject: `${reading.path} — \`${tool.name}\` annotations`,
          finding: "the tool declares none of `readOnlyHint`, `consequentialHint` or `untrustedContentHint`",
          consequence:
            "An agent deciding whether to confirm before calling has nothing to go on, so it " +
            "either confirms everything or confirms nothing. Declaring them honestly is what lets " +
            "a careful agent behave well — while you design as though it ignores them, because " +
            "nothing requires it to honour any of them.",
          source: WEBMCP.HINTS_ARE_NOT_ENFORCEMENT,
        });
        continue;
      }

      if (annotations.readOnlyHint === true) {
        advise(SCOPE, {
          subject: `${reading.path} — \`${tool.name}\` claims to be read-only`,
          finding: "the tool declares `readOnlyHint: true`, which an agent may use to skip confirmation",
          consequence:
            "Nothing in the specification requires an agent to honour these hints, and nothing " +
            "verifies the claim. `readOnlyHint` on a tool that writes is not a mislabel — it is a " +
            "vulnerability you shipped, because the agent skips the one confirmation that would " +
            "have caught it. Confirm this tool performs no side effect, and keep anything that " +
            "moves money, deletes, publishes or messages other people behind a real confirmation " +
            "in your own UI.",
          source: WEBMCP.HINTS_ARE_NOT_ENFORCEMENT,
        });
      }
    }
  }
}
