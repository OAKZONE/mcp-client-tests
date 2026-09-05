/**
 * What each client surface does with a tool list it has already received, as data.
 *
 * **Why this sits beside the OAuth profiles rather than inside them.** A {@link VendorProfile}
 * describes how a client *authorizes* — its redirect URI, its metadata document, its scope ladder —
 * and it is behaviour the harness executes. This describes what a client does *after* it is
 * connected, which no harness can execute: it is a set of published facts about somebody else's
 * software, and a server can only be told about them. Two different questions, two different
 * shapes, and merging them would put an unrunnable field on a profile the flow drives.
 *
 * **One row per client SURFACE, never per vendor** (MCT02). Claude Code and the hosted Claude
 * surfaces disagree about tool caps, deferral, and where permissions live; ChatGPT and Codex
 * disagree about almost everything. A `claude` row would average two contracts into one that
 * describes neither, which is the failure the per-surface rule exists to prevent.
 *
 * **Every row is graded, and the grade travels.** Each fact carries the clause it came from, and
 * that clause carries how well established it is. A `strong` fact may reach a consumer as an
 * assertion; anything below it can only ever be advice, because `cite()` refuses it. That is why
 * the ~256 and ~40 tool ceilings can sit here in full without any risk of one day failing somebody's
 * build on a number no vendor ever published.
 *
 * **This file is read, never executed.** It exists so a finding can say *what this costs you, on
 * which client* — which is the difference between "annotate your tools" and "ChatGPT will confirm
 * every one of these calls, and Claude will not offer to remember the approval".
 */

import type { SpecificationClause } from "../harness/specifications.js";
import { VENDOR } from "../harness/specifications.js";

/** One published fact about a client, and where it was read. */
export interface GradedFact {
  /** The fact, in one sentence, in the client's own terms. */
  readonly statement: string;
  /** Where it was read. Its grade decides whether anything may be asserted on it. */
  readonly source: SpecificationClause;
}

/**
 * One client surface's gate.
 *
 * The five fields are the five things that decide whether a published tool ever runs, and they are
 * deliberately the same five for every surface: a reader comparing two rows is comparing like with
 * like, and a gap shows up as `unverified` rather than as a missing field nobody notices.
 */
export interface ClientGate {
  /** Stable identifier, used in report lines. */
  readonly id: string;
  /** How the surface is referred to in its vendor's own documentation. */
  readonly displayName: string;
  /** The client build or documentation revision every field below was read against. */
  readonly verifiedAgainst: string;
  /** Whether this client reads a tool's `annotations`, and what it does with them. */
  readonly usesAnnotations: GradedFact;
  /**
   * What this surface does with a tool carrying **no** hint.
   *
   * The single most useful sentence in the row, because it is the consequence a server can act on
   * and the one it most often does not know about.
   */
  readonly unannotatedConsequence: GradedFact;
  /** The cap on how many tools reach the model, and whose budget it is. */
  readonly toolCap: GradedFact;
  /** The default per-call approval posture. */
  readonly approvalDefault: GradedFact;
  /** Whether a safety model may veto a call that policy already allowed. */
  readonly classifier: GradedFact;
  /**
   * The administrator switch that can remove this server, or one of its tools, entirely.
   *
   * Carried because **a consumer hitting one of these cannot fix it by changing their server**, and
   * will spend a day trying unless something tells them so.
   */
  readonly adminOffSwitch: GradedFact;
}

/** The revision of the distilled vendor documentation every row below was transcribed from. */
const SWEEP = "2026-09-05 vendor sweep";

/**
 * Claude's hosted surfaces — claude.ai, Claude Desktop, and Cowork.
 *
 * The surface where annotations buy the most and where the catalog ceiling is least established.
 */
export const claudeHostedGate: ClientGate = Object.freeze({
  id: "claude-hosted",
  displayName: "Claude — claude.ai, Desktop, Cowork",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement:
      "Yes. The hints 'determine auto-permissions in Claude: read-only tools can run without " +
      "per-call confirmation; destructive tools always prompt.'",
    source: VENDOR.ANTHROPIC_REVIEW_CRITERIA,
  },
  unannotatedConsequence: {
    statement:
      "forfeits auto-permission — it never becomes a tool the user can let run without confirming",
    source: VENDOR.ANTHROPIC_REVIEW_CRITERIA,
  },
  toolCap: {
    statement:
      "reported at ~256 tools aggregated across every connected connector, keeping the " +
      "alphabetically-first and truncating the rest — which severs a namespace mid-way rather " +
      "than dropping a coherent group",
    source: VENDOR.ANTHROPIC_AGGREGATE_TOOL_CEILING,
  },
  approvalDefault: {
    statement:
      "per tool, user-set, defaulting to ask, with a per-tool Always allow in connector settings",
    source: VENDOR.ANTHROPIC_REVIEW_CRITERIA,
  },
  classifier: {
    statement: "none documented for the chat surfaces",
    source: VENDOR.ANNOTATION_HANDLING_UNVERIFIED,
  },
  adminOffSwitch: {
    statement:
      "organization connector settings, plus per-tool `ask` — which no allow rule overrides — and " +
      "`blocked`, which removes the tool before Claude ever sees it",
    source: VENDOR.ANTHROPIC_MANAGED_MCP,
  },
});

/** Claude Code — the surface with the richest server-steerable gate, and a classifier over it. */
export const claudeCodeGate: ClientGate = Object.freeze({
  id: "claude-code",
  displayName: "Claude Code",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement:
      "Yes, and it honours two `_meta` keys besides — `anthropic/requiresUserInteraction` prompts " +
      "on every call in every permission mode, and `anthropic/maxResultSizeChars` raises a tool's " +
      "result threshold",
    source: VENDOR.ANTHROPIC_CLAUDE_CODE_MCP,
  },
  unannotatedConsequence: {
    statement:
      "is matched only by permission rules on `mcp__<server>__<tool>`, with no hint to justify an " +
      "automatic allow",
    source: VENDOR.ANTHROPIC_CLAUDE_CODE_MCP,
  },
  toolCap: {
    statement:
      "no documented cap; tool search defers loading by default on 4.5-class models, and a tool " +
      "whose schema fails the API's own checks is excluded at load time with the reason written " +
      "only to the client's log",
    source: VENDOR.ANTHROPIC_CLAUDE_CODE_MCP,
  },
  approvalDefault: {
    statement:
      "permission rules, auto-approved in `acceptEdits` / `auto` / `bypassPermissions` and denied " +
      "outright in `dontAsk`",
    source: VENDOR.ANTHROPIC_CLAUDE_CODE_MCP,
  },
  classifier: {
    statement:
      "yes — auto mode routes tool calls through a two-stage classifier whose first stage is told " +
      "to 'err on the side of blocking' (8.5% false positives, cut to 0.4% by a reasoning stage " +
      "that accepts 17% false negatives), and which is reasoning-blind by design, so nothing a " +
      "tool returns can argue its way past it",
    source: VENDOR.ANTHROPIC_AUTO_MODE,
  },
  adminOffSwitch: {
    statement:
      "`managed-mcp.json`, `allowedMcpServers` / `deniedMcpServers`, `allowManagedMcpServersOnly` " +
      "— a newly-blocked server disappears from `/mcp` and `claude mcp list` with no warning",
    source: VENDOR.ANTHROPIC_MANAGED_MCP,
  },
});

/** ChatGPT — the strictest annotation default in the reference. */
export const chatgptGate: ClientGate = Object.freeze({
  id: "chatgpt",
  displayName: "ChatGPT",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement:
      "Yes. 'We respect the `readOnlyHint` tool annotation. Tools without this hint are treated " +
      "as write actions.'",
    source: VENDOR.OPENAI_DEVELOPER_MODE,
  },
  unannotatedConsequence: {
    statement:
      "is treated as a **write** and confirmed on every call — and because approval memory lasts " +
      "one conversation and a refresh resets it, that confirmation never stops being asked",
    source: VENDOR.OPENAI_DEVELOPER_MODE,
  },
  toolCap: {
    statement: "not documented",
    source: VENDOR.ANNOTATION_HANDLING_UNVERIFIED,
  },
  approvalDefault: {
    statement:
      "every write action confirms, showing the JSON payload; a remembered choice applies to that " +
      "conversation only",
    source: VENDOR.OPENAI_DEVELOPER_MODE,
  },
  classifier: {
    statement:
      "some especially risky actions are blocked outright rather than presented for approval",
    source: VENDOR.OPENAI_RISKY_ACTIONS_BLOCKED,
  },
  adminOffSwitch: {
    statement:
      "workspace connector controls, and Connector Action Constraints an agent's builder sets — a " +
      "layer above the server that the server cannot see",
    source: VENDOR.OPENAI_RISKY_ACTIONS_BLOCKED,
  },
});

/** VS Code Copilot — the one documented hard cap, and an off-by-default enterprise switch. */
export const vscodeCopilotGate: ClientGate = Object.freeze({
  id: "vscode-copilot",
  displayName: "VS Code Copilot",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement:
      "reported to confirm everything not marked `readOnlyHint: true`, though the MCP developer " +
      "guide states nothing about annotations",
    source: VENDOR.MICROSOFT_VSCODE_ANNOTATIONS,
  },
  unannotatedConsequence: {
    statement: "is reported to confirm on every call",
    source: VENDOR.MICROSOFT_VSCODE_ANNOTATIONS,
  },
  toolCap: {
    statement:
      "128 per request, a hard error above it — and it counts every tool in the request, the " +
      "editor's built-ins and every other enabled server included, so a user with several servers " +
      "can be unable to run chat at all",
    source: VENDOR.MICROSOFT_VSCODE_AGENT_TOOLS,
  },
  approvalDefault: {
    statement:
      "confirmation per tool, with the input shown and editable; global and session auto-approve " +
      "settings exist, and a sandboxed server's calls auto-approve",
    source: VENDOR.MICROSOFT_VSCODE_AGENT_TOOLS,
  },
  classifier: {
    statement: "no tool-call classifier documented",
    source: VENDOR.ANNOTATION_HANDLING_UNVERIFIED,
  },
  adminOffSwitch: {
    statement:
      "an organization MCP policy that is **off by default** for the Business and Enterprise " +
      "subscribers it covers, and does not apply to Free, Pro, Pro+ or Max at all — so 'the " +
      "server is invisible for one user and works for another' is a policy symptom, not a defect",
    source: VENDOR.GITHUB_COPILOT_MCP_POLICY,
  },
});

/** Cursor — a documented classifier, an undocumented and contested ceiling. */
export const cursorGate: ClientGate = Object.freeze({
  id: "cursor",
  displayName: "Cursor",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement: "not established either way",
    source: VENDOR.ANNOTATION_HANDLING_UNVERIFIED,
  },
  unannotatedConsequence: {
    statement: "not established either way — publish the hints regardless; the cost is nil",
    source: VENDOR.ANNOTATION_HANDLING_UNVERIFIED,
  },
  toolCap: {
    statement:
      "an undocumented ceiling that existed, may have moved, and has never been published — ~40 " +
      "is widely repeated and a later report has 80+ with no warning",
    source: VENDOR.CURSOR_TOOL_CEILING,
  },
  approvalDefault: {
    statement: "asks before invoking an MCP tool",
    source: VENDOR.ANYSPHERE_CURSOR_MCP,
  },
  classifier: {
    statement:
      "yes — Auto-review sends non-allowlisted calls to a classifier that may allow, redirect, or " +
      "ask, which Cursor's own documentation calls an approval convenience rather than a security " +
      "boundary",
    source: VENDOR.ANYSPHERE_CURSOR_MCP,
  },
  adminOffSwitch: {
    statement: "enterprise command and URL patterns, plus per-server tool allowlists",
    source: VENDOR.ANYSPHERE_CURSOR_MCP,
  },
});

/** Codex CLI — where an honest `destructiveHint` may cost the most, if the report holds. */
export const codexCliGate: ClientGate = Object.freeze({
  id: "codex-cli",
  displayName: "Codex CLI",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement:
      "`readOnlyHint` drives concurrent execution from v0.134.0; beyond that, routing on the hints " +
      "is reported rather than documented",
    source: VENDOR.OPENAI_CODEX_MCP,
  },
  unannotatedConsequence: {
    statement:
      "cannot be run concurrently, and is reported to be refusable outright by a permission " +
      "profile rather than prompted for",
    source: VENDOR.CODEX_PROFILE_HARD_BLOCK,
  },
  toolCap: {
    statement: "not documented",
    source: VENDOR.ANNOTATION_HANDLING_UNVERIFIED,
  },
  approvalDefault: {
    statement: "follows `approval_policy` and the permission profile",
    source: VENDOR.OPENAI_CODEX_MCP,
  },
  classifier: {
    statement: "sandbox and approval policy rather than a classifier over MCP calls",
    source: VENDOR.OPENAI_CODEX_MCP,
  },
  adminOffSwitch: {
    statement: "`requirements.toml` for managed organizations",
    source: VENDOR.OPENAI_CODEX_MCP,
  },
});

/**
 * The Messages API connector — **the surface with no gate at all**.
 *
 * Kept in the matrix precisely because it has nothing to describe. It is the reason MCP13 exists:
 * whatever the other rows say, every catalog a server publishes is reachable from here, where no
 * human will confirm anything.
 */
export const messagesApiGate: ClientGate = Object.freeze({
  id: "messages-api",
  displayName: "Claude Messages API connector",
  verifiedAgainst: SWEEP,
  usesAnnotations: {
    statement: "not applicable — there is no user interface to steer",
    source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
  },
  unannotatedConsequence: {
    statement: "runs, like every other tool here — there is nothing to withhold",
    source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
  },
  toolCap: {
    statement: "whatever the developer sends",
    source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
  },
  approvalDefault: {
    statement: "**none — there is no human to prompt**",
    source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
  },
  classifier: {
    statement: "none",
    source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
  },
  adminOffSwitch: {
    statement: "the developer's own code",
    source: VENDOR.ANTHROPIC_MESSAGES_CONNECTOR,
  },
});

/**
 * Every client surface whose gate this package can describe, in the order a finding names them.
 *
 * Ordered by how decisively the surface acts on what a server publishes, so a reader hits the
 * consequences they can do something about first, and ends on the one that proves the point:
 * a surface where nothing will ask.
 */
export const CLIENT_GATES: readonly ClientGate[] = Object.freeze([
  chatgptGate,
  claudeHostedGate,
  claudeCodeGate,
  vscodeCopilotGate,
  codexCliGate,
  cursorGate,
  messagesApiGate,
]);

/**
 * Render what an unannotated tool costs, client by client.
 *
 * Built from {@link CLIENT_GATES} rather than written out, so a re-verification that moves one
 * client's behaviour moves every finding that quotes it — there is one place to edit, and it is the
 * place carrying the citation.
 *
 * @param gates - The surfaces to describe. Defaults to every one this package knows.
 * @returns One line per surface, each naming the client and what it does.
 */
export function unannotatedConsequences(
  gates: readonly ClientGate[] = CLIENT_GATES,
): string {
  return gates
    .map((gate) => `      · ${gate.displayName} — ${gate.unannotatedConsequence.statement}`)
    .join("\n");
}

/**
 * Render the tool caps, each with the grade of the source behind it.
 *
 * **The grades are the point.** Exactly one of these numbers is published by the vendor whose
 * client enforces it; the rest are community reports, one of them contested between two figures
 * that differ by a factor of two. A summary that printed them as a flat list of numbers would be
 * the failure mode of every "how many tools is too many" article, so each line says how much to
 * trust it.
 *
 * @param gates - The surfaces to describe. Defaults to every one this package knows.
 * @returns One line per surface, each naming the client, the cap, and its evidence grade.
 */
export function toolCapSummary(
  gates: readonly ClientGate[] = CLIENT_GATES,
): string {
  return gates
    .map(
      (gate) =>
        `      · ${gate.displayName} [${gate.toolCap.source.grade.toUpperCase()}] — ` +
        gate.toolCap.statement,
    )
    .join("\n");
}
