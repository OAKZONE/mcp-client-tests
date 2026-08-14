/**
 * The OAuth conformance family — one suite per MCP client **surface**.
 *
 * **One profile per surface, never per vendor.** Every vendor whose contract has been examined warns
 * against generalising one surface to another, and the warning is load-bearing: Claude Code differs
 * from Claude's hosted surfaces on redirect URI, scope selection, and step-up, and folding them
 * together hides the redirect defect entirely — a defect that makes the CLI unable to sign in at
 * all while every browser-based client works.
 *
 * Each suite is registered independently so a consumer can adopt them one at a time, which matters
 * when a surface turns out to be unreachable and the fix is a real change rather than a config edit.
 */

import type { McpTestTarget } from "../../target.js";

import { defineChatgptDesktopSuite } from "./chatgpt-desktop.js";
import { defineClaudeCodeSuite } from "./claude-code.js";
import { defineClaudeDesktopSuite } from "./claude-desktop.js";

export { defineChatgptDesktopSuite, defineClaudeCodeSuite, defineClaudeDesktopSuite };

/**
 * Register every OAuth conformance suite this package ships against one target.
 *
 * Each suite skips itself unless the target declares the authorization capability, so calling this
 * from a server that has no OAuth is harmless rather than an error.
 *
 * @param target - The MCP server under test.
 */
export function defineOAuthConformanceSuites(target: McpTestTarget): void {
  defineClaudeDesktopSuite(target);
  defineClaudeCodeSuite(target);
  defineChatgptDesktopSuite(target);
}
