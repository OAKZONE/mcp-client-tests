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

import { findForm, browserOriginFor } from "./browser.js";
import { consentControls } from "./flow.js";
import { parseBearerChallenge } from "./mcp-client.js";
import { createLoopbackTlsMaterial } from "./tls-certificate.js";
import { wellKnownInsertion } from "./vendor-profile.js";
import { cite, IETF } from "./specifications.js";
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
