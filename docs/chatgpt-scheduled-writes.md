# ChatGPT Chat: diagnosing scheduled MCP writes

Research checked 2026-10-19. This guide concerns scheduled tasks in **Chat** using
MCP-backed plugins. Work, Workspace Agents, Codex automations and the Responses
API have different controls. The package does not run ChatGPT or certify its
safety decisions.

## What the documentation establishes

**Allow all is not an execution guarantee.** Workspace action enablement and
approval permissions are separate. OpenAI documents that permissions do not
override safety protections, source authorization or workspace restrictions.
Check which control says “all” before interpreting it as persistent approval.
[OpenAI app action controls](https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-for-plugins-and-apps)

A scheduled task can pause when a write needs review. The documentation does not
promise that approving one custom MCP write authorizes later scheduled Chat
runs. This makes repeated approval consistent with a documented limitation,
but does not identify the cause of any particular incident.
[Scheduled tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)

The custom-server guide describes conversation-scoped approval memory and renewed
prompts after a refresh or new conversation. That is separate from persistent app
permissions; it is not proof that every schedule creates a new conversation.
[Custom MCP servers](https://developers.openai.com/api/docs/guides/custom-mcp-server)

No reviewed release note announces a general fix for repeated custom-MCP write
approvals in scheduled Chat. The plugin changelog's latest dated entry when read
was 2026-08-21. This is a bounded research result, not evidence that OpenAI made
no unannounced change. Verify the affected account and model again.
[ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes),
[plugin changelog](https://developers.openai.com/plugins/changelog)

## What this package reports

Register `defineToolSurfaceConformanceSuites(target)` as described in
[consuming.md](consuming.md). Its existing socket-based catalog read now produces
ChatGPT-specific advisories. It never invokes a consumer write to test approval.

| Finding | Owner and next step |
|:---|:---|
| Missing or non-boolean `readOnlyHint`, `destructiveHint`, `openWorldHint` | Server: provide all three explicitly for plugin publication; `false` is valid. `idempotentHint` is not one of these required three. |
| Declared write or unknown read-only status | Operator: test scheduled Chat approval; unknown is not a verified read. |
| Destructive effects | Server: preserve the hint and enforce required authorization/confirmation. Idempotency addresses duplication, not consent. |
| Description claims preapproval or tells the host to bypass checks | Server: review the wording; this is a heuristic, not a prediction of OpenAI's classifier. |
| No metadata issue found | Operator: still verify permissions, approved catalog and actual scheduled runs. |

These additions are advisories, not universal MCP conformance failures. The
publication requirements apply to OpenAI plugins, while runtime approval and
cross-run persistence cannot be established from `tools/list`. The separate
`chatgptScheduledChatGate` profile records that uncertainty with an evidence grade.

Publish hints for actual effects across all modes and indirect calls. A write
must remain `readOnlyHint: false`. A private account can be closed-world even
when remote; arbitrary destinations are different. A reversible-looking action
can still have irreversible effects, particularly sends and transactions.
[Plugin annotation requirements](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation)

Separate preview/read from apply when their risks and confirmations differ.
Bound the destination and affected records, and describe those effects clearly.
Retain server authorization and confirmation for irreversible actions.
[Tool design](https://developers.openai.com/plugins/plan/tools),
[security guidance](https://developers.openai.com/plugins/guides/security-privacy)

## Diagnose the layer before changing the server

| Evidence | Interpretation and action |
|:---|:---|
| Pending approval in the scheduled conversation | Review that action. Do not infer a future-run grant. |
| Explicit safety denial | Capture the exact message and minimal reproduction for OpenAI Support; a metadata test cannot override it. |
| No matching `tools/call` in complete ingress logs | Execution did not reach that endpoint. Check selection, availability, transport, snapshot and approval; absence alone does not prove a safety denial. |
| HTTP `401`, expired token, failed refresh, or scope challenge | Investigate OAuth/token lifecycle and the selected connection. Approval text does not renew credentials. |
| Request arrived but returned a tool error | Inspect server authorization, validation and application failure. |
| Request may have partly succeeded | Inspect destination state before retrying; use business-level deduplication for the same operation. |

OpenAI's troubleshooting guidance distinguishes authorization, unavailable
actions, approval waits and explicit safety blocks; repeated reconnects are not
a general repair. Its indexed article text was readable during this research,
but direct retrieval of that page failed, so UI details should be rechecked.
[Troubleshooting plugins and apps](https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt)

A published plugin may still expose an older definition while a changed tool is
under continuous review. Verify the definition ChatGPT actually offers. For a
workspace custom app, use its admin refresh/review flow; do not assume every
distribution path updates identically.
[Published tool updates](https://developers.openai.com/plugins/deploy/app-review#continuous-review-and-tool-updates)

## Reproduce in the affected surface

Use a sandbox account and harmless fixture destination. This is an operator test
recipe, not a promise about the outcome:

1. Record Chat mode, model, app version, plan/workspace, selected connection,
   task instructions, permission labels, and approved tool annotations.
2. Run one read and one narrowly scoped write interactively. Record the exact
   approval message, request timestamp/correlation ID, and destination result.
3. Schedule the same bounded operation in Chat. Observe two actual scheduled
   runs. If the first pauses, approve it and record whether the second pauses
   again. A manual “run now” alone does not establish recurring behavior.
4. Separately test after access-token expiry to distinguish refresh failures
   from approval. Verify fresh credentials without logging tokens or secrets.
5. Record completed, pending, denied and unknown outcomes separately. A scheduler
   notification or a successful `tools/list` does not prove the write happened.

Give OpenAI Support the redacted reproduction, timestamps/timezone, exact denial,
effective permissions and whether the server received the attempted call.
Within your own service, use explicit failure reporting and an authorized,
reviewable draft/apply workflow where needed. If a workflow requires guaranteed
unattended execution, assess a separately authorized runner with an explicit
approval policy; changing runners is an architectural decision.

`require_approval` belongs to a Responses API caller, not MCP tool metadata or
Chat settings. Likewise, Codex `approval_policy` and Workspace Agent write
controls cannot establish the permissions of scheduled Chat.
[Responses API MCP approvals](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## Verification of this change

`npm run validate` passes typecheck, lint, 253 harness tests and build. The changed
suite also ran against a real consumer's existing production build and disposable
test database using this checkout: 130 tests passed and two optional Skills tests
skipped across six files. The report identified 12 declared write tools and
emitted the scheduled-approval and cross-run uncertainty advisories. It did not
execute those writes or reproduce a scheduled run inside ChatGPT.

The new profile and corrected vendor guidance are included in the
[v0.12.0 minor release](../CHANGELOG.md).
