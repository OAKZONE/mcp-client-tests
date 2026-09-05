/**
 * WebMCP conformance: what a page hands to an in-browser agent.
 *
 * **This family asserts against a different specification from every other one in this package.**
 * WebMCP is the W3C Web Machine Learning Community Group draft that lets a page register its own
 * functions as typed tools for an agent attached to the browser. It borrows MCP's vocabulary and
 * none of its wire — no JSON-RPC, no transport, no server, no OAuth — so nothing in the MCP
 * revisions binds a tool published here, and no assertion below cites one.
 *
 * ## What crosses the socket, and what the run therefore cannot see
 *
 * This package proves the wire. The **declarative** API is served HTML, so it is proved here in the
 * ordinary way: the page is fetched through the same proxy translation every other suite uses, and
 * the tools are read out of the markup.
 *
 * The **imperative** API is not. `document.modelContext.registerTool(...)` is a JavaScript call in
 * the user's tab; observing whether it ran, and what it registered, needs a real browser executing
 * Chrome's origin trial, which this package does not ship. **The suite says so in an advisory on
 * every run** rather than letting a page whose tools are all imperative read as a page with no
 * tools — a green run that silently checked nothing is the worst outcome available here, and on
 * this surface it is the easy one to produce.
 *
 * What the served text *does* settle is the migration that breaks registration silently: the
 * object moved from `navigator.modelContext` to `document.modelContext`, Chrome deprecated the old
 * spelling in 150.0.7861.0 and plans to remove it, and much third-party writing still shows it.
 *
 * ## Why almost everything here is an advisory
 *
 * By the explainer's own account the declarative half is the less finished half: input-schema
 * synthesis is marked TBD, the response mechanism is "currently under debate", and `outputSchema`
 * support and declarative visibility through `getTools()` are unresolved. Asserting a requirement
 * onto an unsettled draft would fail correct pages, so only what the specification *states* is
 * asserted; everything the security questionnaire and the explainer *advise* is advised.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import {
  edgeTargetFor,
  readRunningDeployment,
  type RunningDeployment,
} from "../../harness/deployment.js";
import { edgeRequest, type EdgeTarget } from "../../harness/edge-transport.js";
import { WEBMCP, cite } from "../../harness/specifications.js";
import {
  declarativeToolProblem,
  declarativeWebMcpTools,
  duplicateDeclarativeToolNames,
  imperativeRegistrationStyle,
  inlineScriptText,
  triageScriptUrls,
  undescribedParameters,
  type DeclarativeWebMcpTool,
} from "../../harness/webmcp-surface.js";
import type { McpTestTarget } from "../../target.js";

const SCOPE = "WebMCP page tool surface";

/** One fetched page, with everything the assertions below read from it. */
interface FetchedPage {
  readonly path: string;
  readonly status: number;
  readonly tools: readonly DeclarativeWebMcpTool[];
  /** Inline scripts plus every same-origin bundle, concatenated. */
  readonly scriptText: string;
  /** Scripts on an origin the deployment did not declare. Never fetched. */
  readonly blockedScripts: readonly string[];
  /** Scripts this run was allowed to fetch and could not. Never a finding about the server. */
  readonly unreadableScripts: readonly string[];
}

/**
 * Register the WebMCP conformance suite against one target.
 *
 * Skipped unless the target declares the `webMcp` capability, because without a page list there is
 * nothing to fetch — and crawling for one would report the crawler's reach as a finding about the
 * server.
 *
 * @param mcpTarget - The deployment under test.
 */
export function defineWebMcpDeclarativeSuite(mcpTarget: McpTestTarget): void {
  describe.skipIf(!mcpTarget.webMcp)("WebMCP page tool surface", () => {
    let deployment: RunningDeployment;
    let target: EdgeTarget;
    let pages: FetchedPage[] = [];

    // `describe.skipIf` stops the tests RUNNING, but this body still executes at collection time,
    // so a target without the capability must not dereference it here.
    const capability = mcpTarget.webMcp ?? { toolPages: [] };

    beforeAll(async () => {
      deployment = readRunningDeployment(mcpTarget.id);
      target = edgeTargetFor(deployment);

      pages = [];
      for (const path of capability.toolPages) {
        const pageUrl = new URL(path, deployment.canonicalOrigin).toString();
        const headers: Readonly<Record<string, string>> = capability.viewerCookie
          ? { cookie: `${capability.viewerCookie.name}=${capability.viewerCookie.value}` }
          : {};
        const response = await edgeRequest(target, pageUrl, { headers });
        const html = response.status === 200 ? response.text() : "";

        // Registration almost never lives in an inline script in a real application, so reading
        // only those would report every bundled page as registering nothing.
        const scripts = triageScriptUrls(html, pageUrl, capability.scriptOrigins);
        const bundles: string[] = [];
        const unreadable: string[] = [];

        // Same-origin bundles ride the deployment's own edge, like every other request this
        // package makes.
        for (const scriptUrl of scripts.sameOrigin) {
          const bundle = await edgeRequest(target, scriptUrl, { headers });
          if (bundle.status === 200) bundles.push(bundle.text());
          else unreadable.push(`${scriptUrl} answered ${bundle.status}`);
        }

        // Declared cross-origin bundles cannot go through the edge, which serves one origin by
        // design, so they are fetched directly. A failure here is never a finding about the
        // deployment — a CDN can be slow, rate-limited, or unreachable from CI — so it is
        // collected and advised on rather than thrown.
        for (const scriptUrl of scripts.allowed) {
          try {
            const bundle = await fetch(scriptUrl, { signal: AbortSignal.timeout(15_000) });
            if (bundle.ok) bundles.push(await bundle.text());
            else unreadable.push(`${scriptUrl} answered ${bundle.status}`);
          } catch (error) {
            unreadable.push(
              `${scriptUrl} could not be fetched ` +
                `(${error instanceof Error ? error.message : String(error)})`,
            );
          }
        }

        pages.push({
          path,
          status: response.status,
          tools: declarativeWebMcpTools(html),
          scriptText: [inlineScriptText(html), ...bundles].join("\n"),
          blockedScripts: scripts.blocked,
          unreadableScripts: unreadable,
        });
      }
    }, 120_000);

    afterAll(() => {
      reportAdvisories(SCOPE);
    });

    it("serves every page the target declares as publishing tools", () => {
      const unreachable = pages
        .filter((page) => page.status !== 200)
        .map((page) => `${page.path} answered ${page.status}`);

      // Not a WebMCP requirement — a page that does not render cannot publish tools, so this is the
      // gate that stops every assertion below from passing against an error page.
      expect(
        unreachable,
        `The target declares these paths as publishing WebMCP tools, and they did not render: ` +
          `${unreachable.join("; ")}. Either the page moved, or it is behind a session the ` +
          "`viewerCookie` capability field is not carrying.",
      ).toEqual([]);
    });

    it("gives every declarative tool the description a model chooses it by", () => {
      const problems = pages.flatMap((page) =>
        page.tools
          .map((tool) => {
            const problem = declarativeToolProblem(tool);
            return problem ? `${page.path}: \`${tool.name}\` ${problem}` : undefined;
          })
          .filter((entry): entry is string => entry !== undefined),
      );

      expect(
        problems,
        cite(
          WEBMCP.TOOL_SHAPE,
          "`ModelContextTool` requires a `name` and a `description`, and the declarative API takes " +
            "them from `toolname` and `tooldescription`. A tool published with only a name asks a " +
            "model to choose it on the name alone, which is how an agent calls the wrong one.",
        ),
      ).toEqual([]);
    });

    it("keeps tool names unique within each document", () => {
      const collisions = pages.flatMap((page) =>
        duplicateDeclarativeToolNames(page.tools).map((name) => `${page.path}: \`${name}\``),
      );

      expect(
        collisions,
        cite(
          WEBMCP.DECLARATIVE_API,
          "Tools are registered per `Document`, so two forms claiming one `toolname` leave the " +
            "agent unable to address either predictably — and which one it reaches is a race " +
            "between implementations, not a documented choice.",
        ),
      ).toEqual([]);
    });

    it("records what this run could not observe, and what the pages published", () => {
      collectAdvisories(pages);

      // The assertion is that the run had something to look at. A page list that produced no tools
      // and no visible registration means the family inspected nothing, and the advisories above
      // are what say so — this keeps that from being reported as a pass with no caveat.
      expect(pages.length, "The `webMcp` capability declared no pages to inspect.").toBeGreaterThan(
        0,
      );
    });
  });
}

/**
 * Record everything the specification offers, or warns about, that the pages did not do.
 *
 * @param pages - Every page fetched this run.
 */
function collectAdvisories(pages: readonly FetchedPage[]): void {
  // Stated once per run, unconditionally, because it bounds every other line in this report.
  advise(SCOPE, {
    subject: "the imperative API",
    finding:
      "this run read only the declarative API — the `toolname` / `tooldescription` attributes in " +
      "the served HTML — because `document.modelContext.registerTool(...)` is a JavaScript call " +
      "that never crosses a socket",
    consequence:
      "A page whose tools are all registered imperatively is reported here as publishing none, " +
      "and that is a limit of this run rather than a finding about the page. Confirm the real " +
      "surface in Chrome's DevTools under Application → WebMCP, which lists every tool detected " +
      "on the tab as the agent sees it; an empty pane on a page you instrumented means the " +
      "registration call never landed.",
    source: WEBMCP.DOCUMENT_MODEL_CONTEXT,
  });

  for (const page of pages) {
    if (page.status !== 200) continue;

    const style = imperativeRegistrationStyle(page.scriptText);

    if (page.blockedScripts.length > 0 && style === "none") {
      advise(SCOPE, {
        subject: `${page.path} — scripts this run did not read`,
        finding:
          `the page loads ${page.blockedScripts.length} script(s) from an origin the target does ` +
          `not declare (${page.blockedScripts.slice(0, 3).join(", ")}), and no registration was ` +
          "found in what was read",
        consequence:
          "Cross-origin bundles are fetched only from origins named in the `webMcp.scriptOrigins` " +
          "capability, so an undeclared one is never pulled into your CI and never reported as " +
          "your defect. If your own registration lives in one of these, add its origin there and " +
          "the `navigator` versus `document` check will cover it — that check reads source text, " +
          "and it is the only place the page's choice of spelling is visible at all.",
        source: WEBMCP.DOCUMENT_MODEL_CONTEXT,
      });
    }

    if (page.unreadableScripts.length > 0) {
      advise(SCOPE, {
        subject: `${page.path} — scripts this run could not read`,
        finding: page.unreadableScripts.join("; "),
        consequence:
          "These were allowed to be fetched and did not come back, so whatever they register was " +
          "not searched. This is a gap in the run rather than a defect in the server — a CDN can " +
          "be slow, rate-limited, or unreachable from CI — which is why it is said here instead " +
          "of failing the suite.",
        source: WEBMCP.DOCUMENT_MODEL_CONTEXT,
      });
    }

    if (style === "navigator") {
      advise(SCOPE, {
        subject: `${page.path} — the deprecated entry point`,
        finding:
          "the page's inline scripts reach `navigator.modelContext` and never " +
          "`document.modelContext`",
        consequence:
          "Tools are per-`Document`, and the object moved to `document` for that reason. Chrome " +
          "deprecated the `navigator` spelling in 150.0.7861.0 and keeps it only as an alias it " +
          "plans to remove, so this registers today and stops registering on an unannounced " +
          "browser update — silently, because nothing errors. Feature-detect both " +
          "(`document.modelContext ?? navigator.modelContext`); never version-detect.",
        source: WEBMCP.DOCUMENT_MODEL_CONTEXT,
      });
    }

    if (page.tools.length === 0) {
      advise(SCOPE, {
        subject: `${page.path} — no declarative tools`,
        finding:
          "the page published no form carrying `toolname`" +
          (style === "none"
            ? ", and its inline scripts register nothing imperatively either"
            : `, though its scripts do reach the imperative API (\`${style}\`)`),
        consequence:
          style === "none"
            ? "Every assertion in this family therefore inspected nothing on this page and " +
              "passed. That is correct — no specification requires a page to publish tools — but " +
              "it is worth saying out loud, because a green run reads as a surface that was " +
              "checked. If the tools are registered from an external bundle, this run could not " +
              "see them."
            : "The declarative assertions inspected nothing on this page. The imperative tools " +
              "are real and unverified here; check them in DevTools under Application → WebMCP.",
        source: WEBMCP.DECLARATIVE_API,
      });
      continue;
    }

    for (const tool of page.tools) {
      const undescribed = undescribedParameters(tool);
      if (undescribed.length > 0) {
        advise(SCOPE, {
          subject: `${page.path} — \`${tool.name}\` parameters`,
          finding: `${undescribed.map((name) => `\`${name}\``).join(", ")} carry no \`toolparamdescription\``,
          consequence:
            "Each control's `toolparamdescription` becomes that property's description in the " +
            "synthesized schema. Without one the model infers the meaning from the form-field " +
            "name, which is how an agent fills a field confidently and wrongly — and the page " +
            "then executes it in the user's own session.",
          source: WEBMCP.DECLARATIVE_API,
        });
      }

      if (tool.autoSubmit) {
        advise(SCOPE, {
          subject: `${page.path} — \`${tool.name}\` submits without review`,
          finding: "the form carries `toolautosubmit`",
          consequence:
            "That is a consent decision wearing the clothes of a convenience flag. The tool runs " +
            "in the user's tab, in their live authenticated session, called by a model reading " +
            "page text it did not write — so an injected instruction in a review, a comment or a " +
            "filename reaches it with no confirmation step in between. Anything that moves money, " +
            "deletes, publishes, or messages other people belongs behind a real confirmation in " +
            "your own UI, never behind this attribute and never behind an annotation hint.",
          source: WEBMCP.AUTOSUBMIT_IS_CONSENT,
        });
      }

      // Over-parameterization is a leak on its own: the questionnaire's point is that a tool asking
      // for a non-minimal set causes leakage simply by being called, before anyone misuses it.
      const optional = tool.parameters.filter((parameter) => !parameter.required);
      if (tool.parameters.length >= 6 && optional.length > tool.parameters.length / 2) {
        advise(SCOPE, {
          subject: `${page.path} — \`${tool.name}\` parameter breadth`,
          finding:
            `the tool takes ${tool.parameters.length} parameters, ${optional.length} of them ` +
            "optional",
          consequence:
            "A tool asking for more than the operation needs leaks by being called, not by being " +
            "misused — the agent fills what it can, from whatever the page and the conversation " +
            "put in front of it. Ask for the least the operation needs, and split a broad form " +
            "into narrower tools where the operations are genuinely different.",
          source: WEBMCP.MINIMAL_PARAMETERS,
        });
      }
    }
  }
}
