/**
 * A real browser, for the half of WebMCP that no amount of HTML parsing reaches.
 *
 * **Why this exists at all.** `document.modelContext.registerTool(...)` is a JavaScript call in the
 * user's tab. Whether it ran, and what it registered, is observable only by asking the page — which
 * is exactly the failure the vendor documentation names: a page whose unit tests are green while
 * Chrome's DevTools pane reads zero tools, because the registration call never landed. The
 * `navigator` → `document` migration broke that class of test wholesale. So this module asks the
 * page the same question an attached agent asks: `getTools()`.
 *
 * ## The dependency, and why it is shaped this way
 *
 * `playwright-core` is an **optional peer dependency** — the same shape `vitest` already has here.
 * It ships no browser binaries of its own (that is the `-core`), so installing this package pulls
 * down a few megabytes rather than a few hundred, and a consumer who never registers this suite
 * pays nothing at all. The browser itself is whatever Chrome the machine already has; CI images
 * generally have one, and `executablePath` names it when they do not.
 *
 * Neither the library nor the browser is discovered silently. A missing one **stops the run with
 * both ways out named**, because a conformance run that quietly tested nothing is the worst outcome
 * this package can produce, and on this surface it is the easy one to produce.
 *
 * ## Reaching the deployment as production serves it
 *
 * Every other family speaks to the deployment through {@link edgeRequest}, which rewrites `Host`
 * and the forwarded headers by hand. A browser cannot be asked to do that, so this module stands up
 * the real thing: an HTTPS listener holding a certificate for the deployment's canonical host,
 * forwarding to the application port with the same headers the edge sends. Chrome is then pointed
 * at it with `--host-resolver-rules`, so the canonical origin resolves to the proxy and **absolute
 * URLs in the page resolve too** — which a bare `http://127.0.0.1:port` navigation would break.
 *
 * That also settles the one platform requirement WebMCP has: the API is `SecureContext`, and this
 * gives the page a genuine `https://` origin rather than relying on loopback's exemption.
 *
 * **The browser is told to accept the run's certificate**, because Chrome will not trust a CA
 * minted sixty seconds ago without SPKI-pinning gymnastics. The certificate carries the canonical
 * host in its SAN, so what is accepted is an untrusted *root* and never a name mismatch — the TLS
 * chain is not what this family tests, and the OAuth families already prove the server's
 * TLS-facing behaviour.
 */

import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { createLoopbackTlsMaterial } from "./tls-certificate.js";
import type { ExecutionAttempt } from "./webmcp-execution.js";
import {
  REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE,
  WEBMCP_REGISTRATION_POLL_MS,
  resolveRegistrationDeadlineMs,
} from "./webmcp-registration.js";

/** How to find a browser, when the defaults do not. */
export interface WebMcpBrowserOptions {
  /**
   * Path to a Chrome or Chromium binary. Defaults to `MCP_TESTS_CHROME_PATH`.
   *
   * When neither is set, Playwright's `chrome` channel is used, which resolves the Chrome the
   * machine already has installed.
   */
  readonly executablePath?: string;
  /**
   * Command-line switches, replacing {@link WEBMCP_LAUNCH_ARGS}. Defaults to `MCP_TESTS_CHROME_ARGS`
   * (space-separated) and then to that constant.
   *
   * Override this when a Chrome release renames the feature, or to add an origin-trial token
   * instead of the testing flag.
   */
  readonly launchArgs?: readonly string[];
  /** Run headless. Defaults to true; set false to watch the page while diagnosing. */
  readonly headless?: boolean;
  /**
   * How long to wait, after `load`, for a page to register its tools. Defaults to
   * `MCP_TESTS_WEBMCP_REGISTRATION_MS` and then to {@link WEBMCP_REGISTRATION_DEADLINE_MS}.
   *
   * **It is this package's number, not a requirement** — nothing published says when a page must
   * have registered by. Raise it for a page whose registration waits on a network call, or for a CI
   * runner slower than the machine the default was chosen against. A correct page pays none of it:
   * the wait ends the moment a registration is seen.
   */
  readonly registrationTimeoutMs?: number;
}

/**
 * The switches that turn WebMCP on, used when a caller supplies none.
 *
 * Chrome documents the flag as `chrome://flags/#enable-webmcp-testing` (from 146.0.7672.0) and an
 * origin trial from Chrome 149 — both STRONG, from Chrome's own pages. **The command-line spelling
 * of that flag is not in Chrome's documentation**; it is recorded by a testing vendor, which is a
 * single secondary source. So this is a default rather than a fact the package asserts: it is
 * overridable, and {@link openWebMcpBrowser} verifies the API is actually present before any
 * conclusion is drawn from a page, so a switch that has been renamed produces a named stop instead
 * of a page reported as publishing nothing.
 *
 * `DevToolsWebMCPSupport` rides along because the same vendor pairs them and the DevTools surface is
 * where a human confirms the same reading by hand.
 */
export const WEBMCP_LAUNCH_ARGS: readonly string[] = [
  "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
];

/** The HTTPS front placed in front of the deployment for the browser's benefit. */
export interface CanonicalProxy {
  /** The loopback port the HTTPS listener is bound to. */
  readonly port: number;
  /** The canonical host the certificate covers and the browser is told to resolve here. */
  readonly host: string;
  close(): Promise<void>;
}

/**
 * The public source address the edge reports, kept identical to `edge-transport.ts` so a
 * deployment's WAF and rate limiters see one shape across every family.
 */
const FORWARDED_FOR = "160.79.104.10";

/**
 * Front the deployment on its canonical host, over real TLS, for a browser to navigate to.
 *
 * @param canonicalOrigin - The origin the deployment believes it is served on.
 * @param appPort - The loopback port the application listens on.
 * @returns The listener, its port, and a close.
 */
export async function startCanonicalProxy(
  canonicalOrigin: string,
  appPort: number,
): Promise<CanonicalProxy> {
  const canonical = new URL(canonicalOrigin);
  const tls = createLoopbackTlsMaterial([canonical.hostname]);

  const server: HttpsServer = createHttpsServer(
    { key: tls.serverKeyPem, cert: tls.serverCertificatePem },
    (incoming, outgoing) => {
      const headers = {
        ...incoming.headers,
        // The same translation `edgeRequest` performs, so the application sees one story about
        // where it is served no matter which family is driving it.
        host: canonical.host,
        "x-forwarded-proto": canonical.protocol.replace(":", ""),
        "x-forwarded-host": canonical.host,
        "x-forwarded-for": FORWARDED_FOR,
      };
      const upstream = httpRequest(
        { host: "127.0.0.1", port: appPort, method: incoming.method, path: incoming.url, headers },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        // A dead upstream must not take the listener down mid-run; the navigation fails and the
        // suite reports the status, which is a finding about the deployment rather than a crash.
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    host: canonical.hostname,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** One tool the page has registered, as an attached agent would see it. */
export interface RegisteredWebMcpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly annotations?: Readonly<Record<string, unknown>>;
}

/** What one page yielded when asked what it had registered. */
export interface RegisteredToolReading {
  readonly path: string;
  /** The navigation's HTTP status. */
  readonly status: number;
  /**
   * Whether the browser exposed the WebMCP API at all.
   *
   * **Not which spelling the page used**, which is unobservable from here. Where both names exist
   * they reference one object, so neither reveals what the page wrote; and where only one exists,
   * what a reading shows is the browser's vintage rather than the page's source. Observed under the
   * testing switch on 2026-09-10: Chrome 152.0.7977.83 has `document.modelContext` and **no**
   * `navigator.modelContext` at all — removed, not merely deprecated — while Chromium
   * 151.0.7922.34 has both as one object and Chromium 149.0.7827.55 has only the `navigator`
   * spelling. The page's own choice lives only in its source text, which is why the deprecation
   * advisory belongs to the declarative suite and not to this one.
   */
  readonly apiPresent: boolean;
  /**
   * Which reader actually answered, e.g. `document.modelContext.getTools`, or `none`.
   *
   * Reported because the published sources disagree about which surface exists under the testing
   * flag. Naming the one that worked turns that conflict into evidence from the machine that ran
   * the suite, and tells the next reader where to look when a Chrome release moves it.
   */
  readonly toolSurface: string;
  readonly tools: readonly RegisteredWebMcpTool[];
  /**
   * Whether a registration made by **this** document was seen before the deadline.
   *
   * Not "the list was non-empty", which the tools an earlier document failed to release would also
   * satisfy — see `webmcp-registration.ts` for why that distinction decides whether the lifetime
   * assertion means anything.
   */
  readonly registrationObserved: boolean;
  /**
   * Milliseconds after `load` at which the reading was taken.
   *
   * The page's observed registration delay when {@link registrationObserved} is true, and the full
   * wait when it is false — which is the number the failure message quotes.
   */
  readonly registrationDelayMs: number;
}

/** What one attempt to call a registered tool through the browser produced. */
export interface ToolExecutionReading {
  readonly path: string;
  /** The tool the caller asked for. */
  readonly tool: string;
  readonly apiPresent: boolean;
  readonly toolSurface: string;
  /** Whether a tool of that name was registered when the call was attempted. */
  readonly registered: boolean;
  /** What was registered instead, when the requested tool was not there. */
  readonly registeredNames: readonly string[];
  /** Whether the surface exposed an `executeTool` to call at all. */
  readonly executorPresent: boolean;
  /** One attempt per published argument encoding, in the order they were tried. */
  readonly attempts: readonly ExecutionAttempt[];
  /** Whether the page had registered anything of its own before the call was attempted. */
  readonly registrationObserved: boolean;
  /** Milliseconds after `load` that the run waited before calling. */
  readonly registrationDelayMs: number;
}

/** A launched browser, and the pages read through it. */
export interface WebMcpBrowserSession {
  /**
   * Navigate to a path on the canonical origin and ask the page what it registered.
   *
   * @param path - Path on the canonical origin.
   * @returns What the page exposed.
   */
  read(path: string): Promise<RegisteredToolReading>;
  /**
   * Walk a sequence of paths in **one tab**, asking after each navigation what is live.
   *
   * This is the only arrangement in which a registration that outlived its own document can show
   * up. {@link read} opens a fresh page per path, so every reading starts from nothing and a leak is
   * structurally invisible; here the reading taken after the second navigation holds the second
   * page's tools plus anything the first page failed to release.
   *
   * @param paths - Paths on the canonical origin, in the order to visit them.
   * @returns One reading per path, taken after that navigation, in the same order.
   */
  readSequence(paths: readonly string[]): Promise<readonly RegisteredToolReading[]>;
  /**
   * Call one registered tool, once per published argument encoding.
   *
   * Both encodings are attempted whatever the first one does, because the useful output is the
   * per-browser record of which are accepted, and one success says nothing about the other. The tool
   * is therefore called more than once per run — which is why the capability that names it says it
   * must be safe to call repeatedly.
   *
   * @param path - Path on the canonical origin that registers the tool.
   * @param tool - The registered tool's name.
   * @param args - The arguments to call it with.
   * @returns What each attempt produced.
   */
  execute(
    path: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ToolExecutionReading>;
  close(): Promise<void>;
}

/**
 * Where the tool surface might be, in the order to try.
 *
 * **Three surfaces are probed, because the sources disagree about which exists.** The
 * specification's own IDL puts `getTools()` on `document.modelContext`. Chrome's testing flag is
 * documented as exposing a separate `navigator.modelContextTesting` for inspector tooling, and two
 * secondary sources name its reader differently — `getTools()` in one, `listTools()` in the other.
 *
 * Rather than pick a winner, the scripts below try each in turn and report which one answered. That
 * turns a documentation conflict into evidence collected on the machine actually running the suite,
 * and it means a Chrome release that moves the reader degrades to a named stop rather than to a page
 * silently reported as registering nothing.
 *
 * Shared by every script this module evaluates, so reading a page and calling one of its tools can
 * never end up disagreeing about where the surface is.
 */
const SURFACE_CANDIDATES = `[
    ["document.modelContext.getTools", document.modelContext, "getTools"],
    ["navigator.modelContextTesting.getTools", navigator.modelContextTesting, "getTools"],
    ["navigator.modelContextTesting.listTools", navigator.modelContextTesting, "listTools"],
    ["navigator.modelContext.getTools", navigator.modelContext, "getTools"],
  ]`;

/**
 * The name the observer below parks on `window`, read back by the wait script.
 *
 * Namespaced and improbable on purpose: it is set in the page's own main world, where the page's
 * globals live, and a collision would make the run's own bookkeeping into a finding about somebody
 * else's code.
 */
const OBSERVER_GLOBAL = "__mcpClientTestsWebMcpRegistration";

/**
 * Installed before any of the page's own scripts run, in every document the tab loads.
 *
 * **This is what makes "did *this* document register?" answerable.** `toolchange` fires on the
 * `ModelContext` of the document that is registering, and this listener is attached to the new
 * document's own object before that document has run a line of its own code — so an event counted
 * here was raised by this document and by nothing that came before it. A registration that outlived
 * an earlier document raises nothing here, which is precisely the property the lifetime assertion
 * depends on.
 *
 * **It only listens.** It never assigns `ontoolchange`, which would silently replace a handler the
 * page installed, and it never wraps `registerTool`, which would put this package's code on the path
 * of the call it is trying to observe. A harness artefact reported as a consumer finding is the one
 * thing this package must never produce, so the observation stays beside the page rather than inside
 * it — and the poll in {@link awaitRegistrationScript} covers a browser whose event never arrives.
 */
const REGISTRATION_OBSERVER = `(() => {
  const state = { changes: 0, attached: false };
  window[${JSON.stringify(OBSERVER_GLOBAL)}] = state;

  const attach = () => {
    if (state.attached) return;
    const host = document.modelContext;
    if (!host || typeof host.addEventListener !== "function") return;
    try {
      host.addEventListener("toolchange", () => { state.changes += 1; });
      state.attached = true;
    } catch (error) {
      // Listening is the fast path and never the only one. A surface that refuses a listener leaves
      // the bounded poll to notice the registration; it must not take the run down with it.
    }
  };

  attach();
  // The object is normally there from the first moment of the document. These cover a browser where
  // it is not, and cost nothing where it is: \`attach\` is idempotent.
  document.addEventListener("readystatechange", attach);
  document.addEventListener("DOMContentLoaded", attach);
})()`;

/**
 * Reading the tool list, as a source fragment both scripts below share.
 *
 * Defines `shape` and `readOnce` against {@link SURFACE_CANDIDATES}, so a wait and the reading it
 * ends can never disagree about where the surface is or what a tool looks like.
 */
const READ_ONCE = `
  const shape = (tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  });
  const candidates = ${SURFACE_CANDIDATES};
  const readOnce = async () => {
    const apiPresent = candidates.some(([, host]) => Boolean(host));
    for (const [label, host, method] of candidates) {
      if (!host || typeof host[method] !== "function") continue;
      try {
        const registered = await host[method]();
        if (!Array.isArray(registered)) continue;
        return { apiPresent, toolSurface: label, tools: registered.map(shape) };
      } catch (error) {
        // A surface that exists and throws is not the one to read from; try the next rather than
        // failing the page, and report "none" if every one of them refuses.
        continue;
      }
    }
    return { apiPresent, toolSurface: "none", tools: [] };
  };`;

/**
 * Wait for this document to register something, then read what is live.
 *
 * **Why a wait and not a sample.** `registerTool()` is a script call, and the application this API
 * exists for registers from a framework lifecycle hook — after hydration, therefore after `load`.
 * Reading at `load` reports every such page as registering nothing.
 *
 * **Why not a fixed sleep.** A sleep makes every page pay for the slowest one, on every run. This
 * returns the moment a registration is seen, so a correct page costs the poll interval and a page
 * that genuinely registers nothing costs the deadline once.
 *
 * **What counts as "this document registered".** In order: a `toolchange` raised on this document's
 * own `ModelContext` (the observer above, and the only signal that is exact); otherwise a tool live
 * under a name that was not already live when the document opened, or more tools live than were.
 * The baseline is what the previous navigation in this tab left behind — empty for a fresh tab — so
 * a registration that outlived an earlier document can never end this wait on its own. That is what
 * keeps the lifetime assertion from inverting into a pass: a naive "wait until the list is
 * non-empty" would be satisfied by the leak it exists to detect, and would then read the new page
 * before it had registered anything.
 *
 * A browser with no WebMCP object returns at once rather than waiting out the deadline per page —
 * the suites name that case themselves, and it is not a page's fault.
 *
 * @param baseline - Tool names already live when this document opened.
 * @param deadlineMs - How long to wait after `load` before giving up and reading what is there.
 * @param pollMs - How often to re-read while waiting.
 * @returns The script source.
 */
function awaitRegistrationScript(
  baseline: readonly string[],
  deadlineMs: number,
  pollMs: number,
): string {
  // Embedded as a JSON string and parsed in the page, so no tool name can terminate the literal or
  // change the meaning of the script around it.
  const settings = JSON.stringify(JSON.stringify({ baseline, deadlineMs, pollMs }));
  return `(async () => {
  const settings = JSON.parse(${settings});
  const baseline = new Set(settings.baseline);
  const observer = window[${JSON.stringify(OBSERVER_GLOBAL)}];
  const started = Date.now();
${READ_ONCE}

  const registeredHere = (tools) => {
    if (tools.length === 0) return false;
    if (observer && observer.changes > 0) return true;
    if (tools.some((tool) => !baseline.has(tool && tool.name))) return true;
    return tools.length > baseline.size;
  };

  for (;;) {
    const reading = await readOnce();
    const waited = Date.now() - started;
    if (!reading.apiPresent) {
      return { ...reading, registrationObserved: false, registrationDelayMs: waited };
    }
    if (registeredHere(reading.tools)) {
      return { ...reading, registrationObserved: true, registrationDelayMs: waited };
    }
    if (waited >= settings.deadlineMs) {
      return { ...reading, registrationObserved: false, registrationDelayMs: waited };
    }
    await new Promise((resolve) => setTimeout(resolve, settings.pollMs));
  }
})()`;
}

/**
 * The script that calls one tool with the argument encoding indicated by its published schema.
 *
 * **The tool object never leaves the page.** `executeTool` takes the `RegisteredTool` the surface
 * handed out, and that object cannot be carried across the evaluation boundary and back — so the
 * whole call, from finding the tool by name to catching the rejection, happens in the tab.
 *
 * The current draft takes an object. Older Chrome returns a string schema and takes a JSON string;
 * feature-detect that legacy surface rather than version-detecting or executing the tool twice.
 * A handler rejection must not trigger a retry under another encoding.
 *
 * The rejection is flattened to `Name: message` on the way out, because a `DOMException` does not
 * survive serialization and its `name` is the part that identifies the failure.
 *
 * @param toolName - The registered tool to call.
 * @param args - The arguments to call it with.
 * @returns The script source.
 */
export function executeToolScript(toolName: string, args: Readonly<Record<string, unknown>>): string {
  // Embedded as a JSON string and parsed in the page, so no argument value can terminate the
  // literal or change the meaning of the script around it.
  const request = JSON.stringify(JSON.stringify({ tool: toolName, args }));
  return `(async () => {
  const request = JSON.parse(${request});
  const candidates = ${SURFACE_CANDIDATES};
  const apiPresent = candidates.some(([, host]) => Boolean(host));

  let surface;
  let tools = [];
  for (const [label, host, method] of candidates) {
    if (!host || typeof host[method] !== "function") continue;
    try {
      const registered = await host[method]();
      if (!Array.isArray(registered)) continue;
      surface = { label, host };
      tools = registered;
      break;
    } catch (error) {
      continue;
    }
  }

  const base = {
    apiPresent,
    toolSurface: surface ? surface.label : "none",
    registered: false,
    registeredNames: tools.map((tool) => (tool && tool.name) || "(unnamed)"),
    executorPresent: false,
    attempts: [],
  };
  if (!surface) return base;

  const tool = tools.find((candidate) => candidate && candidate.name === request.tool);
  if (!tool) return base;

  // The executor is normally the surface that listed the tools; a testing surface that lists but
  // cannot call falls back to the document's own object rather than reporting the tool unreachable.
  const executor =
    typeof surface.host.executeTool === "function"
      ? surface.host
      : document.modelContext && typeof document.modelContext.executeTool === "function"
        ? document.modelContext
        : undefined;
  if (!executor) return { ...base, registered: true };

  const carry = (value) => {
    if (typeof value === "string" || value === null || value === undefined) return value ?? null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return String(value);
    }
  };

  const attempts = [];
  const encoding = typeof tool.inputSchema === "string" ? "json-string" : "object";
  const argument = encoding === "object" ? request.args : JSON.stringify(request.args);
  try {
    const result = await executor.executeTool(tool, argument);
    attempts.push({ encoding, accepted: true, result: carry(result) });
  } catch (error) {
    const name = (error && error.name) || "Error";
    const message = (error && error.message) || String(error);
    attempts.push({ encoding, accepted: false, error: name + ": " + message });
  }

  return { ...base, registered: true, executorPresent: true, attempts };
})()`;
}

/**
 * Load `playwright-core`, or say precisely what to do about its absence.
 *
 * @returns The module's `chromium` launcher.
 * @throws Error naming both ways out when the optional peer dependency is not installed.
 */
async function loadChromium(): Promise<{
  launch(options: Record<string, unknown>): Promise<PlaywrightBrowser>;
}> {
  try {
    // Imported by name so a consumer that never registers this suite never resolves it. The cast is
    // the boundary: `playwright-core` is optional, so its types are not guaranteed to be present.
    const playwright = (await import("playwright-core")) as unknown as {
      chromium: { launch(options: Record<string, unknown>): Promise<PlaywrightBrowser> };
    };
    return playwright.chromium;
  } catch {
    throw new Error(
      "The WebMCP imperative suite needs `playwright-core`, which is an optional peer dependency " +
        "of @oakzone/mcp-client-tests and is not installed.\n" +
        "  Two ways out:\n" +
        "    1. `npm i -D playwright-core` — it ships no browser binaries; the suite uses the " +
        "Chrome already on the machine (or `MCP_TESTS_CHROME_PATH`).\n" +
        "    2. Register only `defineWebMcpDeclarativeSuite(target)`, which reads the served HTML " +
        "and needs no browser.\n" +
        "  In CI the browser is the other half of the first one: GitHub's `ubuntu-latest` already " +
        "ships Google Chrome, and anywhere else `npx playwright-core install --with-deps chrome` " +
        "installs it.\n" +
        "  This is a hard stop rather than a skip: a conformance run that quietly tested nothing " +
        "is worse than one that failed.",
    );
  }
}

/** The slice of Playwright's surface this module uses, typed locally so the dep stays optional. */
interface PlaywrightBrowser {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  addInitScript(script: { content: string }): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, options?: Record<string, unknown>): Promise<{ status(): number } | null>;
  evaluate<T>(script: string): Promise<T>;
  close(): Promise<void>;
}

/**
 * Launch a browser pointed at the deployment's canonical origin.
 *
 * @param canonicalOrigin - The origin the deployment believes it is served on.
 * @param appPort - The loopback port the application listens on.
 * @param options - How to find a browser, and how to switch WebMCP on.
 * @returns A session that reads a page's registered tools, and a close that stops both the browser
 *   and the HTTPS front.
 * @throws Error when `playwright-core` or a browser binary cannot be resolved, naming what to do.
 */
export async function openWebMcpBrowser(
  canonicalOrigin: string,
  appPort: number,
  options: WebMcpBrowserOptions = {},
): Promise<WebMcpBrowserSession> {
  const chromium = await loadChromium();
  const proxy = await startCanonicalProxy(canonicalOrigin, appPort);

  const executablePath = options.executablePath ?? process.env.MCP_TESTS_CHROME_PATH;
  const configured =
    options.launchArgs ?? (process.env.MCP_TESTS_CHROME_ARGS ?? "").split(" ").filter(Boolean);
  const extraArgs = configured.length > 0 ? configured : WEBMCP_LAUNCH_ARGS;

  let browser: PlaywrightBrowser;
  try {
    browser = await chromium.launch({
      headless: options.headless ?? true,
      ...(executablePath ? { executablePath } : { channel: "chrome" }),
      args: [
        // Absolute URLs on the canonical origin resolve to the HTTPS front, so the page loads its
        // own scripts exactly as it would in production.
        `--host-resolver-rules=MAP ${proxy.host} 127.0.0.1:${proxy.port}`,
        ...extraArgs,
      ],
    });
  } catch (error) {
    await proxy.close();
    throw new Error(
      "The WebMCP imperative suite could not launch a browser.\n" +
        `  ${error instanceof Error ? error.message : String(error)}\n` +
        "  Three ways out:\n" +
        "    1. In CI, install one: `npx playwright-core install --with-deps chrome`. Note the " +
        "spelling — `playwright-core` is the package you already have, and `npx playwright …` " +
        "would fetch a second one. GitHub's `ubuntu-latest` needs no such step: it ships Google " +
        "Chrome at `/usr/bin/google-chrome`, which is where the `chrome` channel looks.\n" +
        "    2. Point `MCP_TESTS_CHROME_PATH` (or the suite's `executablePath` option) at a Chrome " +
        "or Chromium binary. `playwright-core` ships none by design.\n" +
        "    3. Register only `defineWebMcpDeclarativeSuite(target)`, which needs no browser.",
    );
  }

  // The certificate is real and covers the canonical host; what is accepted here is the untrusted
  // per-run root. See this module's header.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });

  // Before any page script, in every document this context loads. See REGISTRATION_OBSERVER.
  await context.addInitScript({ content: REGISTRATION_OBSERVER });

  const deadlineMs = resolveRegistrationDeadlineMs(
    options.registrationTimeoutMs,
    process.env[REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE],
  );

  interface WaitedReading {
    apiPresent: boolean;
    toolSurface: string;
    tools: RegisteredWebMcpTool[];
    registrationObserved: boolean;
    registrationDelayMs: number;
  }

  /**
   * Navigate an already-open tab and wait for the new document to register, so a caller can keep
   * the tab across navigations.
   *
   * @param page - The tab to navigate.
   * @param path - Path on the canonical origin.
   * @param baseline - Tool names live at the end of the previous navigation in this tab. Empty for
   *   a fresh tab; for a walk it is what an earlier document may have left behind, which is what
   *   keeps the wait from being satisfied by a leak.
   */
  const readInto = async (
    page: PlaywrightPage,
    path: string,
    baseline: readonly string[],
  ): Promise<RegisteredToolReading> => {
    const response = await page.goto(new URL(path, canonicalOrigin).toString(), {
      waitUntil: "load",
    });
    const reading = await page.evaluate<WaitedReading>(
      awaitRegistrationScript(baseline, deadlineMs, WEBMCP_REGISTRATION_POLL_MS),
    );
    return { path, status: response?.status() ?? 0, ...reading };
  };

  return {
    async read(path: string): Promise<RegisteredToolReading> {
      const page = await context.newPage();
      try {
        return await readInto(page, path, []);
      } finally {
        await page.close();
      }
    },

    async readSequence(paths: readonly string[]): Promise<readonly RegisteredToolReading[]> {
      const page = await context.newPage();
      try {
        const readings: RegisteredToolReading[] = [];
        for (const path of paths) {
          const previous = readings[readings.length - 1];
          readings.push(await readInto(page, path, previous?.tools.map((tool) => tool.name) ?? []));
        }
        return readings;
      } finally {
        await page.close();
      }
    },

    async execute(
      path: string,
      tool: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<ToolExecutionReading> {
      const page = await context.newPage();
      try {
        await page.goto(new URL(path, canonicalOrigin).toString(), { waitUntil: "load" });
        // A fresh tab, so nothing can be live but this document's own registrations — and the call
        // must not be made before they have landed, or a correct tool is reported unregistered.
        const waited = await page.evaluate<WaitedReading>(
          awaitRegistrationScript([], deadlineMs, WEBMCP_REGISTRATION_POLL_MS),
        );
        const reading = await page.evaluate<{
          apiPresent: boolean;
          toolSurface: string;
          registered: boolean;
          registeredNames: string[];
          executorPresent: boolean;
          attempts: ExecutionAttempt[];
        }>(executeToolScript(tool, args));
        return {
          path,
          tool,
          ...reading,
          registrationObserved: waited.registrationObserved,
          registrationDelayMs: waited.registrationDelayMs,
        };
      } finally {
        await page.close();
      }
    },
    close: async () => {
      await browser.close();
      await proxy.close();
    },
  };
}
