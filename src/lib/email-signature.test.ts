import { describe, expect, it } from "vitest";
import { bodyToHtml, emailHtml, emailText, sanitizeSignatureHtml, sanitizeStyle, signatureHasOwnSeparator, signatureHtmlToText, signatureOn } from "@/lib/email-signature";
import { buildMimeMessage, gmailRaw } from "@/lib/gmail-mime";
import {
  canReadSignatureFromScopes,
  connectResult,
  GMAIL_SEND_SCOPE,
  GMAIL_SETTINGS_SCOPE,
  GOOGLE_SCOPES,
  reconnectMessage,
  sendPermission,
  signaturePermission,
} from "@/lib/google-scopes";

const BASE = "openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";
const ENC = "iv.tag.data";

describe("scope detection: Gmail signature (gmail.settings.basic)", () => {
  it("asks for the settings scope next to the existing ones", () => {
    expect(GMAIL_SETTINGS_SCOPE).toBe("https://www.googleapis.com/auth/gmail.settings.basic");
    expect(GOOGLE_SCOPES).toContain(GMAIL_SETTINGS_SCOPE);
    expect(GOOGLE_SCOPES).toContain(GMAIL_SEND_SCOPE);
  });

  it("without the settings scope: Reconnect for the signature, sending still allowed", () => {
    const conn = { status: "connected", refresh_token_enc: ENC, scopes: `${BASE} ${GMAIL_SEND_SCOPE}` };
    expect(canReadSignatureFromScopes(conn.scopes)).toBe(false);
    expect(signaturePermission(conn)).toBe("reconnect");
    expect(sendPermission(conn)).toBe("allowed");
    expect(reconnectMessage(sendPermission(conn), signaturePermission(conn))).toBe("Reconnect Google to use your Gmail signature (1 minute).");
    expect(connectResult(conn.scopes)).toBe("connected_no_signature");
  });

  it("with the settings scope: allowed, no Reconnect message", () => {
    const conn = { status: "connected", refresh_token_enc: ENC, scopes: `${BASE} ${GMAIL_SEND_SCOPE} ${GMAIL_SETTINGS_SCOPE}` };
    expect(signaturePermission(conn)).toBe("allowed");
    expect(reconnectMessage(sendPermission(conn), signaturePermission(conn))).toBeNull();
    expect(connectResult(conn.scopes)).toBe("connected");
    expect(canReadSignatureFromScopes("https://mail.google.com/")).toBe(true);
    expect(canReadSignatureFromScopes(`${GMAIL_SETTINGS_SCOPE}.x`)).toBe(false);
  });

  it("missing both: one message, the sending one (one Reconnect covers both)", () => {
    const conn = { status: "connected", refresh_token_enc: ENC, scopes: BASE };
    expect(reconnectMessage(sendPermission(conn), signaturePermission(conn))).toBe("Reconnect Google to allow sending from the app (1 minute).");
    expect(connectResult(BASE)).toBe("connected_no_send");
  });

  it("not connected: no Reconnect message", () => {
    expect(signaturePermission(null)).toBe("not_connected");
    expect(signaturePermission({ status: "disconnected", refresh_token_enc: ENC, scopes: GMAIL_SETTINGS_SCOPE })).toBe("not_connected");
    expect(reconnectMessage("not_connected", "not_connected")).toBeNull();
  });
});

const GMAIL_SIG =
  '<div dir="ltr"><div><b>Bram Frankel</b></div><div><font color="#666666">Cyan Arc LLC</font></div>' +
  '<div><a href="tel:+14045550123">(404) 555-0123</a> | <a href="https://cyanarc.com" target="_blank">cyanarc.com</a></div>' +
  '<div><img src="https://ci3.googleusercontent.com/mail-sig/logo.png" width="120" height="40" alt="Cyan Arc logo"></div></div>';

describe("signature sanitizer", () => {
  it("removes scripts, event handlers, and javascript: links", () => {
    const dirty =
      '<div onclick="steal()">Hi<script>alert(1)</script></div>' +
      '<img src="https://example.com/a.png" onerror="alert(2)">' +
      '<a href="javascript:alert(3)">bad</a><a href="  JaVa&#x53;cript:alert(4)">bad2</a>' +
      '<a href="java\tscript:alert(5)">bad3</a><span style="background:url(javascript:alert(6));color:red">x</span>' +
      "<iframe src=\"https://evil.example\"></iframe><style>body{display:none}</style><svg onload=alert(7)><circle/></svg>" +
      '<img src="http://insecure.example/a.png"><img src="data:image/png;base64,AAAA"><!-- note --><form><input name=x></form>';
    const out = sanitizeSignatureHtml(dirty);
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/onclick|onerror|onload/i);
    expect(out).not.toMatch(/iframe|<style|<svg|<form|<input|<!--/i);
    expect(out).not.toMatch(/url\(/i);
    expect(out).not.toContain("http://insecure");
    expect(out).not.toContain("data:image");
    expect(out).toContain('<img src="https://example.com/a.png">');
    expect(out).toContain("<a>bad</a>");
    expect(out).toContain('<span style="color: red">x</span>');
    expect(out).toContain("<div>Hi</div>");
  });

  it("keeps links, https images, and basic formatting", () => {
    const out = sanitizeSignatureHtml(GMAIL_SIG);
    expect(out).toContain("<b>Bram Frankel</b>");
    expect(out).toContain('<font color="#666666">Cyan Arc LLC</font>');
    expect(out).toContain('<a href="tel:+14045550123">(404) 555-0123</a>');
    expect(out).toContain('<a href="https://cyanarc.com" target="_blank" rel="noopener noreferrer">cyanarc.com</a>');
    expect(out).toContain('<img src="https://ci3.googleusercontent.com/mail-sig/logo.png" width="120" height="40" alt="Cyan Arc logo">');
    expect(out).toContain('<div dir="ltr">');
  });

  it("keeps simple tables and safe inline styles only", () => {
    const out = sanitizeSignatureHtml('<table cellpadding="0" class="x" onmouseover="y"><tbody><tr><td style="padding:0 8px;font-family:Arial, sans-serif;position:fixed;color:rgb(10,20,30)">A</td></tr></tbody></table>');
    expect(out).toBe('<table cellpadding="0"><tbody><tr><td style="padding: 0 8px; font-family: Arial, sans-serif; color: rgb(10,20,30)">A</td></tr></tbody></table>');
    expect(sanitizeStyle("color: expression(alert(1)); font-size: 12px")).toBe("font-size: 12px");
  });

  it("unwraps unknown tags, closes open tags, drops stray closing tags, escapes stray brackets", () => {
    expect(sanitizeSignatureHtml("<section><h1>Name</h1></section>")).toBe("Name");
    expect(sanitizeSignatureHtml("<b>open <i>both")).toBe("<b>open <i>both</i></b>");
    expect(sanitizeSignatureHtml("text</div></b>")).toBe("text");
    expect(sanitizeSignatureHtml("1 < 2 & 3 > 2 &copy; 2026")).toBe("1 &lt; 2 &amp; 3 &gt; 2 &copy; 2026");
    expect(sanitizeSignatureHtml('<a href="mailto:bram@cyanarc.com" title="x&quot;onmouseover=&quot;y">Email</a>')).toBe('<a href="mailto:bram@cyanarc.com" title="x&quot;onmouseover=&quot;y">Email</a>');
  });
});

describe("plain text version of a signature", () => {
  it("keeps one line per row and the phone number and website text; leaves images out", () => {
    expect(signatureHtmlToText(GMAIL_SIG)).toBe("Bram Frankel\nCyan Arc LLC\n(404) 555-0123 | cyanarc.com");
  });

  it("shows a link address next to its text when they differ", () => {
    expect(signatureHtmlToText('Book a call: <a href="https://cal.example.com/bram">my calendar</a>')).toBe("Book a call: my calendar <https://cal.example.com/bram>");
    expect(signatureHtmlToText('<a href="mailto:bram@cyanarc.com">Email me</a>')).toBe("Email me");
  });

  it("turns breaks, paragraphs, and table cells into lines and spaces; decodes entities", () => {
    expect(signatureHtmlToText("<p>A&amp;B</p><p>Line&nbsp;two<br>three</p><table><tr><td>x</td><td>y</td></tr></table>")).toBe("A&B\n\nLine two\nthree\n\nx y");
  });
});

describe("message as HTML", () => {
  it("escapes text, keeps line breaks, and makes a list of '- ' lines", () => {
    const html = bodyToHtml("Hi <Pat> & co,\n\nWhat I need:\n- One\n- Two\n\nThanks,\nBram");
    expect(html).toBe("Hi &lt;Pat&gt; &amp; co,<br><br>What I need:" + '<ul style="margin:0;padding-left:24px"><li>One</li><li>Two</li></ul>' + "<br>Thanks,<br>Bram");
  });

  it("puts the signature below the message with Gmail's spacing, only when there is one", () => {
    const withSig = emailHtml("Hi", "<b>Bram</b>");
    expect(withSig).toBe('<div dir="ltr">Hi<br clear="all"><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature"><b>Bram</b></div></div>');
    expect(emailHtml("Hi", null)).toBe('<div dir="ltr">Hi</div>');
    expect(emailText("Hi\n\nBram\n", "Bram Frankel\nCyan Arc")).toBe("Hi\n\nBram\n\n-- \nBram Frankel\nCyan Arc");
    expect(emailText("Hi", "")).toBe("Hi");
  });

  it("the setting is on by default once a signature exists", () => {
    expect(signatureOn(null, "<b>x</b>")).toBe(true);
    expect(signatureOn(true, "<b>x</b>")).toBe(true);
    expect(signatureOn(false, "<b>x</b>")).toBe(false);
    expect(signatureOn(null, "")).toBe(false);
  });
});

/** Splits a multipart/alternative message into its top headers and decoded parts. */
function parseMultipart(mime: string) {
  const headEnd = mime.indexOf("\r\n\r\n");
  const head = mime.slice(0, headEnd);
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1] ?? "";
  const rest = mime.slice(headEnd + 4);
  const chunks = rest.split(`--${boundary}`);
  const parts = chunks
    .slice(1, -1)
    .map((c) => {
      const raw = c.replace(/^\r\n/, "");
      const i = raw.indexOf("\r\n\r\n");
      const encoded = raw.slice(i + 4).replace(/\r\n$/, "");
      return { head: raw.slice(0, i), encoded, content: Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8") };
    });
  return { head, boundary, parts, closing: chunks[chunks.length - 1], rest };
}

describe("multipart MIME (text and HTML parts)", () => {
  const sig = { html: sanitizeSignatureHtml(GMAIL_SIG), text: signatureHtmlToText(GMAIL_SIG) };
  const msg = { to: "pat@example.com", subject: "Café ✓", body: "Hi Pat,\n\nNaïve question:\n- One\n\nBram", signature: sig, boundary: "=_bf_alt_test" };

  it("has both parts, UTF-8 base64, and correct boundaries", () => {
    const mime = buildMimeMessage(msg);
    const { head, boundary, parts, closing, rest } = parseMultipart(mime);
    expect(head).toContain('Content-Type: multipart/alternative; boundary="=_bf_alt_test"');
    expect(head).toContain("MIME-Version: 1.0");
    expect(head).toContain("Subject: =?UTF-8?B?");
    expect(boundary).toBe("=_bf_alt_test");
    expect(parts).toHaveLength(2);
    expect(parts[0].head).toBe("Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64");
    expect(parts[1].head).toBe("Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64");
    expect(rest.startsWith("--=_bf_alt_test\r\n")).toBe(true);
    expect(mime.endsWith("\r\n--=_bf_alt_test--\r\n")).toBe(true);
    expect(closing).toBe("--\r\n");
    for (const p of parts) for (const line of p.encoded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    // The boundary never appears inside a part.
    for (const p of parts) expect(p.encoded).not.toContain("=_bf_alt_test");
  });

  it("puts the signature in each part", () => {
    const [text, html] = parseMultipart(buildMimeMessage(msg)).parts.map((p) => p.content);
    expect(text).toBe("Hi Pat,\r\n\r\nNaïve question:\r\n- One\r\n\r\nBram\r\n\r\n-- \r\nBram Frankel\r\nCyan Arc LLC\r\n(404) 555-0123 | cyanarc.com");
    expect(html).toContain("Naïve question:");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain('<div dir="ltr" class="gmail_signature">');
    expect(html).toContain('<a href="tel:+14045550123">(404) 555-0123</a>');
    expect(html).toContain('src="https://ci3.googleusercontent.com/mail-sig/logo.png"');
  });

  it("without a signature: still both parts, no signature in either", () => {
    const [text, html] = parseMultipart(buildMimeMessage({ ...msg, signature: null })).parts.map((p) => p.content);
    expect(text).toBe("Hi Pat,\r\n\r\nNaïve question:\r\n- One\r\n\r\nBram");
    expect(html).not.toContain("gmail_signature");
    expect(text).not.toContain("-- ");
  });

  it("uses a new random boundary each time and keeps raw base64url", () => {
    const a = parseMultipart(buildMimeMessage({ ...msg, boundary: undefined })).boundary;
    const b = parseMultipart(buildMimeMessage({ ...msg, boundary: undefined })).boundary;
    expect(a).toMatch(/^=_bf_alt_[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
    expect(gmailRaw(msg)).not.toMatch(/[+/=]/);
  });
});

describe("signature with its own separator line", () => {
  const gmailSig = '<div dir="ltr"><div>--</div><div>Cyan Arc LLC</div><div>m/+1.404.403.5909</div></div>';
  it("detects a leading -- line in HTML and text", () => {
    expect(signatureHasOwnSeparator(gmailSig)).toBe(true);
    expect(signatureHasOwnSeparator("-- \nCyan Arc LLC")).toBe(true);
    expect(signatureHasOwnSeparator("<div>&ndash;&ndash;</div><div>Name</div>")).toBe(true);
    expect(signatureHasOwnSeparator("<div>Cyan Arc LLC</div>")).toBe(false);
    expect(signatureHasOwnSeparator("--Name")).toBe(false);
  });
  it("adds only one -- line in both parts", () => {
    const html = emailHtml("Hello", gmailSig);
    expect(html).not.toContain("gmail_signature_prefix");
    expect((html.match(/--/g) ?? []).length).toBe(1);
    const text = emailText("Hello", "--\nCyan Arc LLC");
    expect((text.match(/--/g) ?? []).length).toBe(1);
  });
  it("still adds the separator when the signature has none", () => {
    expect(emailHtml("Hello", "<div>Cyan Arc LLC</div>")).toContain("gmail_signature_prefix");
    expect(emailText("Hello", "Cyan Arc LLC")).toContain("\n-- \n");
  });
});
