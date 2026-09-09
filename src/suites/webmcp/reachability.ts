/**
 * WebMCP conformance: whether the API exists for the visitor at all.
 *
 * **Reachability and registration fail independently, and from the page they look the same.** A
 * perfectly written `registerTool` call reaches nobody if `document.modelContext` is undefined in
 * the browser that loaded the page — and in a stock production browser that object exists only where
 * the response carried an origin-trial token. So the other suites can be entirely green about a
 * surface no visitor can see.
 *
 * Chrome takes the token from an `Origin-Trial` response header or a
 * `<meta http-equiv="origin-trial">`, ignores invalid or expired ones, and uses the first valid
 * token it finds. All of that arrives over the same socket as everything else this package asserts
 * on, so this suite needs no browser and runs beside the declarative one.
 *
 * ## The failure it was written for
 *
 * The token is read from **the response that carried it**, so a response served without it is a
 * response with no WebMCP. Attach the header to a rule that can decline to match and the API is dead
 * for exactly the visitors that rule declines — and alive for everyone else, including every
 * developer who ever loaded the page. A real deployment attached it to a rule that also carried
 * cache conditions: it would have been off for exactly the visitors holding one particular cookie.
 *
 * A single fetch cannot see that, which is why every page here is fetched twice, differing only by
 * an unrelated cookie.
 *
 * ## What it will not conclude
 *
 * A page serving no token is **not** failed. It may be reached with a flag, or not be meant for
 * production browsers yet; that is an advisory naming what a stock browser would find. Only a token
 * that is served and cannot work — expired, or issued for another origin — is a failure, because
 * that one is a deployment that believes it is enrolled and is not.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import {
  edgeTargetFor,
  readRunningDeployment,
  type RunningDeployment,
} from "../../harness/deployment.js";
import { edgeRequest, type EdgeTarget } from "../../harness/edge-transport.js";
import { IETF, WEBMCP, cite } from "../../harness/specifications.js";
import {
  conditionalDeliveryProblem,
  decodeOriginTrialToken,
  originCanHoldTrialToken,
  originTrialCoverage,
  originTrialProblem,
  servedOriginTrialTokens,
  type ServedOriginTrialToken,
} from "../../harness/webmcp-origin-trial.js";
import type { McpTestTarget } from "../../target.js";

const SCOPE = "WebMCP reachability";

/**
 * A cookie no deployment can be expected to know, carried on the second fetch of every page.
 *
 * It exists to be *unrelated*: the point is that two requests differing only by a cookie a
 * deployment has never heard of must be served the same trial token, because a visitor arrives
 * carrying whatever their browser has and no rule keyed on that may decide whether the API exists.
 */
const PROBE_COOKIE = "mcp_client_tests_probe=1";

/** One page, fetched the ordinary way and again with an unrelated cookie. */
interface ReachabilityReading {
  readonly path: string;
  readonly status: number;
  readonly statusWithExtraCookie: number;
  readonly tokens: readonly ServedOriginTrialToken[];
  readonly tokensWithExtraCookie: readonly ServedOriginTrialToken[];
  /** The response's `Vary`, which says what the cache was allowed to key on. */
  readonly vary?: string;
}

/**
 * Register the WebMCP reachability suite against one target.
 *
 * @param mcpTarget - The deployment under test.
 */
export function defineWebMcpReachabilitySuite(mcpTarget: McpTestTarget): void {
  describe.skipIf(!mcpTarget.webMcp)("WebMCP reachability", () => {
    let deployment: RunningDeployment;
    let target: EdgeTarget;
    let pages: ReachabilityReading[] = [];

    const capability = mcpTarget.webMcp ?? { toolPages: [] };

    beforeAll(async () => {
      deployment = readRunningDeployment(mcpTarget.id);
      target = edgeTargetFor(deployment);

      const viewer = capability.viewerCookie
        ? `${capability.viewerCookie.name}=${capability.viewerCookie.value}`
        : undefined;

      pages = [];
      for (const path of capability.toolPages) {
        const pageUrl = new URL(path, deployment.canonicalOrigin).toString();
        const plain = await edgeRequest(target, pageUrl, {
          headers: viewer ? { cookie: viewer } : {},
        });
        // Identical but for a cookie nothing on the deployment knows about. Any difference in what
        // comes back is a difference no visitor chose.
        const probed = await edgeRequest(target, pageUrl, {
          headers: { cookie: viewer ? `${viewer}; ${PROBE_COOKIE}` : PROBE_COOKIE },
        });

        pages.push({
          path,
          status: plain.status,
          statusWithExtraCookie: probed.status,
          tokens: servedOriginTrialTokens(plain.headers, plain.status === 200 ? plain.text() : ""),
          tokensWithExtraCookie: servedOriginTrialTokens(
            probed.headers,
            probed.status === 200 ? probed.text() : "",
          ),
          vary: plain.headers.get("vary") ?? undefined,
        });
      }
    }, 120_000);

    afterAll(() => {
      reportAdvisories(SCOPE);
    });

    it("keeps every origin-trial token it serves usable on the origin it serves it from", () => {
      const now = new Date();
      const problems = pages
        .filter((page) => page.status === 200)
        .map((page) => {
          const problem = originTrialProblem(page.tokens, mcpTarget.canonicalOrigin, now);
          return problem ? `${page.path}: ${problem}` : undefined;
        })
        .filter((entry): entry is string => entry !== undefined);

      expect(
        problems,
        cite(
          WEBMCP.ORIGIN_TRIAL_DELIVERY,
          "Chrome ignores invalid and expired origin-trial tokens and enrols only the origin a " +
            "token was issued for, so a page serving nothing but unusable tokens has no WebMCP at " +
            "all in a stock browser — while looking, from the deployment's side, exactly like a " +
            "page that is enrolled. Every tool on it is unreachable, silently, for every visitor " +
            "who has not set a flag.\n" +
            "  Renew the token, or register one for the origin these pages are actually served " +
            "on. A page that serves no token at all is not failed here; that is an advisory, " +
            "because reaching it with a flag is a legitimate arrangement.",
        ),
      ).toEqual([]);
    });

    it("serves the origin-trial token unconditionally", () => {
      const conditional = pages
        .filter((page) => page.status === 200 && page.statusWithExtraCookie === page.status)
        .map((page) => {
          const problem = conditionalDeliveryProblem(page.tokens, page.tokensWithExtraCookie);
          return problem ? `${page.path}: ${problem}` : undefined;
        })
        .filter((entry): entry is string => entry !== undefined);

      expect(
        conditional,
        cite(
          WEBMCP.ORIGIN_TRIAL_DELIVERY,
          "The token is read from the response that carried it, so a response served without it " +
            "is a response with no WebMCP. These two requests differed only by a cookie this " +
            "deployment has never heard of, and were answered differently — which means the API " +
            "exists for some visitors and not others, decided by something no visitor chose.\n" +
            "  The usual cause is a header attached to a rule that also carries conditions: a " +
            "cache rule, a cookie match, a bot check. It works perfectly for every developer and " +
            "for most users, and it is off for exactly the population the condition selects. " +
            "Attach the `Origin-Trial` header unconditionally, on its own rule.",
        ),
      ).toEqual([]);
    });

    it("records what a stock browser would find on these pages", () => {
      collectAdvisories(pages, mcpTarget.canonicalOrigin);

      expect(pages.length, "The `webMcp` capability declared no pages to inspect.").toBeGreaterThan(
        0,
      );
    });
  });
}

/**
 * Record what was served, what it decodes to, and what this run could not observe.
 *
 * @param pages - Every page fetched this run.
 * @param canonicalOrigin - The origin the deployment believes it is served on.
 */
function collectAdvisories(
  pages: readonly ReachabilityReading[],
  canonicalOrigin: string,
): void {
  // Stated once per run, unconditionally, because it is what a reader will otherwise use to check
  // this suite's own findings by hand — and it does not mean what they will take it to mean.
  advise(SCOPE, {
    subject: "confirming any of this in DevTools",
    finding:
      "the DevTools WebMCP pane and the WebMCP API are not on the same switch, so an empty pane " +
      "is equally consistent with a browser that has no API and a page that registered no tools",
    consequence:
      "Read the pane only alongside `typeof document.modelContext` in the same browser's console. " +
      "An empty pane on a page you instrumented sends you to debug the page, and the browser is " +
      "the more likely culprit: the pane ships to stable while the API stays behind the flag and " +
      "the origin trial.",
    source: WEBMCP.DEVTOOLS_PANE_IS_NOT_EVIDENCE,
  });

  // A property of the origin this run was driven under, not of any one page, so it is stated once.
  if (!originCanHoldTrialToken(canonicalOrigin) && pages.some((page) => page.tokens.length > 0)) {
    advise(SCOPE, {
      subject: "the origin your tokens name was not judged",
      finding:
        `this run drove the deployment under ${canonicalOrigin}, a name that never resolves, so ` +
        "no origin trial could ever be registered for it",
      consequence:
        "Your token therefore names a different origin by necessity, and failing you for that " +
        "would be reporting this run's own choice of origin as your defect. The expiry was still " +
        "checked, and so was whether the token is served unconditionally. What this run cannot " +
        "tell you is whether the token covers the origin you really serve on — confirm by hand " +
        "that the origin it was issued for matches production, including the port and whether it " +
        "covers subdomains. Running with a routable `canonicalOrigin` judges it here instead.",
      source: IETF.RESERVED_UNROUTABLE_NAMES,
    });
  }

  for (const page of pages) {
    if (page.status !== 200) {
      advise(SCOPE, {
        subject: `${page.path} — not read`,
        finding: `the page answered ${page.status}, so nothing about its reachability was observed`,
        consequence:
          "This is a gap in the run rather than a finding: the declarative suite asserts that " +
          "your declared pages render, and this one says only that it could not look.",
        source: WEBMCP.ORIGIN_TRIAL_DELIVERY,
      });
      continue;
    }

    if (page.statusWithExtraCookie !== page.status) {
      advise(SCOPE, {
        subject: `${page.path} — the conditional-delivery check`,
        finding:
          `the same request carrying one unrelated cookie answered ${page.statusWithExtraCookie} ` +
          `instead of ${page.status}, so the two responses were not comparable`,
        consequence:
          "The check that a trial token is served unconditionally was skipped for this page — it " +
          "compares two responses, and these two differ in more than the token. Worth a look on " +
          "its own account: an unknown cookie changing a page's status is rarely intended.",
        source: WEBMCP.ORIGIN_TRIAL_DELIVERY,
      });
    }

    if (page.tokens.length === 0 && page.tokensWithExtraCookie.length === 0) {
      advise(SCOPE, {
        subject: `${page.path} — no origin-trial token`,
        finding:
          "the response carried no `Origin-Trial` header and the document no " +
          "`<meta http-equiv=\"origin-trial\">`",
        consequence:
          "In a stock browser `document.modelContext` is then undefined on this page and every " +
          "tool it registers is unreachable — the registration is fine and nothing is there to " +
          "call it. That is correct if these pages are only ever reached with " +
          "`chrome://flags/#enable-webmcp-testing` set, which is how this package's own browser " +
          "suites reach them. It is a silent outage if you expected real visitors to have the API.",
        source: WEBMCP.ORIGIN_TRIAL_DELIVERY,
      });
      continue;
    }

    for (const served of page.tokens) {
      const payload = decodeOriginTrialToken(served.token);
      if (!payload) {
        advise(SCOPE, {
          subject: `${page.path} — a token this run could not read`,
          finding: `a token served by ${served.delivery} did not decode`,
          consequence:
            "Its expiry and the origin it enrols were therefore not checked. This says the " +
            "parser did not understand the token, never that the token is bad — the layout is " +
            "not part of Chrome's published origin-trial documentation, so a format change lands " +
            "here as an unread token rather than as a finding against you.",
          source: WEBMCP.ORIGIN_TRIAL_TOKEN_PAYLOAD,
        });
        continue;
      }

      const coverage = originTrialCoverage(payload, canonicalOrigin);
      const coverageLabel =
        coverage === "mismatch" ? "does not cover this run's origin" : `${coverage} match`;
      const days = Math.round((payload.expiry.getTime() - Date.now()) / 86_400_000);
      advise(SCOPE, {
        subject: `${page.path} — the \`${payload.feature}\` origin trial`,
        finding:
          `a v${payload.version} token served by ${served.delivery}, issued for ${payload.origin}` +
          `${payload.isSubdomain ? " and its subdomains" : ""} (${coverageLabel}), expiring ` +
          `${payload.expiry.toISOString().slice(0, 10)} — ${days} day(s) from now`,
        consequence:
          "Recorded so the expiry is visible before it arrives rather than after: the day it " +
          "passes, Chrome ignores the token, `document.modelContext` stops existing for every " +
          "visitor, and nothing on the page errors. Nothing in your code changes and every tool " +
          "goes quiet.",
        source: WEBMCP.ORIGIN_TRIAL_TOKEN_PAYLOAD,
      });
    }

    if (page.vary && /\bcookie\b/i.test(page.vary) && page.tokens.length > 0) {
      advise(SCOPE, {
        subject: `${page.path} — the token's response varies by cookie`,
        finding: `the response carrying the token declares \`Vary: ${page.vary}\``,
        consequence:
          "This run's two fetches were served the same token, so nothing is wrong today. It is " +
          "worth knowing that the response carrying your trial token is cached per cookie: the " +
          "next rule added beside it inherits that keying, and a token that stops being served " +
          "to one cohort disables WebMCP for exactly that cohort with nothing in any log to say " +
          "so.",
        source: WEBMCP.ORIGIN_TRIAL_DELIVERY,
      });
    }
  }
}
