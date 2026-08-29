/**
 * Getting far enough into a server to look at its surface, whether or not it has authorization.
 *
 * The protocol family asks what the server publishes — its discovery result, its tool list, its
 * caching hints — and every one of those is behind whatever gate the server puts in front of the
 * MCP endpoint. So this module answers one question before any suite runs: **can this run see the
 * surface at all, and if not, what is the consumer supposed to do about it?**
 *
 * Three outcomes, in order of preference:
 *
 * 1. **The server lists tools without a credential.** Nothing else is needed. This is the shape the
 *    lazy-authentication pattern produces, where discovery and listing are public and only a
 *    protected `tools/call` challenges.
 * 2. **The server refuses, and the target declares the authorization capability.** A credential is
 *    obtained by driving a real authorization, and the surface is inspected as an authorized client
 *    sees it — which is the only correct way to read a list the revision permits to vary by the
 *    authorization presented.
 * 3. **The server refuses and no credential can be obtained.** The run stops here, loudly. A
 *    protocol family that quietly asserted nothing would be the worst outcome available: it would
 *    report green while looking at a `401`.
 *
 * **On the credential in case 2.** It is obtained by driving the hosted-Claude profile, because a
 * credential has to come from somewhere and that profile is the protocol spine the OAuth family
 * already exercises in full. Nothing here asserts anything about that client: if the OAuth family
 * is green this step is a given, and if it is red, this suite says so in its own words rather than
 * duplicating the finding.
 */

import {
  deploymentMcpUrl,
  edgeTargetFor,
  readRunningDeployment,
  type RunningDeployment,
} from "../../harness/deployment.js";
import { connectDocumentHost } from "../../harness/document-host.js";
import type { EdgeTarget } from "../../harness/edge-transport.js";
import {
  assertDeploymentIsServing,
  completeAuthorization,
  consentControls,
  discoverDeployment,
  openOAuthSession,
  publishClientMetadata,
  selectedScope,
} from "../../harness/flow.js";
import {
  MCP_STATELESS_REVISION,
  mcpRequest,
  statelessMessage,
  type McpExchange,
} from "../../harness/mcp-client.js";
import { claudeDesktopProfile } from "../../profiles/claude-desktop.js";
import type { McpTestTarget } from "../../target.js";

/** Where the harness publishes the client metadata document used to obtain a credential. */
const CLIENT_METADATA_PATH = "/claude/oauth/mcp-oauth-client-metadata";

/** A way into the server under test, and what it took to get there. */
export interface WireConnection {
  readonly deployment: RunningDeployment;
  readonly target: EdgeTarget;
  /** The MCP endpoint URL, exactly as a user would type it. */
  readonly serverUrl: string;
  /** The credential every request should carry, or undefined when the surface is public. */
  readonly accessToken?: string;
}

/** Whether an exchange was refused for want of a credential, rather than answered. */
function refusedForCredential(exchange: McpExchange): boolean {
  return exchange.http.status === 401 || exchange.http.status === 403;
}

/**
 * Open a connection the protocol suites can inspect a surface through.
 *
 * @param mcpTarget - The MCP server under test.
 * @param suiteId - The calling suite's identifier, used to namespace any account holder created.
 * @returns The deployment, the transport, and a credential when one was needed and available.
 * @throws Error when the server refuses an unauthenticated listing and the target declares no
 *   authorization capability — with the two ways out named, because a silent skip here would leave
 *   a consumer believing a family ran when it saw nothing.
 */
export async function openWireConnection(
  mcpTarget: McpTestTarget,
  suiteId: string,
): Promise<WireConnection> {
  const deployment = readRunningDeployment(mcpTarget.id);
  const target = edgeTargetFor(deployment);
  const serverUrl = deploymentMcpUrl(deployment);
  await assertDeploymentIsServing(target, serverUrl);

  const unauthenticated = await mcpRequest(
    target,
    serverUrl,
    statelessMessage("tools/list"),
    { revision: MCP_STATELESS_REVISION },
  );
  if (!refusedForCredential(unauthenticated)) {
    return { deployment, target, serverUrl };
  }

  const authorization = mcpTarget.authorization;
  if (!authorization) {
    throw new Error(
      `The MCP endpoint refused an unauthenticated \`tools/list\` with ` +
        `${unauthenticated.http.status}, and this target declares no authorization capability, so ` +
        "the protocol suites cannot see the surface they exist to inspect.\n" +
        "  Either declare `authorization` on the target so a credential can be obtained, or serve " +
        "discovery and listing unauthenticated and challenge on the first protected `tools/call`.",
    );
  }

  const documents = connectDocumentHost(
    deployment.documentOrigin!,
    deployment.documentControlOrigin!,
  );
  const holder = await authorization.createAccountHolder(suiteId);
  const profile = claudeDesktopProfile(documents.url(CLIENT_METADATA_PATH));
  const clientId = await publishClientMetadata(documents, profile);
  const discovered = await discoverDeployment(target, profile, serverUrl);
  const session = openOAuthSession(discovered, profile, clientId);
  const completed = await completeAuthorization({
    target,
    profile,
    discovered,
    session,
    resource: String(discovered.protectedResource.resource),
    scope: selectedScope(profile, discovered),
    sessionCookieName: holder.sessionCookieName,
    sessionCookieValue: holder.sessionCookieValue,
    ...consentControls(authorization),
  });

  return {
    deployment,
    target,
    serverUrl,
    accessToken: completed.tokens.access_token,
  };
}
