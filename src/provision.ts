/**
 * The one call a consumer's global setup makes.
 *
 * Starts whatever the target's suites need, in dependency order, and hands back a teardown that
 * unwinds it in reverse. A consumer's global setup is therefore three lines and contains no
 * knowledge of certificates, document hosts, port allocation, or readiness probing.
 *
 * The document host is started **only when the target declares the authorization capability**,
 * because it exists to serve OAuth client metadata documents and a server with no authorization has
 * nothing to fetch. That conditional is the extensibility mechanism in miniature: a future test
 * family adds what it needs here, gated on its own capability, and every existing consumer is
 * unaffected.
 */

import {
  startDocumentHost,
  type DocumentHost,
} from "./harness/document-host.js";
import {
  clearDeploymentHandoff,
  startTargetDeployment,
  type RunningDeployment,
} from "./harness/deployment.js";
import type { McpTestTarget } from "./target.js";

/** What a provisioned run consists of. */
export interface ProvisionedRun {
  readonly deployment: RunningDeployment;
  /** Present only when the target declared the authorization capability. */
  readonly documentHost?: DocumentHost;
  readonly teardown: () => Promise<void>;
}

/**
 * Provision everything one target's suites need for this test run.
 *
 * @param target - The MCP server under test.
 * @returns The running deployment and a teardown.
 * @throws Error when the target's preflight refuses or the server never becomes ready — loudly,
 *   never as a silent skip: a conformance run that quietly tested nothing is the worst outcome
 *   available.
 */
export async function provisionMcpTestRun(
  target: McpTestTarget,
): Promise<ProvisionedRun> {
  const documentHost = target.authorization ? await startDocumentHost() : undefined;
  try {
    const { deployment, stop } = await startTargetDeployment(target, {
      documentOrigin: documentHost?.origin,
      documentControlOrigin: documentHost?.controlOrigin,
      documentCaCertificatePem: documentHost?.caCertificatePem,
    });

    process.stdout.write(
      `\nmcp-client-tests: ${target.id} → ${deployment.canonicalOrigin} ` +
        `(127.0.0.1:${deployment.appPort})` +
        (documentHost ? `, documents ${documentHost.origin}` : "") +
        `\nmcp-client-tests: server log at ${deployment.logPath}\n\n`,
    );

    return {
      deployment,
      documentHost,
      teardown: async () => {
        await stop();
        await documentHost?.close();
        await target.authorization?.close?.();
        clearDeploymentHandoff(target.id);
      },
    };
  } catch (error) {
    await documentHost?.close();
    throw error;
  }
}
