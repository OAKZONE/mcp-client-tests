/**
 * WebMCP conformance: the shapes a caller touches, and whether a result can be handed back.
 *
 * The declarative suite reads markup and the imperative suite reads registrations. **Neither ever
 * calls a tool** — so neither touches `inputSchema`'s encoding, neither learns what `executeTool`
 * accepts, and neither can tell whether a value a tool prints is a value it would take back. Those
 * three are what a real caller meets on every single call, and they are where the defects are.
 *
 * ## Why this suite reports the encodings instead of requiring one
 *
 * The draft carries both answers itself: its IDL types `RegisteredTool.inputSchema` as `object`,
 * while its supporting concepts type a tool definition's input schema as a string — "the stringified
 * representation" for imperatively registered tools. The shipping implementation and the draft then
 * diverge again on the `executeTool` argument, which is filed on the draft's own tracker
 * (`webmachinelearning/webmcp#287`, with #278 and #279) and reproduced first-hand in stock Chrome
 * 151.0.7922.138: `executeTool(tool, {…})` threw `UnknownError: Failed to parse input arguments`
 * where the JSON-string form succeeded.
 *
 * Requiring either encoding would fail correct pages on some browser, so this suite **records which
 * one this browser used** and asserts only what both readings agree on: a tool publishes a readable
 * schema, and some published encoding is accepted. The per-browser record is the deliverable — a
 * page that builds against the draft and tests against an object-shaped stub passes its own suite
 * and fails in front of every user.
 *
 * ## The round-trip property, which is not about WebMCP at all
 *
 * **Every value a tool's result reports for a parameter must be a value that parameter accepts.** A
 * surface can print a filter as `on`, publish `{"type":"boolean"}` for it, and accept `"true"` in
 * its handler; each part is self-consistent and a model that copies the printed value back gets a
 * refusal for doing what the payload invited. It survives unit tests because every one of them
 * asserts the producer's output against a literal instead of feeding it through the consumer — which
 * is exactly what this suite does, with the tool's own schema as the consumer.
 *
 * **It needs to call your tools**, so it runs only against the tools named in `webMcp.toolCalls`.
 * Nothing is executed without that, and the run records what it therefore could not observe.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { advise, reportAdvisories } from "../../harness/advisory.js";
import { readRunningDeployment, type RunningDeployment } from "../../harness/deployment.js";
import { WEBMCP, cite } from "../../harness/specifications.js";
import {
  openWebMcpBrowser,
  type RegisteredToolReading,
  type ToolExecutionReading,
  type WebMcpBrowserOptions,
  type WebMcpBrowserSession,
} from "../../harness/webmcp-browser.js";
import {
  acceptedEncodings,
  executionProblem,
  executionResultPayloads,
  inputSchemaEncoding,
  registeredToolSchemaProblem,
  parseInputSchema,
  reportedParameterValues,
  roundTripViolations,
  schemaProperties,
  type InputSchemaEncoding,
} from "../../harness/webmcp-execution.js";
import type { McpTestTarget, WebMcpToolCall } from "../../target.js";

import { assertWebMcpApiPresent } from "./browser-support.js";

const SCOPE = "WebMCP tool execution (browser)";

/** One declared call, and everything the run learned by making it. */
interface ExecutedCall {
  readonly call: WebMcpToolCall;
  readonly reading: ToolExecutionReading;
  /** The tool's published schema, as the same browser reported it before the call. */
  readonly inputSchema: unknown;
}

/**
 * Register the WebMCP execution suite against one target.
 *
 * Skipped unless the target declares the `webMcp` capability. Like the imperative suite, browser
 * availability is deliberately not a capability — a capability describes the server, and whether
 * this machine has Chrome is a fact about the runner — so an absent browser fails the run rather
 * than un-declaring it.
 *
 * @param mcpTarget - The deployment under test.
 * @param browserOptions - How to find a browser and how to switch WebMCP on. Defaults come from
 *   `MCP_TESTS_CHROME_PATH` and `MCP_TESTS_CHROME_ARGS`.
 */
export function defineWebMcpExecutionSuite(
  mcpTarget: McpTestTarget,
  browserOptions: WebMcpBrowserOptions = {},
): void {
  describe.skipIf(!mcpTarget.webMcp)("WebMCP tool execution (browser)", () => {
    let deployment: RunningDeployment;
    let session: WebMcpBrowserSession | undefined;
    let readings: RegisteredToolReading[] = [];
    let executed: ExecutedCall[] = [];

    const capability = mcpTarget.webMcp ?? { toolPages: [] };
    const declaredCalls = capability.toolCalls ?? [];

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

      executed = [];
      for (const call of declaredCalls) {
        const reading = await session.execute(call.page, call.tool, call.arguments);
        const registered = readings
          .find((page) => page.path === call.page)
          ?.tools.find((tool) => tool.name === call.tool);
        executed.push({ call, reading, inputSchema: registered?.inputSchema });
      }
    }, 240_000);

    afterAll(async () => {
      await session?.close();
      reportAdvisories(SCOPE);
    });

    it("runs in a browser that exposes the WebMCP API", () => {
      assertWebMcpApiPresent(readings);
    });

    it("publishes a readable input schema for every registered tool", () => {
      const problems = readings.flatMap((reading) =>
        reading.tools
          .map((tool) => {
            const problem = registeredToolSchemaProblem(tool.inputSchema);
            return problem ? `${reading.path}: \`${tool.name}\` ${problem}` : undefined;
          })
          .filter((entry): entry is string => entry !== undefined),
      );

      expect(
        problems,
        cite(
          WEBMCP.INPUT_SCHEMA_SHAPE,
          "A registered tool publishes an input schema, and both readings of the draft agree it " +
            "is a JSON Schema — the IDL types it as an object, the supporting concepts as that " +
            "object stringified. Whichever encoding your browser hands back, it has to parse: a " +
            "schema that is absent, unreadable, or not describing an object leaves the model to " +
            "guess the argument shape, and it guesses. The encoding itself is not asserted here " +
            "and is recorded in the advisories instead.",
        ),
      ).toEqual([]);
    });

    it("registers every tool the target declares as callable", () => {
      const missing = executed
        .filter((entry) => !entry.reading.registered && entry.reading.apiPresent)
        .map(
          (entry) =>
            `${entry.call.page}: \`${entry.call.tool}\` was not registered when the call was made` +
            (entry.reading.registeredNames.length > 0
              ? ` (registered instead: ${entry.reading.registeredNames.join(", ")})`
              : " (that page registered nothing)"),
        );

      expect(
        missing,
        cite(
          WEBMCP.PER_DOCUMENT_LIFETIME,
          "A tool is reachable only from the document that registered it, so a name declared in " +
            "`webMcp.toolCalls` has to be live on that page by load. Either the name moved, or " +
            "the registration did not land on that document — and an agent attached to this tab " +
            "would find exactly what this run found.",
        ),
      ).toEqual([]);
    });

    it("accepts one of the published argument encodings for every callable tool", () => {
      const unreachable = executed
        .filter((entry) => entry.reading.registered)
        .map((entry) => {
          if (!entry.reading.executorPresent) {
            return `${entry.call.page}: \`${entry.call.tool}\` — the tool surface exposed no \`executeTool\` to call`;
          }
          const problem = executionProblem(entry.reading.attempts);
          return problem ? `${entry.call.page}: \`${entry.call.tool}\` ${problem}` : undefined;
        })
        .filter((entry): entry is string => entry !== undefined);

      expect(
        unreachable,
        cite(
          WEBMCP.EXECUTE_TOOL,
          "`executeTool(tool, inputObject)` is how an attached agent calls a registered tool. " +
            "This run attempted both published spellings of the argument — the object the draft's " +
            "IDL types, and the JSON string the shipping implementation is reported to require — " +
            "and neither was accepted, so the tool is registered and uncallable. Which spelling " +
            "works is not asserted; that a registered tool can be called at all is.\n" +
            "  If your handler rejected the arguments rather than the browser rejecting their " +
            "encoding, the `arguments` in `webMcp.toolCalls` are the thing to fix — the error " +
            "text above says which happened.",
        ),
      ).toEqual([]);
    });

    it("reports only parameter values its own schema would accept", () => {
      const violations = executed.flatMap((entry) => {
        const properties = schemaProperties(parseInputSchema(entry.inputSchema));
        if (properties.size === 0) return [];
        return entry.reading.attempts
          .filter((attempt) => attempt.accepted)
          .flatMap((attempt) =>
            executionResultPayloads(attempt.result).flatMap((payload) =>
              roundTripViolations(
                properties,
                reportedParameterValues(payload, properties.keys()),
              ).map((violation) => `${entry.call.page}: \`${entry.call.tool}\` — ${violation}`),
            ),
          );
      });

      expect(
        [...new Set(violations)],
        cite(
          WEBMCP.INPUT_SCHEMA_SHAPE,
          "A tool's input schema is the contract for what it accepts, and its result is read by a " +
            "model that has nothing else to go on. So a value the result publishes under a " +
            "parameter's own name has to be a value that parameter takes — otherwise the payload " +
            "invites a call the tool then refuses, and the model is blamed for copying what it " +
            "was shown.\n" +
            "  This is the failure that survives unit tests: each side is self-consistent, and " +
            "every test asserts the producer's output against a literal instead of feeding it " +
            "back through the consumer. Fix it by publishing the value in the spelling the schema " +
            "declares — not by widening the schema to admit the display form, which moves the " +
            "same ambiguity into the handler.",
        ),
      ).toEqual([]);
    });

    it("records the shapes this browser used, and what this run could not observe", () => {
      collectAdvisories(readings, executed, declaredCalls.length);

      expect(readings.length, "The `webMcp` capability declared no pages to load.").toBeGreaterThan(
        0,
      );
    });
  });
}

/**
 * Record the per-browser shape reading, and everything this run did not get to see.
 *
 * @param readings - Every page read this run.
 * @param executed - Every declared call that was made.
 * @param declaredCallCount - How many calls the capability declared.
 */
function collectAdvisories(
  readings: readonly RegisteredToolReading[],
  executed: readonly ExecutedCall[],
  declaredCallCount: number,
): void {
  const encodings = new Map<InputSchemaEncoding, string[]>();
  for (const reading of readings) {
    for (const tool of reading.tools) {
      const encoding = inputSchemaEncoding(tool.inputSchema);
      const named = encodings.get(encoding) ?? [];
      named.push(`${reading.path}:${tool.name}`);
      encodings.set(encoding, named);
    }
  }

  if (encodings.size > 0) {
    const summary = [...encodings.entries()]
      .map(([encoding, tools]) => `${encoding} (${tools.length} tool(s))`)
      .join(", ");
    advise(SCOPE, {
      subject: "the `inputSchema` encoding this browser returned",
      finding: `\`getTools()\` returned \`inputSchema\` as ${summary}`,
      consequence:
        "This is the per-browser half of the record, and it is not a defect either way: the draft " +
        "types `inputSchema` as an object in its IDL and as a stringified schema in its " +
        "supporting concepts, so both are grounded. What breaks is a page written against one " +
        "and tested against a stub of the same one — green in its own suite, broken in the " +
        "browser. Read whichever encoding your library hands you, rather than the one you expect: " +
        "`typeof schema === \"string\" ? JSON.parse(schema) : schema` costs nothing and survives " +
        "either resolution.",
      source: WEBMCP.EXECUTION_SHAPE_DIVERGENCE,
    });
  }

  if (declaredCallCount === 0) {
    advise(SCOPE, {
      subject: "tool execution",
      finding:
        "no tool was called this run, because `webMcp.toolCalls` named none — so nothing here " +
        "observed the `executeTool` argument encoding, and nothing checked that a value your " +
        "results report for a parameter is a value that parameter accepts",
      consequence:
        "Those two are only reachable by calling a tool, and this package will not invite itself " +
        "to run your code. Name one read-only tool and arguments it accepts in `webMcp.toolCalls` " +
        "and both become observable. Until then, read the passing assertions above as covering " +
        "registration and schema shape only — the call path is untested, not proven.",
      source: WEBMCP.EXECUTION_SHAPE_DIVERGENCE,
    });
    return;
  }

  const accepted = new Set<string>();
  const resultTypes = new Set<string>();
  for (const entry of executed) {
    for (const encoding of acceptedEncodings(entry.reading.attempts)) accepted.add(encoding);
    for (const attempt of entry.reading.attempts) {
      if (attempt.accepted) resultTypes.add(attempt.result === null ? "null" : typeof attempt.result);
    }
  }

  if (accepted.size > 0) {
    advise(SCOPE, {
      subject: "the `executeTool` argument encoding this browser accepted",
      finding:
        `arguments were accepted as ${[...accepted].join(" and ")}` +
        (resultTypes.size > 0 ? `, and results came back as ${[...resultTypes].join(", ")}` : ""),
      consequence:
        "The other half of the per-browser record. The draft types the argument as an `object` " +
        "and the result as a `DOMString`; the shipping implementation is reported to require a " +
        "JSON string in and to return `string | null` out. If only one encoding is listed above, " +
        "a library that sends the other one is broken on this browser and its own tests will not " +
        "say so — send what this run recorded, and parse the result rather than assuming its " +
        "shape.",
      source: WEBMCP.EXECUTION_SHAPE_DIVERGENCE,
    });
  }

  for (const entry of executed) {
    const properties = schemaProperties(parseInputSchema(entry.inputSchema));
    if (properties.size > 0) continue;
    advise(SCOPE, {
      subject: `${entry.call.page} — \`${entry.call.tool}\` round trip`,
      finding:
        "the tool publishes no readable parameter properties, so nothing this run read back could " +
        "be checked against a declared type",
      consequence:
        "The round-trip check compares a value your result publishes under a parameter's name " +
        "against what that parameter declares it accepts. With no declared properties there is " +
        "nothing to compare against, so that assertion passed on this tool without inspecting " +
        "anything — a gap in the run, not a clean bill.",
      source: WEBMCP.INPUT_SCHEMA_SHAPE,
    });
  }
}
