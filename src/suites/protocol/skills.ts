/** Checks only servers that advertise Skills; absence of this optional extension is conforming. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MCP_STATELESS_REVISION,
  discoverMessage,
  firstResult,
  mcpRequest,
  statelessMessage,
} from "../../harness/mcp-client.js";
import { cachingHintsProblem, declaredExtensions } from "../../harness/mcp-surface.js";
import { SKILLS_EXTENSION, skillManifestProblems } from "../../harness/skills-surface.js";
import { MCP, cite } from "../../harness/specifications.js";
import type { McpTestTarget } from "../../target.js";
import { openWireConnection, type WireConnection } from "./connection.js";

const SUITE_ID = "protocol-skills";

/**
 * Register the Skills extension's required read methods and manifest/cache checks.
 *
 * Only metadata is read: no served instruction is executed and no tool is called.
 * @param target - The server under test.
 */
export function defineSkillsConformanceSuite(target: McpTestTarget): void {
  describe("MCP Skills extension", () => {
    let connection: WireConnection;
    let capabilities: Record<string, unknown> | undefined;
    let advertised = false;

    async function call(method: string, params: Record<string, unknown> = {}) {
      return mcpRequest(
        connection.target,
        connection.serverUrl,
        statelessMessage(method, params, 1, { extensions: { [SKILLS_EXTENSION]: {} } }),
        { revision: MCP_STATELESS_REVISION, accessToken: connection.accessToken },
      );
    }

    beforeAll(async () => {
      connection = await openWireConnection(target, SUITE_ID);
      const discovery = firstResult(await mcpRequest(
        connection.target, connection.serverUrl, discoverMessage(),
        { revision: MCP_STATELESS_REVISION, accessToken: connection.accessToken },
      ));
      capabilities = discovery?.capabilities as Record<string, unknown> | undefined;
      advertised = declaredExtensions(capabilities).includes(SKILLS_EXTENSION);
    }, 180_000);

    afterAll(async () => { await target.authorization?.clearAccountHolders(SUITE_ID); });

    it("declares Resources when it declares Skills", (context) => {
      if (!advertised) context.skip("Server does not advertise Skills");
      expect(capabilities?.resources, cite(MCP.EXTENSION_SKILLS,
        "A Skills server MUST also declare the Resources capability; skill files use resources/read.",
      )).toBeTypeOf("object");
      expect(capabilities?.resources, cite(MCP.EXTENSION_SKILLS,
        "Resources capability settings are an object, never null.",
      )).not.toBeNull();
    });

    it("returns complete, cacheable manifests through list and get", async (context) => {
      if (!advertised) context.skip("Server does not advertise Skills");
      const seen = new Set<string>();
      let cursor: string | undefined;
      // This is a runner budget, not a specification limit: exhaustion is an explicit harness stop.
      for (let page = 0; page < 100; page += 1) {
        const listed = firstResult(await call("skills/list", cursor ? { cursor } : {}));
        expect(listed, cite(MCP.EXTENSION_SKILLS,
          "An advertised Skills extension MUST implement skills/list.",
        )).toBeDefined();
        assertComplete(listed);
        expect(Array.isArray(listed?.skills), cite(MCP.EXTENSION_SKILLS,
          "skills/list returns a skills array; an empty or partial listing is allowed.",
        )).toBe(true);
        for (const entry of listed?.skills as unknown[]) {
          expect(skillManifestProblems(entry), cite(MCP.SKILL_MANIFEST,
            "Every listed skill carries frontmatter and a complete file manifest or resources: dynamic.",
          )).toEqual([]);
          const uri = (entry as { uri: string }).uri;
          const fetched = firstResult(await call("skills/get", { uri }));
          expect(fetched, cite(MCP.EXTENSION_SKILLS,
            `skills/get MUST answer for the listed skill ${uri}.`,
          )).toBeDefined();
          assertComplete(fetched);
          expect(skillManifestProblems(fetched?.skill), cite(MCP.SKILL_MANIFEST,
            "skills/get returns the same manifest shape as skills/list; content may change between reads.",
          )).toEqual([]);
          expect((fetched?.skill as { uri?: unknown })?.uri, cite(MCP.EXTENSION_SKILLS,
            "skills/get returns the skill identified by params.uri.",
          )).toBe(uri);
        }
        if (listed?.nextCursor === undefined) return;
        const next = listed.nextCursor;
        if (typeof next !== "string" || next.length === 0 || seen.has(next)) {
          throw new Error("Harness stopped Skills pagination: unusable or repeated cursor");
        }
        seen.add(next);
        cursor = next;
      }
      throw new Error("Harness stopped Skills pagination at its 100-page budget; completeness was not verified");
    }, 180_000);
  });
}

function assertComplete(result: Record<string, unknown> | undefined): void {
  expect(result?.resultType, cite(MCP.EXTENSION_SKILLS,
    "Skills list/get results MUST have resultType: complete.",
  )).toBe("complete");
  expect(cachingHintsProblem(result), cite(MCP.EXTENSION_SKILLS,
    "Skills list/get results extend CacheableResult: ttlMs and cacheScope are REQUIRED.",
  )).toBeUndefined();
}
