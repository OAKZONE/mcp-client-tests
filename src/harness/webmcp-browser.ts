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
   * **Not which spelling the page used**, which is unobservable from here: `navigator.modelContext`
   * is an alias Chrome still keeps for `document.modelContext`, so both names reference one object
   * and both are present on any browser that has the API — whatever the page wrote. The page's
   * choice of spelling lives only in its source text, which is why the deprecation advisory belongs
   * to the declarative suite and not to this one.
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

/** The script evaluated in the page: the same question an attached agent asks. */
const READ_TOOLS = `(async () => {
  const shape = (tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  });
  const candidates = ${SURFACE_CANDIDATES};
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
})()`;

/**
 * The script that calls one tool, once per published argument encoding.
 *
 * **The tool object never leaves the page.** `executeTool` takes the `RegisteredTool` the surface
 * handed out, and that object cannot be carried across the evaluation boundary and back — so the
 * whole call, from finding the tool by name to catching the rejection, happens in the tab.
 *
 * Both encodings are attempted unconditionally. The draft types the argument as an `object`; the
 * shipping implementation is reported to require a JSON string, and only the browser under test can
 * settle which it is. A run that stopped at the first success would record half the answer, and half
 * the answer is what lets a page ship built against the wrong one.
 *
 * The rejection is flattened to `Name: message` on the way out, because a `DOMException` does not
 * survive serialization and its `name` is the part that identifies the failure.
 *
 * @param toolName - The registered tool to call.
 * @param args - The arguments to call it with.
 * @returns The script source.
 */
function executeToolScript(toolName: string, args: Readonly<Record<string, unknown>>): string {
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
  for (const encoding of ["object", "json-string"]) {
    const argument = encoding === "object" ? request.args : JSON.stringify(request.args);
    try {
      const result = await executor.executeTool(tool, argument);
      attempts.push({ encoding, accepted: true, result: carry(result) });
    } catch (error) {
      const name = (error && error.name) || "Error";
      const message = (error && error.message) || String(error);
      attempts.push({ encoding, accepted: false, error: name + ": " + message });
    }
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
        "  Two ways out:\n" +
        "    1. Point `MCP_TESTS_CHROME_PATH` (or the suite's `executablePath` option) at a Chrome " +
        "or Chromium binary. `playwright-core` ships none by design.\n" +
        "    2. Register only `defineWebMcpDeclarativeSuite(target)`, which needs no browser.",
    );
  }

  // The certificate is real and covers the canonical host; what is accepted here is the untrusted
  // per-run root. See this module's header.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });

  /** Read one page in an already-open tab, so a caller can keep the tab across navigations. */
  const readInto = async (page: PlaywrightPage, path: string): Promise<RegisteredToolReading> => {
    const response = await page.goto(new URL(path, canonicalOrigin).toString(), {
      waitUntil: "load",
    });
    const reading = await page.evaluate<{
      apiPresent: boolean;
      toolSurface: string;
      tools: RegisteredWebMcpTool[];
    }>(READ_TOOLS);
    return { path, status: response?.status() ?? 0, ...reading };
  };

  return {
    async read(path: string): Promise<RegisteredToolReading> {
      const page = await context.newPage();
      try {
        return await readInto(page, path);
      } finally {
        await page.close();
      }
    },

    async readSequence(paths: readonly string[]): Promise<readonly RegisteredToolReading[]> {
      const page = await context.newPage();
      try {
        const readings: RegisteredToolReading[] = [];
        for (const path of paths) readings.push(await readInto(page, path));
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
        const reading = await page.evaluate<{
          apiPresent: boolean;
          toolSurface: string;
          registered: boolean;
          registeredNames: string[];
          executorPresent: boolean;
          attempts: ExecutionAttempt[];
        }>(executeToolScript(tool, args));
        return { path, tool, ...reading };
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
