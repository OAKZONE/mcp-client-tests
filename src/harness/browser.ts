/**
 * The user agent half of an OAuth flow.
 *
 * An authorization-code flow is not one client talking to one server — it is a client, a browser,
 * and a person. The browser's behaviour is load-bearing and specified: it carries cookies across the
 * authorization request, the login leg, and the consent POST; it computes an `Origin` header from
 * the page's own `Referrer-Policy`; and it stops at the client's redirect URI instead of following
 * it. A harness that skips the browser tests only the half of the flow that never breaks.
 *
 * **Modelled, not simulated.** Two behaviours here are deliberately derived rather than hard-coded,
 * because deriving them is what makes a disagreement between the server's own headers and the
 * server's own checks show up as a red test:
 *
 * - **`Origin` on a form POST comes from the page's `Referrer-Policy`.** The Fetch standard
 *   serializes a non-GET request's `Origin` as the literal `null` under `no-referrer` — *even
 *   same-origin* — so a server that sets `no-referrer` and then requires a same-origin `Origin` has
 *   defeated its own CSRF control. This deployment hit exactly that. The policy is read off the
 *   response rather than assumed.
 *   See <https://fetch.spec.whatwg.org/#append-a-request-origin-header>.
 * - **Cookies are stored by name and value only.** `Path`, `SameSite`, `Secure`, and expiry are the
 *   real browser's business; asserting on them is a test's business. Enforcing them here would let
 *   this harness quietly decide a flow fails, which is the server's answer to give.
 *   See <https://www.rfc-editor.org/rfc/rfc6265>.
 */

import { edgeRequest, type EdgeTarget, type WireResponse } from "./edge-transport.js";
import { parseAttributes } from "./html.js";

/** One navigation step, kept so a test can assert the shape of a redirect chain. */
export interface NavigationStep {
  readonly url: string;
  readonly status: number;
  readonly location: string | null;
}

export interface BrowserNavigation {
  /** The final response, after following the redirects the browser was willing to follow. */
  readonly response: WireResponse;
  /** Every step taken, first request first. */
  readonly steps: readonly NavigationStep[];
  /**
   * The off-origin URL navigation stopped at, if any.
   *
   * A real browser follows a redirect to the client's callback; the harness stops there and hands
   * the URL back, because that URL *is* the authorization response the client consumes.
   */
  readonly stoppedAt: string | null;
}

export interface HtmlForm {
  readonly action: string;
  readonly method: string;
  /** Every named field with a value, including hidden inputs. */
  readonly fields: ReadonlyMap<string, string>;
  /** Checkbox controls, whether they are checked, and whether the control is disabled. */
  readonly checkboxes: readonly {
    readonly name: string;
    readonly value: string;
    readonly checked: boolean;
    readonly disabled: boolean;
  }[];
}

/**
 * Extract every `<input>` in a document, associated with the form it submits to.
 *
 * HTML allows an input to join a form by `form="<id>"` rather than by nesting — which is how a
 * consent screen can lay out permission checkboxes outside the button's form — so nesting alone is
 * not a reliable association. Inputs are collected document-wide and matched by explicit `form`
 * attribute or by falling back to the single enclosing form.
 */
function collectInputs(
  html: string,
): { attributes: Map<string, string> }[] {
  const inputs: { attributes: Map<string, string> }[] = [];
  const pattern = /<input\b[^>]*>/gi;
  let match = pattern.exec(html);
  while (match !== null) {
    inputs.push({ attributes: parseAttributes(match[0]) });
    match = pattern.exec(html);
  }
  return inputs;
}

/**
 * Find a form in a rendered page and the controls that submit with it.
 *
 * @param html - The rendered document.
 * @param formId - The form's `id`, when the page uses `form=` association.
 * @returns The form's action, method, fields, and checkbox controls.
 * @throws Error when no matching form is present — the page rendered something else, which is a
 *   finding rather than a harness fault, so the message quotes the document's first line.
 */
export function findForm(html: string, formId?: string): HtmlForm {
  const formPattern = /<form\b[^>]*>/gi;
  let chosen: Map<string, string> | undefined;
  let match = formPattern.exec(html);
  while (match !== null) {
    const attributes = parseAttributes(match[0]);
    if (formId === undefined || attributes.get("id") === formId) {
      chosen = attributes;
      break;
    }
    match = formPattern.exec(html);
  }
  if (!chosen) {
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "(no title)";
    // The document is quoted because "the expected form is missing" is never the useful half of
    // this failure — what the deployment rendered INSTEAD is. A protocol error page, a login
    // redirect, and an empty body are three very different findings that otherwise look identical.
    throw new Error(
      `No ${formId ? `form#${formId}` : "form"} in the rendered page (title: ${title}). ` +
        "The page under test rendered something other than the expected screen.\n" +
        `--- first 400 bytes of the document ---\n${html.slice(0, 400)}\n---`,
    );
  }

  const fields = new Map<string, string>();
  const checkboxes: {
    name: string;
    value: string;
    checked: boolean;
    disabled: boolean;
  }[] = [];
  for (const { attributes } of collectInputs(html)) {
    const name = attributes.get("name");
    if (!name) continue;
    if (formId !== undefined && attributes.has("form") && attributes.get("form") !== formId) {
      continue;
    }
    const type = (attributes.get("type") ?? "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      checkboxes.push({
        name,
        value: attributes.get("value") ?? "on",
        checked: attributes.has("checked"),
        disabled: attributes.has("disabled"),
      });
      continue;
    }
    fields.set(name, attributes.get("value") ?? "");
  }

  return {
    action: chosen.get("action") ?? "",
    method: (chosen.get("method") ?? "GET").toUpperCase(),
    fields,
    checkboxes,
  };
}

/**
 * The `Origin` a form POST carries, given the page's referrer policy.
 *
 * Derived, never assumed — see this module's header for why. `no-referrer` yields the literal
 * `null`; every other policy yields the page's own origin for a same-origin request.
 *
 * @param pageResponse - The response that rendered the form.
 * @param origin - The page's origin.
 * @returns The `Origin` header value a browser would send.
 */
export function browserOriginFor(
  pageResponse: WireResponse,
  origin: string,
): string {
  const policy = pageResponse.headers.get("referrer-policy")?.toLowerCase() ?? "";
  return policy === "no-referrer" ? "null" : origin;
}

/** A cookie jar and navigation, for one modelled browser session. */
export interface Browser {
  readonly cookies: ReadonlyMap<string, string>;
  /** Seed a cookie the session already holds (e.g. a signed-in application session). */
  setCookie(name: string, value: string): void;
  /** Follow a URL, collecting cookies, stopping at the first off-origin redirect. */
  navigate(url: string, options?: { readonly maxRedirects?: number }): Promise<BrowserNavigation>;
  /** Submit a parsed form with the given values, as a browser would. */
  submitForm(
    form: HtmlForm,
    pageResponse: WireResponse,
    values: readonly (readonly [string, string])[],
  ): Promise<WireResponse>;
}

/**
 * Open a modelled browser session against one deployment.
 *
 * @param target - Canonical origin and loopback port.
 * @returns A session with its own cookie jar.
 */
export function openBrowser(target: EdgeTarget): Browser {
  const jar = new Map<string, string>();
  /** The most recent on-origin response; it is the one that produced an off-origin redirect. */
  let lastResponse: WireResponse | undefined;

  const collect = (response: WireResponse): void => {
    for (const raw of response.setCookies) {
      const [pair] = raw.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      // An expiry in the past is a deletion; modelling it matters because a sign-out or a consumed
      // interaction clears state a later step must not still be carrying.
      if (/;\s*max-age=0\b/i.test(raw) || value === "") jar.delete(name);
      else jar.set(name, value);
    }
  };

  const cookieHeader = (): Record<string, string> =>
    jar.size === 0
      ? {}
      : { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };

  return {
    cookies: jar,
    setCookie(name, value) {
      jar.set(name, value);
    },
    async navigate(url, options = {}) {
      const maxRedirects = options.maxRedirects ?? 10;
      const steps: NavigationStep[] = [];
      let current = url;
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const parsed = new URL(current);
        if (parsed.origin !== target.canonicalOrigin) {
          if (!lastResponse) {
            throw new Error(
              `Navigation started off-origin (${parsed.origin}); the browser models one deployment.`,
            );
          }
          // The redirect TO the client's callback is where a real browser leaves the deployment.
          // The response that emitted it is what a test asserts on, so it is returned unchanged.
          return { response: lastResponse, steps, stoppedAt: current };
        }
        const response = await edgeRequest(target, current, {
          headers: { accept: "text/html,application/xhtml+xml", ...cookieHeader() },
        });
        collect(response);
        lastResponse = response;
        const location = response.headers.get("location");
        steps.push({ url: current, status: response.status, location });
        if (response.status < 300 || response.status >= 400 || !location) {
          return { response, steps, stoppedAt: null };
        }
        current = new URL(location, current).toString();
      }
      throw new Error(`Redirect limit exceeded starting at ${url}`);
    },
    async submitForm(form, pageResponse, values) {
      const body = new URLSearchParams();
      for (const [name, value] of form.fields) body.set(name, value);
      for (const [name, value] of values) body.append(name, value);
      const action = new URL(form.action, target.canonicalOrigin).toString();
      const response = await edgeRequest(target, action, {
        method: form.method,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: browserOriginFor(pageResponse, target.canonicalOrigin),
          referer: action,
          ...cookieHeader(),
        },
        body: body.toString(),
      });
      collect(response);
      return response;
    },
  };
}
