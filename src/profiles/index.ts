/**
 * The vendor client profiles this package ships.
 *
 * Each is transcribed from that vendor's own documentation and live metadata document, with every
 * field citing its source and a `verifiedAgainst` stamp. **A profile is edited only when the
 * vendor's documentation changes** — never to make a red test green. A profile bent to match a
 * server has converted a conformance suite into a regression suite for that server's behaviour,
 * which is worse than having no suite at all.
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
  CHATGPT_LEGACY_REDIRECT_URI,
  CHATGPT_REDIRECT_URI,
  chatgptClientMetadata,
  chatgptDesktopProfile,
} from "./chatgpt-desktop.js";
