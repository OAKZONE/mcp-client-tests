/**
 * Tool-surface conformance: whether a client's gate will let the published tools run.
 *
 * Three families ask three different questions of one server. `discovery` and `oauth` ask whether a
 * client can **reach** it. `protocol` asks what it **publishes** when reached. This one asks the
 * question that is left, and the one a consumer usually arrives with: the server is up, the
 * connection is authorized, the revision is right, the tool is in the list — **and it still does not
 * run**, or it prompts on every call, or it is missing on one client and present on another.
 *
 * The answer is almost never the server's endpoint. Between `tools/list` and execution sit five
 * layers the client owns — admission, enablement, approval, classification, content scanning — and
 * a call can die at any of them with nothing reported back. `harness/tool-gating.ts` carries the
 * full model; what matters here is the consequence: **`annotations` is the only one of those layers
 * a server can steer from the wire**, so it is the only one this suite can assert on, and the rest
 * is advice that saves a consumer from debugging their own code.
 *
 * ## What fails here, and what only advises
 *
 * The split is **mechanical, not editorial**. Every clause carries an evidence grade, and `cite()`
 * refuses anything graded below `strong` — so a community-reported tool ceiling is *structurally
 * unable* to turn a consumer's run red, however tempting the number is.
 *
 * **Failures are facts a vendor states outright**: a tool publishes at least one behavioural hint
 * and a `title`; no tool claims to be read-only and destructive at once; every name fits the
 * 64-character budget one client publishes as its limit; no single tool spans safe and unsafe HTTP
 * methods; every schema property name survives the validation a client runs before offering the
 * tool; no description hides text a user cannot see.
 *
 * **Advisories are everything else** — the caps (one documented, two contested, four unknown), the
 * classifier that may veto a call anyway, descriptions that merely *read* as instructions, and the
 * count of tools that would run unprompted. Each prints its grade, so a reader weighs it rather
 * than taking a forum post for a specification.
 *
 * **Nothing here recommends removing a capability to get past a gate.** A destructive tool that is
 * the point of the server stays in the server; the fix is honest annotation, a `title` a human can
 * judge, and a confirmation the server owns rather than borrows.
 *
 * The suite needs **no capability**, like `protocol`: a public surface is read directly, a gated one
 * through a credential from the target's authorization capability.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import { MCP, VENDOR, cite } from "../../harness/specifications.js";
import {
  annotationProblem,
  concealedInstructionProblem,
  contradictoryHintProblem,
  instructionShapedDescription,
  mixedReadWriteProblem,
  readToolAnnotations,
  rootSchemaCombinatorProblem,
  schemaPropertyNameProblem,
  titleProblem,
  toolNameBudgetProblem,
  unpromptedToolCount,
  CLIENT_TOOL_NAME_BUDGET,
} from "../../harness/tool-gating.js";
import {
  nameSome,
  publishedToolNames,
  readPublishedTools,
  type PublishedTool,
} from "../../harness/tool-listing.js";
import {
  toolCapSummary,
  unannotatedConsequences,
} from "../../profiles/client-gates.js";
import type { McpTestTarget } from "../../target.js";
import { openWireConnection, type WireConnection } from "../protocol/connection.js";

const SUITE_ID = "tool-surface-gating";

/** The scope advisories are collected and printed under. */
const SCOPE = "MCP tool gating (what a client will let run)";

/**
 * The catalog size past which routing accuracy is the binding constraint rather than any cap.
 *
 * Not a client's number and deliberately not presented as one — every published ceiling is either
 * shared with other servers or ungraded. It is the point at which the *other* failure starts
 * dominating: a hard cap rejects loudly, while model routing degrades quietly and much earlier, and
 * a surface this size is worth a second look whoever is hosting it.
 */
const ROUTING_ATTENTION_THRESHOLD = 25;

/** Render a per-tool finding list, one line each, readable when a server publishes fifty tools. */
function findings(
  tools: readonly PublishedTool[],
  names: readonly string[],
  judge: (tool: PublishedTool) => string | undefined,
): readonly string[] {
  return tools
    .map((tool, index) => {
      const problem = judge(tool);
      return problem ? `\`${names[index]}\` ${problem}` : undefined;
    })
    .filter((entry): entry is string => entry !== undefined);
}

/**
 * Register the tool-gating conformance suite against one target.
 *
 * @param mcpTarget - The MCP server under test.
 */
export function defineToolGatingSuite(mcpTarget: McpTestTarget): void {
  describe(SCOPE, () => {
    let connection: WireConnection;
    let tools: readonly PublishedTool[] = [];
    let toolNames: readonly string[] = [];
    /**
     * Whether a list actually came back, as opposed to an empty one.
     *
     * The envelope rather than the tool count, because "this server publishes no tools" and "this
     * run could not read the list" are two different findings and must never be confused — and it
     * is deliberately not derived from {@link listAttempt}, whose text on a legacy-revision server
     * opens with the *stateless* attempt's failure even though the list was read.
     */
    let listed = false;
    /** What was tried to get a tool list, quoted in the failure when nothing came back. */
    let listAttempt = "";

    /**
     * Record everything the gate does that this server cannot assert its way out of.
     *
     * Collected once, from the list the suite already fetched. Nothing here fails: each is either a
     * fact below `strong` on the evidence scale, or a client behaviour no server can prevent — and
     * printing it is the difference between a consumer fixing their annotations and a consumer
     * spending a day on an endpoint that was never the problem.
     */
    function collectGateAdvisories(): void {
      const unprompted = unpromptedToolCount(tools);
      advise(SCOPE, {
        subject: "auto-permission",
        finding:
          `${unprompted} of ${tools.length} tools would run without a per-call prompt on a ` +
          "client that honours annotations" +
          (unprompted === 0
            ? " — every call this server serves is confirmed by hand, on every surface that asks"
            : ""),
        consequence:
          "This is the number that moves when the annotations land. A tool declaring " +
          "`readOnlyHint: true` can run unattended where the hints determine auto-permissions; " +
          "every other tool prompts, and on one client the approval is forgotten again at the " +
          "next refresh.",
        source: MCP.TOOL_ANNOTATIONS,
      });

      const partial = findings(tools, toolNames, (tool) => {
        const annotations = readToolAnnotations(tool);
        if (!annotations) return undefined;
        const missing = (
          [
            ["readOnlyHint", annotations.readOnlyHint],
            ["destructiveHint", annotations.destructiveHint],
            ["idempotentHint", annotations.idempotentHint],
            ["openWorldHint", annotations.openWorldHint],
          ] as const
        )
          .filter(([, value]) => value === undefined)
          .map(([hint]) => `\`${hint}\``);
        if (missing.length === 0 || missing.length === 4) return undefined;
        return `leaves ${missing.join(", ")} undeclared`;
      });
      if (partial.length > 0) {
        advise(SCOPE, {
          subject: "partly declared hints",
          finding: `${partial.length} tools declare some hints and not others:\n      ${partial.join("\n      ")}`,
          consequence:
            "An undeclared hint takes the specification's default rather than nothing: absent " +
            "`idempotentHint` denies a client the retry it would otherwise have made silently, " +
            "and absent `openWorldHint` leaves a closed-domain tool judged as though it reached " +
            "the open internet.",
          source: MCP.TOOL_ANNOTATION_DEFAULTS,
        });
      }

      const instructing = findings(tools, toolNames, (tool) =>
        instructionShapedDescription(tool.description),
      );
      if (instructing.length > 0) {
        advise(SCOPE, {
          subject: "descriptions that instruct",
          finding: `${instructing.length} descriptions read as directions to the model:\n      ${instructing.join("\n      ")}`,
          consequence:
            "A directory review rejects these outright, and a scanner cannot tell a legitimate " +
            "instruction from the tool-poisoning attack, so it treats it as the attack. This " +
            "check matches conservatively and can be wrong about yours — read the line before " +
            "changing it, and move anything cross-cutting into the server's `instructions` " +
            "metadata, which is the channel built to carry it.",
          source: VENDOR.ANTHROPIC_REVIEW_CRITERIA,
          relation: "reports",
        });
      }

      const combinators = findings(tools, toolNames, (tool) =>
        rootSchemaCombinatorProblem(tool.inputSchema),
      );
      if (combinators.length > 0) {
        advise(SCOPE, {
          subject: "schemas that branch at the root",
          finding: `${combinators.length} schemas branch at the root:\n      ${combinators.join("\n      ")}`,
          consequence:
            "The tool still works. What stops working is the constraint: the branch is flattened " +
            "into one object and described in prose prepended to your description, so anything " +
            "you were relying on the schema to reject now has to be rejected server-side.",
          source: VENDOR.ANTHROPIC_CLAUDE_CODE_MCP,
          relation: "reports",
        });
      }

      advise(SCOPE, {
        subject: "catalog size",
        finding:
          `this server publishes ${tools.length} tools, and the ceiling it is measured against ` +
          `is not its own:\n${toolCapSummary()}`,
        consequence:
          "The budget is spent across every server the user has connected, so the question is " +
          "not whether your catalog fits but whether their combination does — and over the line " +
          "the client chooses what to drop, in one reported case by keeping the " +
          "alphabetically-first tools and severing a namespace mid-way. Exactly one of the " +
          "numbers above is published by the vendor that enforces it; treat the rest as shape, " +
          "not as figures." +
          (tools.length > ROUTING_ATTENTION_THRESHOLD
            ? `\n      Past roughly ${ROUTING_ATTENTION_THRESHOLD} tools the binding constraint ` +
              "is usually not the cap at all: routing accuracy degrades with no error at all, " +
              "and the remedy is consolidating on workflows rather than endpoints."
            : ""),
        source: VENDOR.MICROSOFT_VSCODE_AGENT_TOOLS,
        relation: "reports",
      });

      const destructive = toolNames.filter(
        (_, index) => readToolAnnotations(tools[index])?.destructiveHint === true,
      );
      if (destructive.length > 0) {
        advise(SCOPE, {
          subject: "confirmation for irreversible calls",
          finding:
            `${destructive.length} tools declare themselves destructive: ${nameSome(destructive)}`,
          consequence:
            "Declaring it is right and this is not a request to stop. It is a reminder that the " +
            "client's prompt fails in both directions: it is absent wherever there is no human " +
            "— an API-side connector, a scheduled runner, a blanket auto-approve mode — and it " +
            "fires or blocks when you did not want it. Assume each of these runs unattended at " +
            "least once, and make sure the worst such call is one you would have approved: a " +
            "dry-run default, a `plan` → `apply` handle, or an idempotency key that makes the " +
            "duplicate a no-op.",
          source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
          relation: "reports",
        });
      }

      advise(SCOPE, {
        subject: "gates you cannot see or fix",
        finding:
          "several layers that stop a tool are configured on the client and are invisible from here",
        consequence:
          "An organization's per-tool `blocked` entry removes the tool before the model sees it; " +
          "a per-tool `ask` is overridden by no allow rule in any mode; one vendor's enterprise " +
          "MCP policy is off by default for the subscribers it covers; and a safety classifier " +
          "may veto a call that policy already allowed — one vendor publishes an 8.5% " +
          "first-stage false-positive rate, and its classifier is reasoning-blind by design, so " +
          "nothing your tool returns can argue with it. None of these is fixable by changing " +
          "this server. Say so in your own documentation, or your users will try anyway.",
        source: VENDOR.ANTHROPIC_MANAGED_MCP,
        relation: "reports",
      });
    }

    beforeAll(async () => {
      connection = await openWireConnection(mcpTarget, SUITE_ID);
      const listing = await readPublishedTools({
        target: connection.target,
        serverUrl: connection.serverUrl,
        accessToken: connection.accessToken,
      });
      tools = listing.tools;
      toolNames = publishedToolNames(tools);
      listed = listing.result !== undefined;
      listAttempt = listing.attempt;
      // Only when a list actually came back. Advising "0 of 0 tools would run unprompted" against a
      // run that never reached `tools/list` states a finding about a surface nobody looked at, and
      // it would print directly beneath the failure saying so.
      if (listed) collectGateAdvisories();
    }, 180_000);

    afterAll(async () => {
      reportAdvisories(SCOPE);
      await mcpTarget.authorization?.clearAccountHolders(SUITE_ID);
    });

    it("answers `tools/list` with a list this run can inspect", () => {
      // Deliberately uncited, exactly as in the protocol family: no specification requires a server
      // to publish tools, so this is a harness-integrity check rather than a conformance finding.
      // Every assertion below reads this list, and a green run that inspected nothing is the worst
      // outcome this package can produce.
      expect(
        listed ? `${tools.length} tools` : "no list",
        "The tool list could not be read on either revision, so every assertion below would " +
          "pass while inspecting nothing.\n" +
          `  what was tried:  ${listAttempt}\n` +
          "  If this server publishes no tools at all, this family has no subject — register it " +
          "once the surface exists.",
      ).not.toBe("no list");
    });

    describe("the hints the gate reads", () => {
      it("publishes a behavioural hint on every tool", () => {
        expect(
          findings(tools, toolNames, annotationProblem),
          cite(
            MCP.TOOL_ANNOTATION_DEFAULTS,
            "An unannotated tool is not neutral — it is maximally suspicious. The specification's " +
              "stated default is that a tool with no annotations is assumed non-read-only, " +
              "potentially destructive, non-idempotent and open-world, and shipping clients act " +
              "on exactly that:\n" +
              unannotatedConsequences() +
              "\n  Declare at least the hint that is true. Whether the hints are accurate is not " +
              "checkable from the wire and is not claimed here; their absence is.",
          ),
        ).toEqual([]);
      });

      it("publishes a human-readable `title` on every tool", () => {
        expect(
          findings(tools, toolNames, titleProblem),
          cite(
            VENDOR.ANTHROPIC_REVIEW_CRITERIA,
            "Every tool carries a `title` and the applicable hint. The `title` is what an approval " +
              "dialog shows in place of the symbol, so its absence decides what a user is asked " +
              "to consent to: `create_deployment` is a decision somebody can make, and " +
              "`svc_dpl_create_v2` is a decision they decline.",
          ),
        ).toEqual([]);
      });

      it("claims no tool is both read-only and destructive", () => {
        expect(
          findings(tools, toolNames, contradictoryHintProblem),
          cite(
            MCP.TOOL_ANNOTATIONS,
            "A tool cannot both be unable to change state and modify or delete. Clients must treat " +
              "annotations as untrusted, so a contradiction is resolved by the client rather than " +
              "by the server — and it may be resolved in whichever direction costs the user most.",
          ),
        ).toEqual([]);
      });
    });

    describe("the list the client actually receives", () => {
      it("keeps every tool name inside the budget a client publishes", () => {
        expect(
          toolNames
            .map((name) => {
              const problem = toolNameBudgetProblem(name);
              return problem ? `\`${name}\` ${problem}` : undefined;
            })
            .filter((entry): entry is string => entry !== undefined),
          cite(
            VENDOR.ANTHROPIC_REVIEW_CRITERIA,
            `"Tool names must be 64 characters or fewer" — half of what the specification permits, ` +
              `so a name legal by the protocol is still refused here. Budget to ` +
              `${CLIENT_TOOL_NAME_BUDGET} including any namespace prefix a client prepends, ` +
              "because an over-long name is reported to fail the whole server connection rather " +
              "than the one tool.",
          ),
        ).toEqual([]);
      });

      it("names every schema property inside the set a client validates against", () => {
        expect(
          findings(tools, toolNames, (tool) =>
            schemaPropertyNameProblem(tool.inputSchema),
          ),
          cite(
            VENDOR.ANTHROPIC_CLAUDE_CODE_MCP,
            "A client runs the API's own schema checks at load time and **excludes** each tool " +
              "that fails, writing the reason only to its own log. Top-level property names must " +
              "be 1–64 characters of ASCII letters, digits, `_`, `.` or `-`. The user sees a " +
              "shorter tool list and the server sees nothing at all — which is why a tool that " +
              "works in one client and is missing in another is this check far more often than " +
              "it is an authorization problem.",
          ),
        ).toEqual([]);
      });
    });

    describe("what the gate reads as hostile", () => {
      it("splits read from write, rather than spanning both in one tool", () => {
        expect(
          findings(tools, toolNames, mixedReadWriteProblem),
          cite(
            VENDOR.ANTHROPIC_REVIEW_CRITERIA,
            "A single tool accepting both safe (GET, HEAD, OPTIONS) and unsafe (POST, PUT, PATCH, " +
              "DELETE) methods is rejected, and a catch-all `api_request` with a `method` " +
              "parameter is named explicitly. It carries neither hint honestly, so it is gated as " +
              "destructive even on its read paths — and " +
              '"documenting safe versus unsafe operations within one tool\'s description does not ' +
              'satisfy this requirement". Split by verb.',
          ),
        ).toEqual([]);
      });

      it("hides nothing in a tool description that a user cannot see", () => {
        expect(
          findings(tools, toolNames, (tool) =>
            concealedInstructionProblem(tool.description),
          ),
          cite(
            VENDOR.INVARIANT_TOOL_POISONING,
            "Description text is the canonical prompt-injection vector: the disclosed attack hides " +
              "instructions in a description the user never reads and the model always does. " +
              "Zero-width and bidirectional-control characters, text inside HTML comments, and " +
              "instructions to ignore what was said elsewhere have no legitimate use in text " +
              "whose only job is to describe — so they are treated as the attack wherever they " +
              "appear, including here.",
          ),
        ).toEqual([]);
      });
    });
  });
}
