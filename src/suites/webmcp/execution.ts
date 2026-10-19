/**
 * WebMCP conformance: the shapes a caller touches, and whether a result can be handed back.
 *
 * The declarative suite reads markup and the imperative suite reads registrations. **Neither ever
 * calls a tool** — so neither touches `inputSchema`'s encoding, neither learns what `executeTool`
 * accepts, and neither can tell whether a value a tool prints is a value it would take back. Those
 * three are what a real caller meets on every single call, and they are where the defects are.
 *
 * ## The browser contract
 *
 * The current draft exposes an optional object schema and accepts object arguments. Older Chrome
 * exposed string schemas and required JSON-string arguments. The runner feature-detects that legacy
 * surface and calls each declared tool once. A handler failure never triggers an encoding retry.
 * Missing schemas are allowed; provided schemas must be readable.
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
import {
  REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE,
  resolveRegistrationDeadlineMs,
} from "../../harness/webmcp-registration.js";
import type { McpTestTarget, WebMcpToolCall } from "../../target.js";

import { adviseRegistrationTiming, assertWebMcpApiPresent } from "./browser-support.js";

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

    it("publishes a readable input schema whenever one is provided", () => {
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
          "The current draft makes inputSchema optional and exposes it as an object. An omitted " +
            "schema is conforming. A provided schema must be readable; older Chrome's string " +
            "encoding is normalized for compatibility and recorded in the advisories.",
        ),
      ).toEqual([]);
    });

    it("registers every tool the target declares as callable", () => {
      const missing = executed
        .filter((entry) => !entry.reading.registered && entry.reading.apiPresent)
        .map(
          (entry) =>
            `${entry.call.page}: \`${entry.call.tool}\` was not registered ` +
            `${entry.reading.registrationDelayMs} ms after \`load\`` +
            (entry.reading.registeredNames.length > 0
              ? ` (registered instead: ${entry.reading.registeredNames.join(", ")})`
              : entry.reading.registrationObserved
                ? " (that page registered nothing under any name)"
                : ` (that page had registered nothing at all within the ${deadlineMs} ms this run waited)`),
        );

      expect(
        missing,
        cite(
          WEBMCP.PER_DOCUMENT_LIFETIME,
          "A tool is reachable only from the document that registered it, so a name declared in " +
            "`webMcp.toolCalls` has to be live on that page before it can be called. The run does " +
            "not sample at `load` — it waits for that page to register, because a registration " +
            "made from a framework lifecycle hook lands after hydration — so what an agent " +
            "attached to this tab would find is exactly what this run found.\n" +
            "  Either the name moved, or the registration did not land on that document. If the " +
            "message above says the page had registered nothing at all, the page is slower than " +
            "the deadline or is not registering: raise `registrationTimeoutMs` (or " +
            "`MCP_TESTS_WEBMCP_REGISTRATION_MS`) to tell the two apart.",
        ),
      ).toEqual([]);
    });

    it("executes each callable tool using the browser's argument encoding", () => {
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
            "This run selected object arguments for the current API or JSON-string arguments " +
            "for a legacy string-schema surface. The call was rejected. It is not retried under " +
            "another encoding: a handler error must not cause duplicate execution.\n" +
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
      adviseRegistrationTiming(SCOPE, readings, deadlineMs);
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
        "The current draft exposes an optional object schema. String schemas identify the older " +
        "Chrome API, not an alternative reading of today's specification. Normalize legacy " +
        "strings when supporting those browsers, and pass objects to the current executeTool API.",
      source: WEBMCP.INPUT_SCHEMA_SHAPE,
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
        "The current draft takes object arguments and resolves to a stringified result. This run " +
        "calls each declared tool once, selecting a JSON string only for a legacy string-schema " +
        "surface. It does not probe every accepted encoding or retry a rejected handler.",
      source: WEBMCP.EXECUTE_TOOL,
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
