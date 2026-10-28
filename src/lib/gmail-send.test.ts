import { describe, expect, it } from "vitest";
import { buildMimeMessage, encodeHeaderValue, gmailRaw, isValidEmail, normalizeLineBreaks } from "@/lib/gmail-mime";
import { canSendFromScopes, GMAIL_SEND_SCOPE, GOOGLE_SCOPES, scopesAfterConnect, sendPermission } from "@/lib/google-scopes";
import { explainGoogleError } from "@/lib/google-errors";
import { outreachPurpose, prepareOutreachEmail, sentEmailCommunication, sentSummary } from "@/lib/calc/sent-email";

/** Decodes RFC 2047 encoded words back to text (for checking). */
function decodeWords(v: string): string {
  return v
    .split(/\r\n /)
    .map((w) => {
      const m = w.match(/^=\?UTF-8\?B\?(.*)\?=$/);
      return m ? Buffer.from(m[1], "base64").toString("utf8") : w;
    })
    .join("");
}

/** The top headers and the decoded text/plain part of a multipart/alternative message. */
function parts(mime: string) {
  const [head] = mime.split("\r\n\r\n");
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1] ?? "";
  const textPart = mime.split(`--${boundary}`).find((p) => p.includes("Content-Type: text/plain")) ?? "";
  const [partHead, ...rest] = textPart.replace(/^\r\n/, "").split("\r\n\r\n");
  const encoded = rest.join("\r\n\r\n").replace(/\r\n$/, "");
  return { head, partHead, encoded, body: Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

describe("MIME building", () => {
  it("keeps a plain ASCII subject readable", () => {
    expect(encodeHeaderValue("Checking in")).toBe("Checking in");
  });

  it("encodes a UTF-8 subject as encoded words that decode back exactly", () => {
    const subject = "Café meeting: naïve résumé ✓ 日本語のテキスト and a long tail to force more than one encoded word";
    const enc = encodeHeaderValue(subject);
    expect(enc.startsWith("=?UTF-8?B?")).toBe(true);
    for (const w of enc.split("\r\n ")) expect(w.length).toBeLessThanOrEqual(75);
    expect(decodeWords(enc)).toBe(subject);
  });

  it("never cuts a multi-byte character or emoji in half", () => {
    const subject = "😀".repeat(30);
    expect(decodeWords(encodeHeaderValue(subject))).toBe(subject);
  });

  it("removes line breaks from headers (no header injection)", () => {
    const mime = buildMimeMessage({ to: "a@example.com", subject: "Hi\r\nBcc: evil@example.com", body: "x" });
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toContain("Subject: Hi Bcc: evil@example.com");
  });

  it("keeps line breaks in the body as CRLF, base64 in 76-character lines", () => {
    const body = "Hi Quinn,\n\nLine one\n- bullet\r\nLast line é";
    const mime = buildMimeMessage({ to: "quinn@example.com", subject: "Test", body });
    const { head, partHead, encoded, body: decoded } = parts(mime);
    expect(head).toContain("Content-Type: multipart/alternative");
    expect(partHead).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(partHead).toContain("Content-Transfer-Encoding: base64");
    expect(head).toContain("To: quinn@example.com");
    expect(head).toContain("MIME-Version: 1.0");
    expect(decoded).toBe("Hi Quinn,\r\n\r\nLine one\r\n- bullet\r\nLast line é");
    for (const line of encoded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("normalizes every kind of line break", () => {
    expect(normalizeLineBreaks("a\nb\rc\r\nd")).toBe("a\r\nb\r\nc\r\nd");
  });

  it("adds reply headers only when replying", () => {
    expect(buildMimeMessage({ to: "a@example.com", subject: "s", body: "b" })).not.toContain("In-Reply-To");
    const reply = buildMimeMessage({ to: "a@example.com", subject: "s", body: "b", inReplyTo: "<abc@mail.gmail.com>" });
    expect(reply).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(reply).toContain("References: <abc@mail.gmail.com>");
  });

  it("refuses an invalid To address for sending, but drafts may keep it", () => {
    expect(() => buildMimeMessage({ to: "not an email", subject: "s", body: "b" })).toThrow(/not a valid email/);
    expect(() => buildMimeMessage({ to: "not an email", subject: "s", body: "b" }, { requireValidTo: false })).not.toThrow();
    expect(isValidEmail("bram@cyanarc.com")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("returns base64url for the Gmail raw field", () => {
    const raw = gmailRaw({ to: "a@example.com", subject: "s", body: "b" });
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, "base64url").toString("utf8")).toContain("To: a@example.com");
  });
});

describe("scope detection", () => {
  it("asks for gmail.send and keeps the existing scopes", () => {
    expect(GOOGLE_SCOPES).toContain(GMAIL_SEND_SCOPE);
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/calendar.readonly");
  });

  it("allows sending only when gmail.send (or full Gmail) is saved", () => {
    expect(canSendFromScopes(null)).toBe(false);
    expect(canSendFromScopes("")).toBe(false);
    expect(canSendFromScopes("openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events")).toBe(false);
    expect(canSendFromScopes(`openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/calendar.events`)).toBe(true);
    expect(canSendFromScopes("https://mail.google.com/")).toBe(true);
    expect(canSendFromScopes("https://www.googleapis.com/auth/gmail.sendx")).toBe(false);
  });

  it("treats the existing connection (no gmail.send) as needing a reconnect", () => {
    const enc = "iv.tag.data";
    expect(sendPermission(null)).toBe("not_connected");
    expect(sendPermission({ status: "disconnected", refresh_token_enc: enc, scopes: GMAIL_SEND_SCOPE })).toBe("not_connected");
    expect(sendPermission({ status: "connected", refresh_token_enc: null, scopes: GMAIL_SEND_SCOPE })).toBe("not_connected");
    expect(sendPermission({ status: "connected", refresh_token_enc: enc, scopes: null })).toBe("reconnect");
    expect(sendPermission({ status: "connected", refresh_token_enc: enc, scopes: "openid email https://www.googleapis.com/auth/gmail.compose" })).toBe("reconnect");
    expect(sendPermission({ status: "connected", refresh_token_enc: enc, scopes: `email ${GMAIL_SEND_SCOPE}` })).toBe("allowed");
  });

  it("saves exactly what Google granted on reconnect", () => {
    expect(scopesAfterConnect(`openid ${GMAIL_SEND_SCOPE}`, "openid gmail.compose")).toBe(`openid ${GMAIL_SEND_SCOPE}`);
    expect(scopesAfterConnect("openid email", `openid ${GMAIL_SEND_SCOPE}`)).toBe("openid email");
    expect(scopesAfterConnect(null, "openid email")).toBe("openid email");
    expect(scopesAfterConnect(null, null)).toBeNull();
  });
});

describe("Google errors in plain English", () => {
  it("explains common errors", () => {
    expect(explainGoogleError({ response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } }).kind).toBe("reconnect");
    const scope = explainGoogleError({ response: { status: 403, data: { error: { message: "Request had insufficient authentication scopes." } } } });
    expect(scope.kind).toBe("no_permission");
    expect(scope.googleText).toBe("Request had insufficient authentication scopes.");
    expect(explainGoogleError({ response: { status: 400, data: { error: { message: "Invalid To header" } } } }).kind).toBe("bad_address");
    expect(explainGoogleError({ response: { status: 429, data: { error: { message: "User-rate limit exceeded" } } } }).kind).toBe("limit");
    expect(explainGoogleError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND gmail.googleapis.com" }).kind).toBe("network");
    expect(explainGoogleError({ response: { status: 503, data: {} } }).kind).toBe("google_down");
    expect(explainGoogleError(new Error("odd")).message).toBe("Gmail did not send the email.");
  });

  it("never uses an em dash", () => {
    for (const e of [{ response: { status: 401 } }, { response: { status: 429 } }, { code: "ENOTFOUND" }, {}]) expect(explainGoogleError(e).message).not.toMatch(/[–—]/);
  });
});

describe("communication saved after a send", () => {
  const base = { ownerId: "o1", to: "quinn@example.com", subject: "A quick ask", body: "Hi Quinn,\n\nDoes anyone come to mind?", sentAt: "2026-10-26T15:00:00.000Z" };

  it("uses the Log outreach purpose rule", () => {
    expect(outreachPurpose({ is_consulting_lead: true, is_deal_source: true })).toBe("consulting");
    expect(outreachPurpose({ is_deal_source: true })).toBe("deal_sourcing");
    expect(outreachPurpose({})).toBe("general");
    expect(outreachPurpose(null)).toBe("general");
    expect(outreachPurpose({ is_deal_source: true }, "general")).toBe("general");
    expect(outreachPurpose({ is_deal_source: true }, "nonsense")).toBe("deal_sourcing");
  });

  it("saves outreach as an outgoing email that counts as outreach, linked to the contact", () => {
    const row = sentEmailCommunication({ ...base, kind: "outreach", contact: { id: "c1", organization_id: "org1", is_deal_source: true }, pipelineItemId: "p1" });
    expect(row).toMatchObject({
      owner_id: "o1",
      occurred_at: base.sentAt,
      method: "email",
      direction: "outgoing",
      contact_id: "c1",
      organization_id: "org1",
      subject: "A quick ask",
      is_outreach: true,
      purpose: "deal_sourcing",
      pipeline_item_id: "p1",
      outcome: null,
    });
    expect(String(row.summary)).toBe("Sent from the app to quinn@example.com. Hi Quinn, Does anyone come to mind?");
  });

  it("consulting leads get the consulting purpose", () => {
    expect(sentEmailCommunication({ ...base, kind: "outreach", contact: { id: "c2", is_consulting_lead: true } }).purpose).toBe("consulting");
  });

  it("partner report emails are not outreach", () => {
    const row = sentEmailCommunication({ ...base, kind: "partner_report", contact: { id: "c3", is_deal_source: true } });
    expect(row.is_outreach).toBe(false);
    expect(row.purpose).toBe("general");
    expect(row.contact_id).toBe("c3");
  });

  it("keeps the summary short", () => {
    const s = sentSummary("a@example.com", "word ".repeat(200));
    expect(s.length).toBeLessThan(300);
    expect(s.endsWith("...")).toBe(true);
  });

  it("prepares the text the same way as the Gmail draft (no em dashes, plain text)", () => {
    const p = prepareOutreachEmail("  Quick ask — deals  ", "Hi,\n\n**Bold** line — more\n- item");
    expect(p.subject).not.toMatch(/—/);
    expect(p.body).not.toContain("**");
    expect(p.body).toContain("\n");
  });
});
