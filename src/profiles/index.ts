/**
 * The vendor client profiles this package ships.
 *
 * Each is transcribed from that vendor's own documentation and live metadata document, with every
 * field citing its source and a `verifiedAgainst` stamp. **A profile is edited only when the
 * vendor's documentation changes** — never to make a red test green. A profile bent to match a
 * server has converted a conformance suite into a regression suite for that server's behaviour,
 * which is worse than having no suite at all.
 *
 * **Two kinds live here, and they answer different questions.** An OAuth profile describes how a
 * client *authorizes* — behaviour the harness executes, one surface at a time. A
 * {@link ClientGate} describes what a client does with a tool list it has already received —
 * published facts about somebody else's software, which nothing can execute and a server can only
 * be told about. Both are keyed per client **surface** rather than per vendor, because Claude Code
 * and the hosted Claude surfaces disagree on both counts.
 *
 * Exported separately from the suites so a consumer can inspect a profile, or drive one directly
 * from a bespoke test, without pulling in the whole family.
 */

export {
  CLAUDE_HOSTED_REDIRECT_URI,
  claudeClientMetadata,
  claudeDesktopProfile,
} from "./claude-desktop.js";

export {
  CLAUDE_CODE_LOOPBACK_HOSTS,
  CLAUDE_CODE_SESSION_PORT,
  claudeCodeClientMetadata,
  claudeCodeProfile,
  claudeCodeRedirectUri,
} from "./claude-code.js";

export {
  CHATGPT_PER_CONNECTION_REDIRECT_URI,
  CHATGPT_STABLE_REDIRECT_URI,
  chatgptClientIdMetadataUrl,
  chatgptClientMetadata,
  chatgptDesktopProfile,
  chatgptRedirectUri,
} from "./chatgpt-desktop.js";

export {
  CLIENT_GATES,
  chatgptGate,
  claudeCodeGate,
  claudeHostedGate,
  codexCliGate,
  cursorGate,
  messagesApiGate,
  toolCapSummary,
  unannotatedConsequences,
  vscodeCopilotGate,
  type ClientGate,
  type GradedFact,
} from "./client-gates.js";
