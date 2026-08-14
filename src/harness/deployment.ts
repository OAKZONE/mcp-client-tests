/**
 * One real deployment, started once per test run, shared by every suite.
 *
 * **What "real" means here.** The consumer's server is started as its own process — whatever
 * executable it names — listening on a loopback port behind the reverse-proxy translation in
 * `edge-transport.ts`. No module of the server under test is imported into the test process,
 * nothing is mocked, and no handler is called directly: every assertion this package makes is about
 * bytes that crossed a socket. That is the only arrangement in which a green result means a real
 * client would succeed.
 *
 * **Why boot once rather than per file.** Starting a server costs seconds, and an MCP server's
 * authorization state is process- and store-global: registered clients, issued grants, and abuse
 * buckets all live in one place, exactly as they do in production. Several suites sharing one
 * deployment is therefore *more* faithful than isolating them — a real deployment serves every
 * vendor at once. Isolation between suites comes from distinct identities, not fresh servers, so
 * nothing a suite does can silently depend on being alone.
 *
 * **The handoff.** Test runners execute global setup in a main process and suites in workers, so
 * the facts are written to a temp file keyed on the target id and a per-run id — never on a process
 * id, which differs between the writer and the reader under a forking pool. See
 * {@link conformanceRunId}.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { edgeRequest, type EdgeTarget } from "./edge-transport.js";
import type { McpTestTarget } from "../target.js";

/** Everything a worker needs to drive the running deployment. */
export interface RunningDeployment {
  readonly targetId: string;
  readonly canonicalOrigin: string;
  readonly mcpPath: string;
  readonly appPort: number;
  /** Loopback HTTPS origin the SERVER fetches client documents from, when one was started. */
  readonly documentOrigin?: string;
  /** Plain-HTTP control origin a worker publishes documents through. */
  readonly documentControlOrigin?: string;
  /** Where the server process's stdout and stderr are accumulating. */
  readonly logPath: string;
}

/**
 * The variable that ties one run's handoff files to the process tree that owns them.
 *
 * 🔴 It cannot be `process.pid`. The handoff is written by the **main** runner process during global
 * setup and read inside a **test worker**, and under Vitest's default `forks` pool a worker is a
 * separate process with its own pid — so a pid-keyed path resolves to two different files and every
 * suite fails with "no deployment was provisioned" while the deployment is running perfectly. That
 * reads exactly like a broken consumer setup, which is the class of harness artefact this package
 * must never produce (`AGENTS.md` MCT05).
 *
 * An environment variable is what both sides can see: global setup runs before any worker is
 * spawned, and both pools give a worker a copy of the parent's environment. Two concurrent runs on
 * one machine get different ids and therefore different files.
 */
const RUN_ID_VARIABLE = "MCP_CLIENT_TESTS_RUN_ID";

/**
 * Claim (or re-read) this run's id.
 *
 * Idempotent: the main process claims one during provisioning, and every later caller — including
 * every worker — reads that same value back out of the environment.
 *
 * @returns The run id.
 */
export function conformanceRunId(): string {
  let runId = process.env[RUN_ID_VARIABLE];
  if (!runId) {
    runId = `${process.pid}-${randomBytes(4).toString("hex")}`;
    process.env[RUN_ID_VARIABLE] = runId;
  }
  return runId;
}

/** The temp file the main process writes and the workers read. */
export function deploymentHandoffPath(targetId: string): string {
  return path.join(tmpdir(), `mcp-client-tests-${targetId}-${conformanceRunId()}.json`);
}

/**
 * Read the running deployment's facts inside a test worker.
 *
 * @param targetId - The target's identifier.
 * @returns The deployment facts.
 * @throws Error when no deployment was provisioned — always a wiring fault, never a skip
 *   condition; suites decide whether to run before ever calling this.
 */
export function readRunningDeployment(targetId: string): RunningDeployment {
  const handoff = deploymentHandoffPath(targetId);
  if (!existsSync(handoff)) {
    throw new Error(
      `No deployment was provisioned for target "${targetId}" (expected ${handoff}).\n` +
        "The global setup starts it; check its output above.",
    );
  }
  return JSON.parse(readFileSync(handoff, "utf8")) as RunningDeployment;
}

/** The proxy target for the running deployment. */
export function edgeTargetFor(deployment: RunningDeployment): EdgeTarget {
  return {
    canonicalOrigin: deployment.canonicalOrigin,
    appPort: deployment.appPort,
  };
}

/** The MCP endpoint URL for a running deployment. */
export function deploymentMcpUrl(deployment: RunningDeployment): string {
  return `${deployment.canonicalOrigin}${deployment.mcpPath}`;
}

/** Read the tail of the server process log — the first thing to look at when a test fails. */
export function readServerLogTail(
  deployment: RunningDeployment,
  lines = 60,
): string {
  if (!existsSync(deployment.logPath)) return "(no server log)";
  return readFileSync(deployment.logPath, "utf8").split("\n").slice(-lines).join("\n");
}

async function allocatePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (typeof address !== "object" || address === null) {
    probe.close();
    throw new Error("Could not allocate a loopback port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export interface DeploymentStartOptions {
  /** The HTTPS origin a document host is serving on, when the target needs one. */
  readonly documentOrigin?: string;
  readonly documentControlOrigin?: string;
  /** The authority that signed the document origin's certificate, PEM encoded. */
  readonly documentCaCertificatePem?: string;
}

/**
 * Start the server under test and wait until its readiness path answers.
 *
 * Readiness is probed through the proxy translation rather than on the raw port, so the deployment
 * is only considered up once the exact path a client's first request takes is answerable. The probe
 * asserts nothing about the response body — that is a suite's job — only that `200` arrived.
 *
 * @param target - The consumer's target definition.
 * @param options - Document-host wiring, when the target's suites need one.
 * @returns The deployment facts and a teardown that stops the process.
 * @throws Error when the preflight refuses, or the process exits or never becomes ready.
 */
export async function startTargetDeployment(
  target: McpTestTarget,
  options: DeploymentStartOptions = {},
): Promise<{
  readonly deployment: RunningDeployment;
  readonly stop: () => Promise<void>;
}> {
  const refusal = target.deployment.preflight?.();
  if (refusal) throw new Error(refusal);

  const appPort = await allocatePort();
  const logDirectory = path.join(tmpdir(), "mcp-client-tests-logs");
  mkdirSync(logDirectory, { recursive: true });
  const logPath = path.join(logDirectory, `${target.id}-${process.pid}.log`);
  rmSync(logPath, { force: true });

  // The per-run authority reaches the server process the way an internal CA reaches any service: as
  // a PEM file on disk. `NODE_EXTRA_CA_CERTS` covers a Node server; a server in another language
  // reads its own trust-store setting, which the consumer wires from `caCertificatePath` below. TLS
  // verification stays fully enabled either way — nothing here disables certificate checking.
  let caCertificatePath: string | undefined;
  if (options.documentCaCertificatePem) {
    caCertificatePath = path.join(logDirectory, `${target.id}-${process.pid}-ca.pem`);
    writeFileSync(caCertificatePath, options.documentCaCertificatePem, "utf8");
  }

  const runtime = {
    documentOrigin: options.documentOrigin,
    caCertificatePath,
    port: appPort,
  };
  const consumerEnvironment =
    typeof target.deployment.env === "function"
      ? target.deployment.env(runtime)
      : target.deployment.env;

  const environment: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(caCertificatePath ? { NODE_EXTRA_CA_CERTS: caCertificatePath } : {}),
    ...consumerEnvironment,
    [target.deployment.portEnvironmentVariable]: String(appPort),
  };

  const deployment: RunningDeployment = {
    targetId: target.id,
    canonicalOrigin: target.canonicalOrigin,
    mcpPath: target.mcpPath,
    appPort,
    documentOrigin: options.documentOrigin,
    documentControlOrigin: options.documentControlOrigin,
    logPath,
  };

  const child: ChildProcess = spawn(
    target.deployment.command,
    [...target.deployment.args],
    {
      cwd: target.deployment.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: environment,
    },
  );

  const appendLog = (chunk: Buffer): void => {
    try {
      writeFileSync(logPath, chunk.toString("utf8"), { flag: "a" });
    } catch {
      // A log write failing must never take the run down; the deployment is still usable.
    }
  };
  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const edge = edgeTargetFor(deployment);
  const deadline = Date.now() + (target.deployment.readyTimeoutMs ?? 90_000);
  let lastFailure = "never attempted";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await stop();
      throw new Error(
        `The server under test exited before becoming ready.\n${readServerLogTail(deployment)}`,
      );
    }
    try {
      const response = await edgeRequest(
        edge,
        `${target.canonicalOrigin}${target.deployment.readyPath}`,
      );
      if (response.status === 200) {
        writeFileSync(
          deploymentHandoffPath(target.id),
          JSON.stringify(deployment),
          "utf8",
        );
        return { deployment, stop };
      }
      lastFailure = `${target.deployment.readyPath} answered ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await stop();
  throw new Error(
    `The server under test never became ready (${lastFailure}).\n${readServerLogTail(deployment)}`,
  );
}

/** Remove the handoff file; the deployment itself is stopped by the returned teardown. */
export function clearDeploymentHandoff(targetId: string): void {
  rmSync(deploymentHandoffPath(targetId), { force: true });
}
