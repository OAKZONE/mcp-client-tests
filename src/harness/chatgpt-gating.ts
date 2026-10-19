/**
 * Catalog-based advice for ChatGPT Chat scheduled runs. This inspects published metadata, never
 * executes a write, and cannot observe the host's permissions, safety decisions or saved catalog.
 */
import type { Advisory } from "./advisory.js";
import { VENDOR } from "./specifications.js";
import { readToolAnnotations } from "./tool-gating.js";
import { nameSome, publishedToolNames, type PublishedTool } from "./tool-listing.js";

/** Phrases worth reviewing, not a replica of OpenAI's undisclosed safety checks. */
const APPROVAL_STEERING =
  /\b(?:never\s+(?:ask|request)\s+(?:for\s+)?(?:approval|confirmation)|(?:skip|bypass|ignore)\s+(?:all\s+|the\s+)?(?:approval|confirmation|safety)\b|(?:already|pre)[ -]?(?:approved|authorized)\b|(?:all|every)\s+(?:tools?|actions?)\s+(?:are|is)\s+(?:100%\s+)?safe\b)/i;

/**
 * Return actionable, cited advisories. Absence and invalid types remain unknown; a false hint is
 * an explicit declaration. Empty catalogs have no tool-specific scheduled-write subject.
 */
export function chatgptGateAdvisories(tools: readonly PublishedTool[]): readonly Advisory[] {
  if (tools.length === 0) return [];
  const names = publishedToolNames(tools);
  const hints = tools.map(readToolAnnotations);
  const selected = (predicate: (index: number) => boolean): string[] =>
    names.filter((_, index) => predicate(index));
  const writes = selected((index) => hints[index]?.readOnlyHint === false);
  const unknown = selected((index) => hints[index]?.readOnlyHint === undefined);
  const destructive = selected((index) => hints[index]?.destructiveHint === true);
  const missing = tools.flatMap((_, index) => {
    const absent = (["readOnlyHint", "destructiveHint", "openWorldHint"] as const)
      .filter((key) => hints[index]?.[key] === undefined);
    return absent.length ? [`\`${names[index]}\`: ${absent.join(", ")}`] : [];
  });
  const advisories: Advisory[] = [{
    subject: "ChatGPT Chat: permissions are not execution guarantees",
    finding: "The catalog cannot establish whether a scheduled Chat run will execute a tool.",
    consequence:
      "Client/operator check: distinguish enabled Actions from approval Permissions, select the " +
      "intended app account, and inspect workspace restrictions. Allow all actions does not " +
      "override safety protections or provider authorization. A green wire test is not a " +
      "scheduled-run certification; verify in Chat, not Work or Codex.",
    source: VENDOR.OPENAI_APP_PERMISSIONS,
    relation: "reports",
  }];

  if (missing.length > 0) advisories.push({
    subject: "ChatGPT plugin annotation declarations",
    finding: `${missing.length} tools lack explicit boolean hints required for plugin publication:\n      ${missing.join("\n      ")}`,
    consequence:
      "Server fix: publish readOnlyHint, destructiveHint and openWorldHint as booleans in " +
      "annotations, including false values. Missing or non-boolean is not false. Mark real " +
      "writes readOnlyHint: false; review every mode and indirect effect. A bounded private " +
      "account can be openWorldHint: false even when hosted remotely; arbitrary destinations " +
      "are open-world. Verify ChatGPT's approved tool definition after deploying changes. " +
      "This is a plugin requirement, not a universal MCP requirement or an approval bypass.",
    source: VENDOR.OPENAI_PLUGIN_ANNOTATIONS,
    relation: "reports",
  });

  if (writes.length > 0 || unknown.length > 0) {
    advisories.push({
      subject: "ChatGPT Chat scheduled write approval",
      finding:
        `${writes.length} tools declare writes: ${nameSome(writes) || "none"}. ` +
        `${unknown.length} lack a usable readOnlyHint: ${nameSome(unknown) || "none"}.`,
      consequence:
        "A scheduled action requiring approval pauses until reviewed. Operator check: compare " +
        "the exact approval/error message with server request logs before changing OAuth. " +
        "No tools/call receipt alone cannot identify the blocking layer. Test a harmless write " +
        "in Chat, then two scheduled runs, including a run after approving the first. " +
        "Record account, mode, model, permissions, tool definition and actual destination state. " +
        "Do not label writes read-only to make the schedule pass.",
      source: VENDOR.OPENAI_SCHEDULED_APPROVALS,
      relation: "reports",
    }, {
      subject: "ChatGPT Chat cross-run approval is unverified",
      finding: "Approving a blocked run does not establish permission for the next scheduled run.",
      consequence:
        "The custom-server guide's conversation memory is not a durable scheduler grant. " +
        "Do not prescribe Responses API require_approval or Codex approval_policy as Chat " +
        "settings. Keep a reviewable draft/preview path and report pending approval accurately; " +
        "if unattended writes remain blocked, investigate the host policy with OpenAI Support.",
      source: VENDOR.OPENAI_SCHEDULED_APPROVAL_PERSISTENCE,
    });
  }

  if (destructive.length > 0) advisories.push({
    subject: "ChatGPT irreversible-action safeguards",
    finding: `${destructive.length} tools declare destructive effects: ${nameSome(destructive)}.`,
    consequence:
      "Server review: preserve honest hints and enforce authorization and required human " +
      "confirmation. A preview should be separate from apply where their confirmation needs " +
      "differ. An idempotency key can prevent duplicate effects; it is not consent and does " +
      "not remove approval requirements. Check destination state before retrying an uncertain run.",
    source: VENDOR.OPENAI_WRITE_SAFETY,
    relation: "reports",
  });

  const steering = selected((index) =>
    typeof tools[index].description === "string" &&
    APPROVAL_STEERING.test(tools[index].description));
  if (steering.length > 0) advisories.push({
    subject: "ChatGPT approval-steering description review",
    finding: `${nameSome(steering)} contain wording that may claim authority over approval or safety.`,
    consequence:
      "Heuristic only: inspect the text in context, including negation and examples. Describe " +
      "actual effects, destinations and bounds rather than claiming calls are pre-approved or " +
      "telling the host to skip checks. Moving such claims into server instructions does not " +
      "grant permission. This matcher does not predict a safety rejection.",
    source: VENDOR.OPENAI_PLUGIN_ANNOTATIONS,
    relation: "reports",
  });
  return advisories;
}
