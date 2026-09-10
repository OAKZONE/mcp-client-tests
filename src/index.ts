/**
 * `@oakzone/mcp-client-tests` — conformance suites for MCP servers, written from the
 * specifications and from what MCP client vendors publish.
 *
 * A consumer supplies one {@link McpTestTarget} describing its server and which capabilities that
 * server has, then registers the suite families it qualifies for. Nothing in this package imports
 * consumer code, and no assertion is derived from any particular server's behaviour — the point is
 * to detect where an implementation and a specification disagree, which a suite written from the
 * implementation cannot do.
 *
 * ```ts
 * // mcp-tests/target.ts
 * export const target: McpTestTarget = { ... };
 *
 * // mcp-tests/global-setup.ts
 * export default async () => (await provisionMcpTestRun(target)).teardown;
 *
 * // mcp-tests/oauth.test.ts
 * defineOAuthConformanceSuites(target);
 * ```
 *
 * See `docs/consuming.md` for the full walkthrough and `docs/extending.md` for how a new test
 * family — tool-surface, protocol shape, anything else — plugs in.
 */

export type {
  AccountHolder,
  AuthorizationCapability,
  DeploymentRuntimeFacts,
  DeploymentSpec,
  McpTestTarget,
  RemoteDeployment,
  TargetDeployment,
  WebMcpCapability,
  WebMcpToolCall,
} from "./target.js";
export { isRemoteDeployment, mcpServerUrl } from "./target.js";

export { provisionMcpTestRun, type ProvisionedRun } from "./provision.js";

export {
  deploymentMcpUrl,
  edgeTargetFor,
  readRunningDeployment,
  readServerLogTail,
  type RunningDeployment,
} from "./harness/deployment.js";

export {
  IETF,
  MCP,
  VENDOR,
  WEBMCP,
  cite,
  offers,
  reports,
  type EvidenceGrade,
  type SpecificationClause,
} from "./harness/specifications.js";

export {
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
  type ToolAnnotations,
} from "./harness/tool-gating.js";

export {
  nameSome,
  publishedToolNames,
  readPublishedTools,
  type PublishedTool,
  type ToolListing,
  type ToolListingRequest,
} from "./harness/tool-listing.js";

export {
  openWebMcpBrowser,
  startCanonicalProxy,
  WEBMCP_LAUNCH_ARGS,
  type CanonicalProxy,
  type RegisteredToolReading,
  type RegisteredWebMcpTool,
  type ToolExecutionReading,
  type WebMcpBrowserOptions,
  type WebMcpBrowserSession,
} from "./harness/webmcp-browser.js";

export {
  acceptedEncodings,
  executionProblem,
  executionResultPayloads,
  inputSchemaEncoding,
  parseInputSchema,
  registeredToolSchemaProblem,
  reportedParameterValues,
  roundTripViolations,
  schemaProperties,
  schemaRefusal,
  type ArgumentEncoding,
  type ExecutionAttempt,
  type InputSchemaEncoding,
  type ReportedParameterValue,
} from "./harness/webmcp-execution.js";

export {
  leakedRegistrations,
  type DocumentToolReading,
} from "./harness/webmcp-lifetime.js";

export {
  pagesNearDeadline,
  registrationDelayFinding,
  resolveRegistrationDeadlineMs,
  REGISTRATION_DEADLINE_ENVIRONMENT_VARIABLE,
  WEBMCP_REGISTRATION_DEADLINE_MS,
  WEBMCP_REGISTRATION_POLL_MS,
  type RegistrationTiming,
} from "./harness/webmcp-registration.js";

export {
  conditionalDeliveryProblem,
  decodeOriginTrialToken,
  originCanHoldTrialToken,
  originTrialCoverage,
  originTrialProblem,
  servedOriginTrialTokens,
  type OriginTrialCoverage,
  type OriginTrialDelivery,
  type OriginTrialTokenPayload,
  type ServedOriginTrialToken,
} from "./harness/webmcp-origin-trial.js";

export {
  declarativeToolProblem,
  declarativeWebMcpTools,
  duplicateDeclarativeToolNames,
  imperativeRegistrationStyle,
  inlineScriptText,
  scriptSources,
  triageScriptUrls,
  undescribedParameters,
  type DeclarativeWebMcpParameter,
  type DeclarativeWebMcpTool,
  type ImperativeRegistrationStyle,
  type ScriptUrlTriage,
} from "./harness/webmcp-surface.js";

export {
  advise,
  reportAdvisories,
  type Advisory,
} from "./harness/advisory.js";

export {
  wellKnownInsertion,
  type ClientRegistrationMethod,
  type ScopeSelectionInputs,
  type TokenEndpointAuthMethod,
  type VendorProfile,
} from "./harness/vendor-profile.js";

export * from "./suites/index.js";
