/**
 * The package's own tests.
 *
 * These cover the harness's **pure** units — the parts that decide what a client would have derived,
 * parsed, or sent. They are deliberately not integration tests: the conformance suites themselves
 * only run against a consumer's server, so what can be verified here in isolation is the machinery
 * that a suite trusts to be correct while it points at somebody else's deployment.
 *
 * That distinction matters more than it looks. A defect in `wellKnownInsertion` or
 * `parseBearerChallenge` would make every consumer's suite assert the wrong thing *quietly* — the
 * failure would look like a finding about their server. These tests are what stop this package from
 * reporting its own bugs as somebody else's.
 */

import { describe, expect, it } from "vitest";

import { advise, formatAdvisories, takeAdvisories } from "./advisory.js";
import { findForm, browserOriginFor } from "./browser.js";
import { consentControls } from "./flow.js";
import {
  MCP_STATELESS_REVISION,
  parseBearerChallenge,
  statelessMessage,
} from "./mcp-client.js";
import {
  advertisedVersions,
  duplicateToolNames,
  iconSourcingProblem,
  inputSchemaProblem,
  publishedIcons,
  readCachingHints,
  resultTypeOf,
  serverIdentity,
  SERVER_INFO_META_KEY,
  toolNameProblem,
} from "./mcp-surface.js";
import { createLoopbackTlsMaterial } from "./tls-certificate.js";
import { wellKnownInsertion } from "./vendor-profile.js";
import { cite, offers, IETF, MCP } from "./specifications.js";
import type { WireResponse } from "./edge-transport.js";

function fakeResponse(headers: Record<string, string>): WireResponse {
  return {
    status: 200,
    headers: new Headers(headers),
    setCookies: [],
    body: Buffer.alloc(0),
    text: () => "",
    json: <T,>() => ({}) as T,
  };
}

describe("wellKnownInsertion", () => {
  it("inserts the segment before a path-bearing identifier rather than appending it", () => {
    expect(
      wellKnownInsertion("https://example.com/api/oauth", "oauth-authorization-server"),
    ).toBe("https://example.com/.well-known/oauth-authorization-server/api/oauth");
  });

  it("produces the bare well-known URL for a path-less identifier", () => {
    expect(wellKnownInsertion("https://example.com", "oauth-authorization-server")).toBe(
      "https://example.com/.well-known/oauth-authorization-server",
    );
  });

  it("ignores a trailing slash rather than emitting a doubled separator", () => {
    expect(wellKnownInsertion("https://example.com/mcp/", "oauth-protected-resource")).toBe(
      "https://example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("keeps a non-default port, which is part of the identifier", () => {
    expect(wellKnownInsertion("https://example.com:8443/mcp", "oauth-protected-resource")).toBe(
      "https://example.com:8443/.well-known/oauth-protected-resource/mcp",
    );
  });
});

describe("parseBearerChallenge", () => {
  it("reads the scheme and every quoted auth-param", () => {
    const challenge = parseBearerChallenge(
      'Bearer error="insufficient_scope", scope="a:read a:write", resource_metadata="https://x.test/.well-known/oauth-protected-resource/mcp"',
    );

    expect(challenge?.scheme).toBe("Bearer");
    expect(challenge?.parameters.get("error")).toBe("insufficient_scope");
    expect(challenge?.parameters.get("scope")).toBe("a:read a:write");
    expect(challenge?.parameters.get("resource_metadata")).toBe(
      "https://x.test/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("reads an unquoted auth-param value", () => {
    expect(
      parseBearerChallenge("Bearer error=invalid_token")?.parameters.get("error"),
    ).toBe("invalid_token");
  });

  it("reads a scheme with no parameters", () => {
    expect(parseBearerChallenge("Bearer")?.scheme).toBe("Bearer");
  });

  it("treats an absent header as no challenge, not an empty one", () => {
    // The difference decides whether a suite reports "the server sent no challenge" or
    // "the server sent a challenge with nothing in it" — two different findings.
    expect(parseBearerChallenge(null)).toBeUndefined();
  });
});

describe("browserOriginFor", () => {
  it("sends the page's own origin under a policy that permits it", () => {
    expect(fakeResponse({ "referrer-policy": "same-origin" })).toBeDefined();
    expect(browserOriginFor(fakeResponse({ "referrer-policy": "same-origin" }), "https://x.test")).toBe(
      "https://x.test",
    );
  });

  it("serializes the origin as null under no-referrer, even same-origin", () => {
    // The Fetch standard's behaviour, and the reason a server that sets `no-referrer` and then
    // requires a same-origin `Origin` rejects its own consent form. Deriving this rather than
    // assuming it is what makes that contradiction a red test.
    expect(browserOriginFor(fakeResponse({ "referrer-policy": "no-referrer" }), "https://x.test")).toBe(
      "null",
    );
  });

  it("sends the origin when the page states no policy", () => {
    expect(browserOriginFor(fakeResponse({}), "https://x.test")).toBe("https://x.test");
  });
});

describe("findForm", () => {
  const consent = `
    <html><head><title>Authorize</title></head><body>
      <input form="approve" type="checkbox" name="scope" value="a:read" checked disabled>
      <input form="approve" type="checkbox" name="scope" value="a:write">
      <input form="other" type="checkbox" name="scope" value="ignored" checked>
      <form id="approve" method="post" action="/decide">
        <input type="hidden" name="csrf" value="tok3n">
        <button type="submit" name="decision" value="allow">Allow</button>
      </form>
    </body></html>`;

  it("associates controls by their form attribute, not only by nesting", () => {
    // A consent screen can lay its permission checkboxes outside the button's form; matching by
    // nesting alone would silently submit no scopes at all.
    const form = findForm(consent, "approve");
    expect(form.checkboxes.map((c) => c.value)).toEqual(["a:read", "a:write"]);
  });

  it("reports checked and disabled separately, because a browser submits neither alike", () => {
    const form = findForm(consent, "approve");
    expect(form.checkboxes[0]).toMatchObject({ checked: true, disabled: true });
    expect(form.checkboxes[1]).toMatchObject({ checked: false, disabled: false });
  });

  it("collects hidden fields and the form's action", () => {
    const form = findForm(consent, "approve");
    expect(form.action).toBe("/decide");
    expect(form.method).toBe("POST");
    expect(form.fields.get("csrf")).toBe("tok3n");
  });

  it("quotes the document when the expected form is absent", () => {
    // What the server rendered INSTEAD is the diagnosis; "the form is missing" never is.
    expect(() => findForm("<html><head><title>Sign-in error</title></head></html>", "approve"))
      .toThrow(/Sign-in error/);
  });
});

describe("consentControls", () => {
  it("defaults the checkbox name to `scope`", () => {
    expect(consentControls({ consentFormId: "approve" })).toEqual({
      consentFormId: "approve",
      consentScopeFieldName: "scope",
    });
  });

  it("carries the deployment's own control name when it declares one", () => {
    // A deployment whose decision route reads `selectedScopes` is exactly as conformant as one
    // reading `scope`; nothing in any specification names this control.
    expect(
      consentControls({ consentFormId: "approve", consentScopeFieldName: "selectedScopes" }),
    ).toEqual({ consentFormId: "approve", consentScopeFieldName: "selectedScopes" });
  });
});

describe("createLoopbackTlsMaterial", () => {
  it("mints a certificate authority and a server credential it signed", () => {
    const material = createLoopbackTlsMaterial();

    expect(material.caCertificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(material.serverCertificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(material.serverKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it("produces a certificate a TLS stack can parse, valid now and for the loopback names", async () => {
    // The DER is hand-encoded, so "does a real X.509 parser accept it" is the assertion that
    // matters; a malformed field would otherwise surface as an inscrutable handshake failure in
    // somebody else's conformance run.
    const { X509Certificate } = await import("node:crypto");
    const material = createLoopbackTlsMaterial();
    const leaf = new X509Certificate(material.serverCertificatePem);
    const authority = new X509Certificate(material.caCertificatePem);

    expect(leaf.subjectAltName).toContain("127.0.0.1");
    expect(leaf.subjectAltName).toContain("localhost");
    expect(leaf.checkIssued(authority)).toBe(true);
    expect(leaf.verify(authority.publicKey)).toBe(true);
    expect(authority.ca).toBe(true);
    expect(new Date(leaf.validTo).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(leaf.validFrom).getTime()).toBeLessThan(Date.now());
  });
});

describe("cite", () => {
  it("carries the clause, its URL, and its verification date into the message", () => {
    const message = cite(IETF.PKCE, "the verifier must be checked against the challenge");

    expect(message).toContain("the verifier must be checked against the challenge");
    expect(message).toContain(IETF.PKCE.clause);
    expect(message).toContain(IETF.PKCE.url);
    expect(message).toContain(IETF.PKCE.verified);
  });
});

describe("toolNameProblem", () => {
  it("accepts a name using the whole permitted vocabulary", () => {
    expect(toolNameProblem("catalog.find_entity-v2")).toBeUndefined();
  });

  it("names the characters that put a name outside the vocabulary", () => {
    // The finding has to say WHICH character: the author of `search files` and the author of
    // `search:files` have the same symptom and different fixes.
    const problem = toolNameProblem("search files, now");

    expect(problem).toContain('" "');
    expect(problem).toContain('","');
  });

  it("refuses a name past the length the contract names", () => {
    expect(toolNameProblem("a".repeat(129))).toContain("129 characters");
    expect(toolNameProblem("a".repeat(128))).toBeUndefined();
  });

  it("treats an absent or empty name as a problem rather than a pass", () => {
    expect(toolNameProblem("")).toBeDefined();
    expect(toolNameProblem(undefined)).toBeDefined();
  });
});

describe("duplicateToolNames", () => {
  it("reports each duplicated name once, whatever its multiplicity", () => {
    expect(duplicateToolNames(["a", "b", "a", "a", "c"])).toEqual(["a"]);
  });

  it("finds nothing in a unique list", () => {
    expect(duplicateToolNames(["a", "b"])).toEqual([]);
  });
});

describe("inputSchemaProblem", () => {
  it("accepts an object schema", () => {
    expect(inputSchemaProblem({ type: "object", properties: {} })).toBeUndefined();
  });

  it("reports null against the clause that forbids it by name", () => {
    expect(inputSchemaProblem(null)).toContain("null");
  });

  it("reports a schema that does not describe an object", () => {
    expect(inputSchemaProblem({ type: "string" })).toContain('"string"');
  });

  it("reports an absent schema", () => {
    expect(inputSchemaProblem(undefined)).toBe("is absent");
  });
});

describe("readCachingHints", () => {
  it("reads hints carried on the result", () => {
    expect(readCachingHints({ ttlMs: 60_000, cacheScope: "private" })).toEqual({
      ttlMs: 60_000,
      cacheScope: "private",
      carriedIn: "result",
    });
  });

  it("reads `ttlMs: 0` as published rather than as absent", () => {
    // `0` means "always stale", which is a deliberate answer. Treating it as absent would report a
    // server that answered the question as one that ignored it.
    expect(readCachingHints({ ttlMs: 0, cacheScope: "public" }).carriedIn).toBe("result");
  });

  it("falls back to `_meta` and says where it found them", () => {
    expect(readCachingHints({ _meta: { ttlMs: 5, cacheScope: "public" } })).toEqual({
      ttlMs: 5,
      cacheScope: "public",
      carriedIn: "_meta",
    });
  });

  it("reports absent when neither envelope carries them", () => {
    expect(readCachingHints({ tools: [] })).toEqual({ carriedIn: "absent" });
  });
});

describe("serverIdentity", () => {
  it("reads the `_meta` key the stateless revision moved identity onto", () => {
    // A `server/discover` result has no `serverInfo` field at all — it carries `supportedVersions`,
    // `capabilities` and `instructions`, and the identity rides `_meta`. Looking only at the
    // top-level field reports a server that publishes a full identity as publishing none.
    expect(
      serverIdentity({ _meta: { [SERVER_INFO_META_KEY]: { name: "x" } } }),
    ).toEqual({
      fields: { name: "x" },
      carriedIn: `_meta["${SERVER_INFO_META_KEY}"]`,
    });
  });

  it("reads the top-level `serverInfo` an `initialize` result carries on the older revision", () => {
    expect(serverIdentity({ serverInfo: { name: "x" } })?.carriedIn).toBe("serverInfo");
  });

  it("prefers the revision's own location when a server publishes both", () => {
    expect(
      serverIdentity({
        serverInfo: { name: "legacy" },
        _meta: { [SERVER_INFO_META_KEY]: { name: "current" } },
      })?.fields.name,
    ).toBe("current");
  });

  it("reports no identity rather than an empty one", () => {
    // The difference decides whether the advice is "add a field" or "publish an identity at all".
    expect(serverIdentity({ tools: [] })).toBeUndefined();
  });
});

describe("advertisedVersions", () => {
  it("reads the revisions a `server/discover` result advertises", () => {
    expect(
      advertisedVersions({ supportedVersions: ["2025-11-25", "2026-07-28"] }),
    ).toEqual(["2025-11-25", "2026-07-28"]);
  });

  it("reports none when the result advertises none, rather than inventing one", () => {
    expect(advertisedVersions({ capabilities: {} })).toEqual([]);
  });
});

describe("iconSourcingProblem", () => {
  it("accepts an icon on the server's own authority", () => {
    expect(
      iconSourcingProblem("https://mcp.example.com/icon.png", "https://mcp.example.com"),
    ).toBeUndefined();
  });

  it("accepts a `data:` URI from any server", () => {
    expect(
      iconSourcingProblem("data:image/png;base64,AAA", "https://mcp.example.com"),
    ).toBeUndefined();
  });

  it("accepts a relative src, which resolves onto the server's own origin", () => {
    expect(iconSourcingProblem("/static/icon.png", "https://mcp.example.com")).toBeUndefined();
  });

  it("reports a CDN-hosted icon, which loads nowhere and says nothing", () => {
    const problem = iconSourcingProblem(
      "https://cdn.example.net/icon.png",
      "https://mcp.example.com",
    );

    expect(problem).toContain("https://cdn.example.net");
    expect(problem).toContain("https://mcp.example.com");
  });

  it("reports a `file://` icon on an HTTP server, where it is offered to stdio servers only", () => {
    expect(iconSourcingProblem("file:///icons/x.png", "https://mcp.example.com")).toContain(
      "stdio",
    );
  });
});

describe("publishedIcons", () => {
  it("returns the icon entries", () => {
    expect(publishedIcons({ icons: [{ src: "a" }, { src: "b" }] })).toHaveLength(2);
  });

  it("returns nothing for a surface that publishes none, or publishes a non-array", () => {
    expect(publishedIcons({})).toEqual([]);
    expect(publishedIcons({ icons: "none" })).toEqual([]);
  });
});

describe("resultTypeOf", () => {
  it("reads it from the result, then from `_meta`", () => {
    expect(resultTypeOf({ resultType: "complete" })).toBe("complete");
    expect(resultTypeOf({ _meta: { resultType: "input_required" } })).toBe("input_required");
  });

  it("reports none when the result declares none", () => {
    expect(resultTypeOf({ tools: [] })).toBeUndefined();
  });
});

describe("statelessMessage", () => {
  it("carries the protocol version and capabilities the handshake used to negotiate", () => {
    // There is no `initialize` on this revision, so a request omitting this `_meta` never states
    // which protocol it speaks — and the whole protocol family asserts against it.
    const message = statelessMessage("tools/list") as {
      params: { _meta: Record<string, unknown> };
    };

    expect(message.params._meta["io.modelcontextprotocol/protocolVersion"]).toBe(
      MCP_STATELESS_REVISION,
    );
    expect(message.params._meta["io.modelcontextprotocol/clientCapabilities"]).toEqual({});
  });
});

describe("advisories", () => {
  const advisory = {
    subject: "server identity",
    finding: "publishes no `icons[]`",
    consequence: "VS Code renders them since 1.105; this server shows a default instead.",
    source: MCP.ICONS,
  };

  it("drains what was recorded, so a second report never repeats the first", () => {
    advise("scope-a", advisory);

    expect(takeAdvisories("scope-a")).toHaveLength(1);
    expect(takeAdvisories("scope-a")).toHaveLength(0);
  });

  it("keeps scopes apart, so two targets in one run do not merge", () => {
    advise("scope-b", advisory);
    advise("scope-c", { ...advisory, subject: "tool descriptions" });

    expect(takeAdvisories("scope-b").map((entry) => entry.subject)).toEqual(["server identity"]);
    expect(takeAdvisories("scope-c").map((entry) => entry.subject)).toEqual(["tool descriptions"]);
  });

  it("renders the subject, the finding, the cost, and the clause that OFFERS it", () => {
    const report = formatAdvisories("wire", [advisory]);

    expect(report).toContain("server identity");
    expect(report).toContain("publishes no `icons[]`");
    expect(report).toContain("VS Code renders them since 1.105");
    expect(report).toContain(MCP.ICONS.url);
    // The relation is this channel's whole promise: advice must never read as a requirement, or a
    // reader stops believing the failures too.
    expect(report).toContain("offered by:");
    expect(report).not.toContain("required by:");
  });

  it("says nothing at all when there is nothing to advise", () => {
    expect(formatAdvisories("wire", [])).toBe("");
  });
});

describe("offers", () => {
  it("carries the clause, its URL, and its verification date, under a relation of its own", () => {
    const message = offers(IETF.PKCE, "the server publishes no PKCE methods");

    expect(message).toContain(IETF.PKCE.clause);
    expect(message).toContain(IETF.PKCE.verified);
    expect(message).toContain("offered by:");
  });
});
