/**
 * What a consuming project tells this package about the MCP server it wants tested.
 *
 * **This is the whole integration surface.** Everything else in the package — the transport, the
 * modelled browser, the OAuth client, the vendor profiles, the suites — is written from published
 * specifications and vendor documentation and knows nothing about any particular server. A consumer
 * writes one file implementing the type below and gets every suite whose requirements it satisfies.
 *
 * ## Capabilities, not configuration
 *
 * A target does not say "run the OAuth tests". It says **what it is able to do**, and each suite
 * family declares what it needs. A server with no authorization at all still gets the protocol and
 * tool-surface families; adding {@link AuthorizationCapability} unlocks the OAuth conformance
 * family without touching anything already written. That is what keeps the package extensible in
 * the direction it is meant to grow: a new family adds a capability and a suite, never a branch in
 * an existing one.
 *
 * The rule for adding a family: **the capability describes the SERVER, never the test.** `hasOAuth`
 * is a fact about the deployment; `runOAuthTests` would be a configuration flag, and a flag is how a
 * suite ends up silently skipped in the one repository that most needed it.
 */

/**
 * What the package knows only once a run has started, offered to the consumer's environment builder.
 *
 * Every field is optional because each depends on a capability: no authorization capability means no
 * document host, and therefore no origin and no certificate authority to trust.
 */
export interface DeploymentRuntimeFacts {
  /** The loopback HTTPS origin client metadata documents are served from. */
  readonly documentOrigin?: string;
  /** Path to the PEM certificate authority the server must trust to fetch from that origin. */
  readonly caCertificatePath?: string;
  /** The loopback port allocated for the server. */
  readonly port: number;
}

/** How to start the server under test, and how to know it is up. */
export interface DeploymentSpec {
  /**
   * The executable to run. Anything that serves HTTP: a Node entry point, a compiled Go binary, a
   * launcher script. The package spawns it, waits for readiness, and stops it — it never assumes a
   * framework, a language, or a package manager.
   */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * Environment for the child.
   *
   * A **function** when the server needs to be told about something the package only knows once it
   * has started — the document host's origin, or where the run's certificate authority was written.
   * Those values differ every run, so they cannot be literals, and the server names its own settings
   * for them, so the package cannot set them itself. Handing the runtime facts to the consumer keeps
   * both sides honest: the package never guesses a variable name, and the server never learns one of
   * the package's.
   *
   * The port is always added separately (see {@link portEnvironmentVariable}).
   */
  readonly env:
    | Readonly<Record<string, string>>
    | ((runtime: DeploymentRuntimeFacts) => Readonly<Record<string, string>>);
  /**
   * The variable the server reads its listen port from. The port is allocated by the package so a
   * conformance run can never collide with a developer's own server.
   */
  readonly portEnvironmentVariable: string;
  /**
   * A path on the canonical origin that answers `200` once the server is serving. Probed through
   * the same proxy translation every test uses, so readiness means "the path a client takes works",
   * not "a socket accepted".
   */
  readonly readyPath: string;
  /** How long to wait for readiness before failing the run. Defaults to 90 seconds. */
  readonly readyTimeoutMs?: number;
  /**
   * A prerequisite the consumer wants checked before anything is started, e.g. "a production build
   * exists". Return a message to abort with; return undefined to proceed. Failing here produces a
   * clear instruction instead of a mysterious readiness timeout.
   */
  preflight?(): string | undefined;
}

/** A signed-in account holder in the server under test, and the cookie that proves it. */
export interface AccountHolder {
  readonly userId: string;
  readonly sessionCookieName: string;
  readonly sessionCookieValue: string;
}

/**
 * Everything the OAuth conformance family needs beyond a running server.
 *
 * An authorization-code flow has a human in it, and no amount of protocol knowledge lets this
 * package sign one in — the consumer's session mechanism is its own. Supplying this is what makes
 * the consent leg real rather than mocked.
 */
export interface AuthorizationCapability {
  /**
   * Create a real, signed-in, authorized account holder in the running server's storage.
   *
   * Implementations write whatever their own sign-in path writes. Nothing about the OAuth flow may
   * be shortcut here: the cookie returned must be the credential a browser would actually hold, or
   * the suite is testing a fiction.
   *
   * @param suiteId - The calling suite's identifier. Use it to namespace the rows created, so a
   *   suite's cleanup can never reach a sibling's holder — they share one deployment.
   */
  createAccountHolder(suiteId: string): Promise<AccountHolder>;

  /** Remove everything {@link createAccountHolder} created for one suite. */
  clearAccountHolders(suiteId: string): Promise<void>;

  /**
   * The `id` of the consent screen's approval form.
   *
   * The consent screen is application UI, not protocol, so the package cannot find its controls
   * without being told. Permission checkboxes are located by their `form=` association with this id.
   */
  readonly consentFormId: string;

  /**
   * The access-token lifetime the deployment was started with, in seconds.
   *
   * Declaring it unlocks the expiry path — "the token expires, the client refreshes, the retry
   * succeeds" — which every long-lived connection walks and which no test can reach against a
   * production lifetime. Deployments usually expose this through a test-only setting that can only
   * *shorten* the lifetime; the suite waits it out for real rather than faking a clock, because
   * against a live server there is no clock to fake.
   *
   * Omit it and the expiry assertion is skipped rather than guessed at.
   */
  readonly accessTokenSeconds?: number;

  /** Release any resources the capability opened (a database client, a connection pool). */
  close?(): Promise<void>;
}

/**
 * One MCP server to test.
 *
 * The `authorization` capability is optional on purpose — see the module header.
 */
export interface McpTestTarget {
  /** Stable identifier, used in temp-file names and diagnostics. */
  readonly id: string;
  /**
   * The origin the server believes it is served on — HTTPS, and normally without a port.
   *
   * Every deployed MCP server terminates TLS at a proxy and receives plain HTTP behind it, so this
   * is the origin its issuer, `resource`, redirect targets, and `Secure` cookies are derived from,
   * while the socket carries HTTP. The package reproduces exactly that split; the server must be
   * configured to believe this value (usually via its own base-URL setting in
   * {@link DeploymentSpec.env}).
   */
  readonly canonicalOrigin: string;
  /** The MCP endpoint path a user would type, e.g. `/mcp`. */
  readonly mcpPath: string;
  readonly deployment: DeploymentSpec;
  readonly authorization?: AuthorizationCapability;
}

/** The MCP server URL a user pastes into their client. */
export function mcpServerUrl(target: McpTestTarget): string {
  return `${target.canonicalOrigin}${target.mcpPath}`;
}
