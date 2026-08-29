/**
 * Protocol conformance: what the server publishes, on the wire, against revision `2026-07-28`.
 *
 * The OAuth family asks whether a client can *reach* this server. This one asks what it finds when
 * it gets there — and the answer moved on 2026-07-28, in the direction that is hardest to notice.
 * The stateless revision is mostly subtractive: it removes the `initialize` handshake, removes
 * `Mcp-Session-Id`, makes `server/discover` mandatory, and makes freshness hints required on every
 * list. A server built on the old assumptions keeps passing its own tests the whole time, because
 * nothing it does became *wrong* — the ground moved instead.
 *
 * ## What fails here, and what only advises
 *
 * **Failures are requirements**: `server/discover` answers, no session is minted for a stateless
 * request, caching hints are present, tool names are inside the published vocabulary, every
 * `inputSchema` is a JSON Schema object, the list is stable across connections, and an unknown tool
 * comes back through the protocol channel rather than as a tool result.
 *
 * **Advisories are everything the revision offers and does not require** — server `instructions`,
 * `icons[]`, tool descriptions, an `outputSchema`, a `listChanged` declaration. Each is something at
 * least one shipping client will use and this server has not published. They are printed after the
 * suite and never fail the run, so adopting a new version of this package can turn a green run red
 * only through a real requirement. See `harness/advisory.ts`.
 *
 * **One thing is advised rather than asserted because its placement is not established** in the
 * sources this package is written from: `resultType` on a *list* result. Pinning an uncertain
 * placement as a requirement risks failing a correct server, which is the failure mode that gets a
 * whole gate switched off.
 *
 * The suite needs **no capability**. A server with no authorization at all gets every assertion
 * below; one that gates its endpoint gets them through a credential obtained from the target's
 * authorization capability (`connection.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import {
  MCP_STATELESS_REVISION,
  discoverMessage,
  firstError,
  firstResult,
  initializeMessage,
  listToolsMessage,
  mcpRequest,
  statelessMessage,
  type McpExchange,
} from "../../harness/mcp-client.js";
import {
  advertisedVersions,
  duplicateToolNames,
  iconSourcingProblem,
  inputSchemaProblem,
  publishedIcons,
  readCachingHints,
  resultTypeOf,
  serverIdentity,
  toolNameProblem,
  type ServerIdentity,
} from "../../harness/mcp-surface.js";
import { MCP, VENDOR, cite } from "../../harness/specifications.js";
import type { McpTestTarget } from "../../target.js";
import { openWireConnection, type WireConnection } from "./connection.js";

const SUITE_ID = "protocol-wire";

/** The scope advisories are collected and printed under. */
const SCOPE = "MCP wire conformance (revision 2026-07-28)";

/** Every method the caching contract names, less `resources/read`, which needs a URI first. */
const CACHEABLE_LIST_METHODS = [
  "server/discover",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
] as const;

/** A tool name no server publishes, used to prove the protocol error channel. */
const ABSENT_TOOL = "mcp-client-tests.no-such-tool";

/** Name a few of many, so a finding stays readable when a server has fifty tools. */
function nameSome(names: readonly string[], limit = 4): string {
  const shown = names.slice(0, limit).map((name) => `\`${name}\``).join(", ");
  const rest = names.length - limit;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/** A tool as published. */
interface PublishedTool {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly icons?: unknown;
}

/**
 * Register the wire conformance suite against one target.
 *
 * @param mcpTarget - The MCP server under test.
 */
export function defineWireConformanceSuite(mcpTarget: McpTestTarget): void {
  describe(SCOPE, () => {
    let connection: WireConnection;
    let discover: McpExchange;
    let discoverResult: Record<string, unknown> | undefined;
    /**
     * Whichever orientation result this server actually answers, and what it was.
     *
     * Server identity, `instructions` and the capability declaration ride the protocol's own
     * metadata channel — the `server/discover` result on this revision, the `initialize` result on
     * the older one. Reading only the first would report a server that publishes all three on
     * `initialize` as publishing none of them, which is a false finding on top of a true one.
     */
    let orientation: Record<string, unknown> | undefined;
    let orientationSource = "";
    let identity: ServerIdentity | undefined;
    let tools: readonly PublishedTool[] = [];
    let toolNames: readonly string[] = [];
    /** The `tools/list` result itself, which carries the caching hints the list rode in on. */
    let toolsListResult: Record<string, unknown> | undefined;
    /** What was tried to get a tool list, quoted in the failure when nothing came back. */
    let listAttempt = "";

    /** One request on the stateless revision, carrying the run's credential when it has one. */
    async function call(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<McpExchange> {
      return mcpRequest(
        connection.target,
        connection.serverUrl,
        statelessMessage(method, params),
        { revision: MCP_STATELESS_REVISION, accessToken: connection.accessToken },
      );
    }

    /**
     * Read the tool list on whichever revision this server answers.
     *
     * The stateless shape is tried first because it is the one under test. A server still on
     * `2025-11-25` is not refused here — its tool list is fetched through the handshake instead, so
     * that the revision-independent assertions (names, schemas, ordering, error channels) still run
     * and report real findings rather than one uninformative failure about the revision.
     */
    async function listToolsOnEitherRevision(): Promise<
      readonly PublishedTool[]
    > {
      const stateless = await call("tools/list");
      const statelessResult = firstResult(stateless);
      if (Array.isArray(statelessResult?.tools)) {
        listAttempt = "listed on 2026-07-28";
        toolsListResult = statelessResult;
        return statelessResult.tools as PublishedTool[];
      }
      const statelessNote =
        `2026-07-28 \`tools/list\` answered http ${stateless.http.status}` +
        (firstError(stateless) ? ` / ${firstError(stateless)!.message}` : "");

      await mcpRequest(connection.target, connection.serverUrl, initializeMessage(), {
        accessToken: connection.accessToken,
      });
      const legacy = await mcpRequest(
        connection.target,
        connection.serverUrl,
        listToolsMessage(),
        { accessToken: connection.accessToken },
      );
      const legacyResult = firstResult(legacy);
      if (Array.isArray(legacyResult?.tools)) {
        listAttempt = `${statelessNote}; listed on 2025-11-25 after \`initialize\` instead`;
        toolsListResult = legacyResult;
        return legacyResult.tools as PublishedTool[];
      }
      listAttempt =
        `${statelessNote}; 2025-11-25 \`initialize\` + \`tools/list\` answered ` +
        `http ${legacy.http.status}` +
        (firstError(legacy) ? ` / ${firstError(legacy)!.message}` : "");
      return [];
    }

    /**
     * Read the server's orientation from whichever channel it answers.
     *
     * @returns The orientation result and the name of the channel that carried it.
     */
    async function orientate(): Promise<{
      result?: Record<string, unknown>;
      source: string;
    }> {
      if (discoverResult) {
        return { result: discoverResult, source: "`server/discover`" };
      }
      const initialized = await mcpRequest(
        connection.target,
        connection.serverUrl,
        initializeMessage(),
        { accessToken: connection.accessToken },
      );
      const result = firstResult(initialized);
      return {
        result,
        source: result
          ? "`initialize` (revision 2025-11-25)"
          : "neither `server/discover` nor `initialize`",
      };
    }

    /**
     * Record everything the revision offers that this server does not publish.
     *
     * Collected once, from what the suite already fetched, and printed after the run. Nothing here
     * fails: each is a client-visible improvement rather than an unmet requirement.
     */
    function collectIdentityAdvisories(): void {
      const instructions =
        typeof orientation?.instructions === "string"
          ? orientation.instructions
          : typeof identity?.fields.instructions === "string"
            ? (identity.fields.instructions as string)
            : undefined;
      if (!instructions) {
        advise(SCOPE, {
          subject: "server instructions",
          finding: `${orientationSource} publishes no \`instructions\``,
          consequence:
            "Orientation on the protocol's own metadata channel arrives before the first call and " +
            "costs no round trip; ChatGPT's host reads it to understand cross-tool workflows and " +
            "constraints (plugin changelog, 2026-05-26). Without it the alternative is a gate tool " +
            "that serialises a call before any value is delivered.",
          source: MCP.SERVER_INSTRUCTIONS,
        });
      }

      if (!identity) {
        advise(SCOPE, {
          subject: "server identity",
          finding:
            `no server identity was found in ${orientationSource} — this package looked at ` +
            "`serverInfo`, `server`, `serverIdentity` and their `_meta` equivalents",
          consequence:
            "Identity is what carries `name`, `title`, `version`, `websiteUrl` and `icons[]`. A " +
            "client with none of them has nothing to show a user but the URL they pasted.",
          source: MCP.SERVER_DISCOVER,
        });
      } else {
        const missing = ["title", "version", "websiteUrl"].filter(
          (field) => typeof identity!.fields[field] !== "string",
        );
        if (missing.length > 0) {
          advise(SCOPE, {
            subject: `server identity (\`${identity.carriedIn}\`)`,
            finding: `publishes no ${missing.map((field) => `\`${field}\``).join(", ")}`,
            consequence:
              "`websiteUrl` is the only outbound link server identity carries — there is no " +
              "publisher, author or vendor field anywhere in it — so a user who wants to know who " +
              "runs this server has nowhere to go.",
            source: MCP.SERVER_DISCOVER,
          });
        }
      }

      const serverIcons = publishedIcons(identity?.fields);
      const toolsWithoutIcons = toolNames.filter(
        (_name, index) => publishedIcons(tools[index]).length === 0,
      );
      const noServerIcons = serverIcons.length === 0;
      // Guarded on there being tools at all: "no tool publishes icons" is a false finding against a
      // server that publishes no tools, and a false finding costs more than a missing one.
      const noToolIcons =
        toolNames.length > 0 && toolsWithoutIcons.length === toolNames.length;
      if (noServerIcons || noToolIcons) {
        advise(SCOPE, {
          subject: "icons",
          finding:
            noServerIcons && noToolIcons
              ? "neither the server identity nor any tool publishes `icons[]`"
              : noServerIcons
                ? "the server identity publishes no `icons[]`"
                : "no tool publishes `icons[]`",
          consequence:
            "VS Code renders them for servers, resources and tools since 1.105. Claude shows a " +
            "generic globe for a custom connector and closed the request as not planned, and a " +
            "published ChatGPT plugin's imagery comes from its directory submission instead — so " +
            "this is a few lines that are forward-ready, never a launch to plan around.",
          source: MCP.ICONS,
        });
      }

      const badlySourced = [
        ...serverIcons.map((icon) => ({ owner: "server identity", icon })),
        ...tools.flatMap((tool, index) =>
          publishedIcons(tool).map((icon) => ({
            owner: `tool \`${toolNames[index]}\``,
            icon,
          })),
        ),
      ]
        .map(({ owner, icon }) => {
          const problem = iconSourcingProblem(icon.src, connection.deployment.canonicalOrigin);
          return problem ? `${owner}'s icon ${problem}` : undefined;
        })
        .filter((entry): entry is string => entry !== undefined);
      if (badlySourced.length > 0) {
        advise(SCOPE, {
          subject: "icon sourcing",
          finding: badlySourced.join("; "),
          consequence:
            "An icon outside the server's own authority does not load and does not report why — " +
            "no error, no fallback, just the default. Serve it from this origin, or inline it as a " +
            "`data:` URI, which is accepted from any server.",
          source: VENDOR.MICROSOFT_VSCODE_MCP,
        });
      }
    }

    /**
     * Record what the tool surface offers and does not publish, plus the two fields whose placement
     * this package deliberately does not assert.
     */
    function collectToolAdvisories(): void {
      if (toolsListResult && toolNames.length === 0) {
        advise(SCOPE, {
          subject: "`tools/list`",
          finding: "the server answered, and published no tools",
          consequence:
            "Every tool assertion in this family therefore inspected nothing and passed. That is " +
            "correct — no specification requires a server to publish tools — but it is worth " +
            "saying out loud, because a green run reads as a surface that was checked.",
          source: MCP.TOOLS,
        });
      }

      const undescribed = toolNames.filter(
        (_name, index) => typeof tools[index].description !== "string",
      );
      if (undescribed.length > 0) {
        advise(SCOPE, {
          subject: "tool descriptions",
          finding: `${undescribed.length} of ${toolNames.length} tools publish no \`description\`: ${nameSome(undescribed)}`,
          consequence:
            "The description is the whole of what a model knows about a tool before calling it. An " +
            "undescribed tool is either not called, or called wrongly and then reported as a model " +
            "failure.",
          source: VENDOR.ANTHROPIC_TOOL_DESIGN,
        });
      }

      const unstructured = toolNames.filter(
        (_name, index) => tools[index].outputSchema === undefined,
      );
      if (unstructured.length === toolNames.length && toolNames.length > 0) {
        advise(SCOPE, {
          subject: "tool results",
          finding: "no tool publishes an `outputSchema`",
          consequence:
            "An `outputSchema` is what lets a client validate `structuredContent` and lets a model " +
            "plan on a result's shape rather than re-parse prose. Publishing one binds you to it — " +
            "a server MUST then conform — which is the point.",
          source: MCP.TOOL_OUTPUT_SCHEMA,
        });
      }

      const capabilities = orientation?.capabilities as
        | { tools?: { listChanged?: unknown } }
        | undefined;
      if (orientation && capabilities?.tools?.listChanged !== true) {
        advise(SCOPE, {
          subject: "change detection",
          finding: `${orientationSource} does not declare \`listChanged\` for tools`,
          consequence:
            "Clients that refresh on notification — Claude Code over a held-open stream, VS Code " +
            "for tools, resources and prompts — never learn your tool list changed without it. " +
            "Declare it and emit the notification, then design as though neither arrived: ship " +
            "additive changes, and never rename or withdraw a tool a cached client may still hold.",
          source: MCP.LIST_CHANGED,
        });
      }

      // Gated on the server speaking the revision at all. Against one that does not, the
      // `server/discover` failure is the finding, and advising about a field of a revision it has
      // not adopted would bury it under its own consequences.
      const missingResultType = (
        discoverResult
          ? [
              ["`server/discover`", resultTypeOf(discoverResult)],
              toolsListResult ? ["`tools/list`", resultTypeOf(toolsListResult)] : undefined,
            ]
          : []
      ).filter(
        (entry): entry is [string, string | undefined] =>
          entry !== undefined && entry[1] === undefined,
      );
      if (missingResultType.length > 0) {
        advise(SCOPE, {
          subject: "`resultType`",
          finding: `${missingResultType.map(([method]) => method).join(" and ")} carry no \`resultType\``,
          consequence:
            "The revision states that every result carries `resultType` — `complete`, or " +
            "`input_required` for the multi round-trip pattern that replaced server-initiated " +
            "requests. This is advice rather than a failure only because the sources this package " +
            "is written from do not settle whether a list result carries it; read the clause and " +
            "decide, rather than taking silence here as permission.",
          source: MCP.RESULT_TYPE,
        });
      }

      const listScope = readCachingHints(toolsListResult).cacheScope;
      if (connection.accessToken !== undefined && listScope === "public") {
        advise(SCOPE, {
          subject: "`cacheScope` on `tools/list`",
          finding:
            "this list was fetched with a credential and is nevertheless marked `public`",
          consequence:
            "A public result may be served across authorization contexts, so if this list is ever " +
            "filtered per user, one user's tools can reach another. `public` is a promise that the " +
            "result holds nothing user-specific; it is never an access-control mechanism.",
          source: MCP.CACHE_SCOPE,
        });
      }
    }

    beforeAll(async () => {
      connection = await openWireConnection(mcpTarget, SUITE_ID);
      discover = await mcpRequest(
        connection.target,
        connection.serverUrl,
        discoverMessage(),
        { revision: MCP_STATELESS_REVISION, accessToken: connection.accessToken },
      );
      discoverResult = firstResult(discover);
      const oriented = await orientate();
      orientation = oriented.result;
      orientationSource = oriented.source;
      identity = serverIdentity(orientation);
      tools = await listToolsOnEitherRevision();
      toolNames = tools.map((tool) =>
        typeof tool.name === "string" ? tool.name : String(tool.name),
      );
      collectIdentityAdvisories();
      collectToolAdvisories();
    }, 180_000);

    afterAll(async () => {
      // Printed here rather than collected centrally, so the advice lands with this suite's results
      // instead of at the end of a long run where it would be scrolled past.
      reportAdvisories(SCOPE);
      await mcpTarget.authorization?.clearAccountHolders(SUITE_ID);
    });

    describe("the stateless revision", () => {
      it("answers `server/discover`", () => {
        const error = firstError(discover);
        const observed = firstResult(discover)
          ? "answered"
          : `http ${discover.http.status}` +
            (error ? ` / JSON-RPC ${error.code} ${error.message}` : "");

        expect(
          observed,
          cite(
            MCP.SERVER_DISCOVER,
            "`server/discover` is mandatory on revision 2026-07-28. It is how a client learns the " +
              "revisions, capabilities and identity a server offers, now that there is no " +
              "`initialize` handshake to carry them — and it is not hypothetical traffic: at least " +
              "one shipping client probes HTTP and hosted connector servers with it and uses the " +
              "newer revision with those that answer. A server that does not implement it is " +
              "invisible to that probe and stays on the deprecated revision by default.",
          ),
        ).toBe("answered");
      });

      it("advertises the revisions it supports", () => {
        const advertised = advertisedVersions(discoverResult);

        expect(
          advertised.length > 0 ? advertised : "none advertised",
          cite(
            MCP.SERVER_DISCOVER,
            "`server/discover` advertises the protocol versions a server supports, which is how a " +
              "client decides which revision to speak now that no handshake negotiates one. A " +
              "server that answers the probe without naming its revisions has told the client " +
              "nothing it can act on.",
          ),
        ).toContain(MCP_STATELESS_REVISION);
      });

      it("mints no session for a stateless request", () => {
        expect(
          discover.http.headers.get("mcp-session-id") ?? "none",
          cite(
            MCP.STATELESS_REVISION,
            "`Mcp-Session-Id` is gone from Streamable HTTP on this revision: there is no " +
              "handshake to establish a session and no session for a request to belong to. A " +
              "server still minting one is keeping per-connection state that its list results are " +
              "no longer permitted to depend on.",
          ),
        ).toBe("none");
      });
    });

    describe("the tool surface", () => {
      it("answers `tools/list` with a list this run can inspect", () => {
        // Deliberately uncited: nothing in any specification requires a server to publish tools,
        // so this is a harness-integrity check rather than a conformance finding — the same job
        // `assertDeploymentIsServing` does one step earlier. Every assertion below reads this list,
        // and a green run that inspected nothing is the worst outcome this package can produce.
        expect(
          toolsListResult ? `${tools.length} tools` : "no list",
          "The tool list could not be read on either revision, so every assertion below would " +
            "pass while inspecting nothing.\n" +
            `  what was tried:  ${listAttempt}\n` +
            "  If this server publishes no tools at all, the tool assertions in this family have " +
            "no subject: register the OAuth family and skip this one until the surface exists.",
        ).not.toBe("no list");
      });

      it("names every tool inside the published vocabulary", () => {
        const problems = toolNames
          .map((name) => {
            const problem = toolNameProblem(name);
            return problem ? `\`${name}\` ${problem}` : undefined;
          })
          .filter((entry): entry is string => entry !== undefined);

        expect(
          problems,
          cite(
            MCP.TOOL_NAMES,
            "Tool names are 1–128 characters from `A-Z a-z 0-9 _ - .`. Clients namespace these " +
              "into identifiers of their own, so a character outside the set is one somebody's " +
              "router, parser or prompt template is entitled to reject — and the failure surfaces " +
              "as a tool that silently cannot be called.",
          ),
        ).toEqual([]);
      });

      it("publishes no name twice", () => {
        expect(
          duplicateToolNames(toolNames),
          cite(
            MCP.TOOL_NAMES,
            "Tool names are unique within a server. A duplicate makes one of the two unreachable, " +
              "and which one is a race between client implementations.",
          ),
        ).toEqual([]);
      });

      it("publishes a JSON Schema object as every tool's `inputSchema`", () => {
        const problems = toolNames
          .map((name, index) => {
            const problem = inputSchemaProblem(tools[index].inputSchema);
            return problem ? `\`${name}\` ${problem}` : undefined;
          })
          .filter((entry): entry is string => entry !== undefined);

        expect(
          problems,
          cite(
            MCP.TOOL_INPUT_SCHEMA,
            "`inputSchema` MUST be a valid JSON Schema object and MUST NOT be null. It is the only " +
              "thing telling a model what a call looks like; where it is absent or malformed each " +
              "client guesses, and they guess differently.",
          ),
        ).toEqual([]);
      });

      it("returns the same tools in the same order on a second, independent connection", async () => {
        const again = await listToolsOnEitherRevision();

        expect(
          again.map((tool) => tool.name),
          cite(
            MCP.LIST_CONNECTION_INVARIANT,
            "On this revision a list MUST NOT vary per connection — it may vary only by the " +
              "authorization presented, which is per-request input rather than connection state — " +
              "and tool order is itself part of the contract, because it is what makes client-side " +
              "caching and model prompt-caching work. Two requests on two connections with one " +
              "credential must therefore be identical, in order.",
          ),
        ).toEqual([...toolNames]);
      });

      it("refuses an unknown tool in the protocol channel, not as a tool result", async () => {
        const attempt = await call("tools/call", { name: ABSENT_TOOL, arguments: {} });
        // A challenge is not an answer: a server that lists publicly and gates calls is behaving
        // correctly, and has said nothing about its error channels.
        if (attempt.http.status === 401 || attempt.http.status === 403) return;
        const result = firstResult(attempt);
        const observed = firstError(attempt)
          ? "protocol error"
          : result
            ? `a result carrying isError=${String(result.isError)}`
            : `http ${attempt.http.status} with no JSON-RPC message`;

        expect(
          observed,
          cite(
            MCP.TOOL_ERROR_CHANNELS,
            "The two error channels are not interchangeable. An unknown tool is a protocol error, " +
              "because a model cannot fix it; a business-rule failure rides the result with " +
              "`isError: true` and actionable feedback, because a model often can. Returning an " +
              "unknown tool as a result teaches the model the tool exists and failed.",
          ),
        ).toBe("protocol error");
      });
    });

    describe("caching hints", () => {
      /** What a conformant cacheable result looks like, rendered so a failure reads plainly. */
      const HINTS = /^ttlMs=\d+ cacheScope=(public|private)$/;

      function describeHints(result: Record<string, unknown>): string {
        const hints = readCachingHints(result);
        return `ttlMs=${hints.ttlMs ?? "absent"} cacheScope=${hints.cacheScope ?? "absent"}`;
      }

      it.each(CACHEABLE_LIST_METHODS)("are carried on `%s`", async (method) => {
        const result = firstResult(await call(method));
        // A server that does not implement a primitive answers a protocol error rather than a
        // result. There is nothing to cache, and nothing to report.
        if (!result) return;

        expect(
          describeHints(result),
          cite(
            MCP.CACHING_HINTS,
            "`ttlMs` and `cacheScope` are required on `server/discover`, on every list, and on " +
              "`resources/read`. Absent is not neutral: a client assumes `ttlMs: 0` and treats the " +
              "result as immediately stale, so omitting them asks every client to re-fetch " +
              "everything, forever. Set `ttlMs` to the shortest interval you can actually serve, " +
              "and `cacheScope` to `private` for anything filtered per user.",
          ),
        ).toMatch(HINTS);
      });

      it("are carried on `resources/read`", async () => {
        const listed = firstResult(await call("resources/list"));
        const resources = Array.isArray(listed?.resources)
          ? (listed.resources as { uri?: unknown }[])
          : [];
        const uri = resources.find((resource) => typeof resource.uri === "string")?.uri;
        if (typeof uri !== "string") return;
        const read = firstResult(await call("resources/read", { uri }));
        if (!read) return;

        expect(
          describeHints(read),
          cite(
            MCP.CACHING_HINTS,
            "`resources/read` is named alongside the lists: a client caches a resource's content " +
              "on the same hints, and an absent `ttlMs` makes every read of an unchanged resource " +
              "a fresh fetch.",
          ),
        ).toMatch(HINTS);
      });
    });
  });
}
