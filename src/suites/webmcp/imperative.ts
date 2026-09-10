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
  type RegisteredToolReading,
  type WebMcpBrowserOptions,
  type WebMcpBrowserSession,
} from "../../harness/webmcp-browser.js";
import { leakedRegistrations } from "../../harness/webmcp-lifetime.js";
import {
  REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE,
  resolveRegistrationDeadlineMs,
} from "../../harness/webmcp-registration.js";
import type { McpTestTarget } from "../../target.js";

import { adviseRegistrationTiming, assertWebMcpApiPresent } from "./browser-support.js";

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
    let walk: readonly RegisteredToolReading[] = [];

    const capability = mcpTarget.webMcp ?? { toolPages: [] };
    const deadlineMs = resolveRegistrationDeadlineMs(
      browserOptions.registrationTimeoutMs,
      process.env[REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE],
    );

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

      // The same pages again, in one tab, without closing it in between. Everything above starts
      // from a fresh document and therefore cannot see a registration that outlived one.
      walk =
        capability.toolPages.length >= 2 ? await session.readSequence(capability.toolPages) : [];
    }, 240_000);

    afterAll(async () => {
      await session?.close();
      reportAdvisories(SCOPE);
    });

    it("runs in a browser that exposes the WebMCP API", () => {
      // The hard stop that keeps every assertion below honest. A Chrome without the API returns an
      // empty tool list for every page, which is indistinguishable from a page that registers
      // nothing — so this is checked first, and named precisely in one shared place.
      assertWebMcpApiPresent(readings);
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
          "These pages are declared as publishing WebMCP tools and registered nothing within " +
            `${deadlineMs} ms of \`load\`: ${empty.join(", ")}.\n` +
            "  The run does not sample at `load` — it waits, because a registration made from a " +
            "framework lifecycle hook lands after hydration and a page that registers inline is " +
            "the exception rather than the rule. So this is a page that had the whole window and " +
            "used none of it.\n" +
            "  Three readings, in the order worth checking:\n" +
            "    1. The `registerTool` call never landed — the documented silent failure, and the " +
            "one the `navigator` → `document` migration causes. Confirm `document.modelContext` " +
            "is the object your page reaches for.\n" +
            "    2. The page registers, but later than the deadline — because it waits on a " +
            "fetch, or because this machine is slower than the one you measured on. Raise " +
            "`registrationTimeoutMs` (or `MCP_TESTS_WEBMCP_REGISTRATION_MS`); the number is this " +
            "package's own and nothing published sets it.\n" +
            "    3. The page registers only after the user does something, or does not belong in " +
            "`toolPages` at all. Move it out if so — nothing here can drive it.",
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

    it("releases a page's tools when the document that registered them goes away", () => {
      const leaks = leakedRegistrations(
        walk
          .filter((reading) => reading.status === 200 && reading.apiPresent)
          .map((reading) => ({
            path: reading.path,
            toolNames: reading.tools.map((tool) => tool.name),
          })),
        new Map(
          readings
            .filter((reading) => reading.status === 200 && reading.apiPresent)
            .map((reading) => [reading.path, reading.tools.map((tool) => tool.name)] as const),
        ),
      );

      expect(
        leaks,
        cite(
          WEBMCP.PER_DOCUMENT_LIFETIME,
          "Tools live on a `Document`, and there is no `unregisterTool` — a registration is taken " +
            "back by aborting the `AbortSignal` given to `registerTool`, which is what a document " +
            "going away does for you. This run walked your declared pages in one tab and found " +
            "tools from a document already left still registered afterwards.\n" +
            "  The failure is silent and cumulative: nothing errors, and every page a visitor " +
            "opens adds to what the last one left behind, until the agent's tool list is mostly " +
            "entries it can no longer call. A suite that opens a fresh tab per page — including " +
            "every other assertion in this file — cannot see it, because each reading starts from " +
            "nothing.\n" +
            "  Pass an `AbortSignal` to every `registerTool` call and abort it when the view that " +
            "owns the tool goes away. If your pages are one document with client-side routing, " +
            "that is the only mechanism there is: no navigation ever tears the registry down for " +
            "you.",
        ),
      ).toEqual([]);
    });

    it("records what the registered surface offers and does not say", () => {
      adviseRegistrationTiming(SCOPE, readings, deadlineMs);
      collectAdvisories(readings, walk, capability.toolPages.length);
      expect(readings.length, "The `webMcp` capability declared no pages to load.").toBeGreaterThan(
        0,
      );
    });
  });
}

/**
 * Record what the live tool surface exposes, and what the platform will not enforce for it.
 *
 * @param readings - What each page yielded, each in a document of its own.
 * @param walk - The same pages read in one tab, when there were enough of them to navigate between.
 * @param declaredPageCount - How many pages the capability declared.
 */
function collectAdvisories(
  readings: readonly RegisteredToolReading[],
  walk: readonly RegisteredToolReading[],
  declaredPageCount: number,
): void {
  if (declaredPageCount < 2) {
    advise(SCOPE, {
      subject: "registration lifetime across a navigation",
      finding:
        `the capability declares ${declaredPageCount} tool page(s), so this run never navigated ` +
        "between two of them and nothing observed whether a document releases its tools",
      consequence:
        "A registration that outlives its document is invisible to every reading above — each one " +
        "opens a fresh tab, so it starts from nothing, while a visitor's session does not. Two " +
        "declared pages are enough to see it. Until then the leak assertion inspected nothing and " +
        "passed, which is not the same as a page that releases cleanly.",
      source: WEBMCP.PER_DOCUMENT_LIFETIME,
    });
  } else {
    const peak = Math.max(0, ...walk.map((reading) => reading.tools.length));
    const registered = Math.max(0, ...readings.map((reading) => reading.tools.length));
    advise(SCOPE, {
      subject: "how many tools one document ends up holding",
      finding:
        `walking ${walk.length} page(s) in one tab, the live tool count peaked at ${peak}; the ` +
        `busiest single page registers ${registered}`,
      consequence:
        "Recorded because there is nothing to feature-detect here and no published limit. The " +
        "only number in circulation is a community report that somewhere near 296 registered " +
        "tools stops WebMCP working for the entire document — no error, nothing thrown, the whole " +
        "surface simply gone. Treat it as a reason to abort registrations you no longer need " +
        "rather than as a budget to spend down: the number is not a fact, and the failure it " +
        "describes is total.",
      source: WEBMCP.DOCUMENT_TOOL_CEILING,
    });
  }

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
