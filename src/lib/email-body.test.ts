import { describe, expect, it } from "vitest";
import { editorHtmlToEmailHtml, emailBodyHtmlToText, emailBodyParts, emailHtmlFor, isEmailBodyEmpty, sanitizeEmailBodyHtml, textToEditorHtml } from "@/lib/email-body";
import { bodyToHtml } from "@/lib/email-signature";
import { buildMimeMessage } from "@/lib/gmail-mime";
import { prepareEmailMessage } from "@/lib/calc/sent-email";

/** The decoded text and HTML parts of a multipart/alternative message. */
function mimeParts(mime: string) {
  const head = mime.slice(0, mime.indexOf("\r\n\r\n"));
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1] ?? "";
  const decode = (type: string) => {
    const chunk = mime.split(`--${boundary}`).find((c) => c.includes(`Content-Type: ${type}`)) ?? "";
    const raw = chunk.replace(/^\r\n/, "");
    return Buffer.from(raw.slice(raw.indexOf("\r\n\r\n") + 4).replace(/\r\n/g, ""), "base64").toString("utf8");
  };
  return { text: decode("text/plain"), html: decode("text/html") };
}

const AI_DRAFT = "Hi Dan,\n\nThanks for the call.\n\n- What you are seeing\n- Anyone I should talk to\n\nWould you have 15 minutes?\n\nThanks,\nBram";

describe("AI text into the editor (bullets become a real list)", () => {
  it("turns '- ' lines into a bulleted list with no leading dash text", () => {
    const html = textToEditorHtml(AI_DRAFT);
    expect(html).toContain("<ul><li><p>What you are seeing</p></li><li><p>Anyone I should talk to</p></li></ul>");
    expect(html).not.toMatch(/<p>- /);
    expect(html.startsWith("<p>Hi Dan,</p><p></p><p>Thanks for the call.</p>")).toBe(true);
  });

  it("turns '1. ' lines into a numbered list (keeping a start number other than 1) and **bold** into bold", () => {
    expect(textToEditorHtml("Steps:\n1. First\n2. Second")).toBe("<p>Steps:</p><ol><li><p>First</p></li><li><p>Second</p></li></ol>");
    expect(textToEditorHtml("3. Third\n4. Fourth")).toContain('<ol start="3">');
    expect(textToEditorHtml("A **key** point")).toBe("<p>A <strong>key</strong> point</p>");
  });

  it("escapes text and treats '* ' and the bullet sign as bullets too", () => {
    expect(textToEditorHtml("<b>x</b> & y")).toBe("<p>&lt;b&gt;x&lt;/b&gt; &amp; y</p>");
    expect(textToEditorHtml("* one\n• two")).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
  });

  it("empty text gives an empty editor", () => {
    expect(textToEditorHtml("  \n ")).toBe("");
    expect(isEmailBodyEmpty("")).toBe(true);
    expect(isEmailBodyEmpty("<p></p><p></p>")).toBe(true);
    expect(isEmailBodyEmpty("<p>x</p>")).toBe(false);
  });
});

describe("editor HTML to plain text (the text part)", () => {
  it("round-trips an AI draft exactly", () => {
    expect(emailBodyHtmlToText(textToEditorHtml(AI_DRAFT))).toBe(AI_DRAFT);
  });

  it("writes bullets as '- ', numbered items as '1. ', nested items indented", () => {
    const html = "<ul><li><p>a</p><ul><li><p>nested</p></li></ul></li><li><p>b</p></li></ul><ol start=\"2\"><li><p>two</p></li><li><p>three</p></li></ol>";
    expect(emailBodyHtmlToText(html)).toBe("- a\n  - nested\n- b\n2. two\n3. three");
  });

  it("drops bold and italic marks and keeps the words", () => {
    expect(emailBodyHtmlToText("<p>A <strong>bold</strong> and <em>italic</em> word</p>")).toBe("A bold and italic word");
  });

  it("writes links as 'text (address)', or just the address when the text is the address", () => {
    expect(emailBodyHtmlToText('<p>See <a href="https://example.com/deck">the deck</a>.</p>')).toBe("See the deck (https://example.com/deck).");
    expect(emailBodyHtmlToText('<p><a href="https://example.com">https://example.com</a></p>')).toBe("https://example.com");
    expect(emailBodyHtmlToText('<p>Write to <a href="mailto:pat@example.com">Pat</a></p>')).toBe("Write to Pat (pat@example.com)");
  });

  it("reads Gmail's own line layout (div per line, <div><br></div> for a blank line)", () => {
    expect(emailBodyHtmlToText("<div>Hi</div><div><br></div><div>Line<br>two</div><div>end</div>")).toBe("Hi\n\nLine\ntwo\nend");
  });

  it("decodes entities and removes blank lines at the end", () => {
    expect(emailBodyHtmlToText("<p>Tom &amp; Jerry&nbsp;&lt;3</p><p></p><p></p>")).toBe("Tom & Jerry <3");
  });
});

describe("editor HTML to email HTML (the HTML part)", () => {
  it("writes one div per line, <div><br></div> for a blank line, and lists with their text directly in <li>", () => {
    const out = editorHtmlToEmailHtml(textToEditorHtml("Hi,\n\n- One\n- Two\n\nBram"));
    expect(out).toBe('<div>Hi,</div><div><br></div><ul style="margin:0;padding-left:24px"><li>One</li><li>Two</li></ul><div><br></div><div>Bram</div>');
  });

  it("keeps bold, italic, links, and numbered lists (with a start number)", () => {
    const out = editorHtmlToEmailHtml('<p><strong>Bold</strong> <em>it</em> <a href="https://x.com">x</a></p><ol start="4"><li><p>four</p></li></ol>');
    expect(out).toContain("<div><strong>Bold</strong> <em>it</em> <a href=\"https://x.com\">x</a></div>");
    expect(out).toContain('<ol style="margin:0;padding-left:24px" start="4"><li>four</li></ol>');
  });

  it("joins two paragraphs in one list item with a line break and removes blank lines at the end", () => {
    expect(editorHtmlToEmailHtml("<ul><li><p>a</p><p>b</p></li></ul><p></p><p></p>")).toBe('<ul style="margin:0;padding-left:24px"><li>a<br>b</li></ul>');
  });

  it("matches the plain text email path for the same message (bullets and numbers)", () => {
    const text = "Hi,\n- One\n1. First";
    expect(bodyToHtml(text)).toBe('Hi,<ul style="margin:0;padding-left:24px"><li>One</li></ul><ol style="margin:0;padding-left:24px"><li>First</li></ol>');
    const html = emailHtmlFor({ body: "", bodyHtml: textToEditorHtml(text) });
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<ol");
  });
});

describe("paste and browser input are cleaned (the signature rules plus lists)", () => {
  it("removes scripts, event handlers, styles blocks, and javascript: links", () => {
    const dirty = '<p onclick="x()">Hi<script>alert(1)</script></p><style>p{}</style><a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)"><iframe src="https://e.com"></iframe>';
    const clean = sanitizeEmailBodyHtml(dirty);
    for (const bad of ["<script", "onclick", "onerror", "javascript:", "<style", "<iframe", "alert("]) expect(clean).not.toContain(bad);
    expect(clean).toContain("<p>Hi</p>");
    expect(clean).toContain("<a>bad</a>");
  });

  it("keeps lists, bold, italic, and safe links from Gmail and Google Docs", () => {
    const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><ul style="margin-top:0"><li dir="ltr" style="list-style-type:disc"><p dir="ltr"><span style="font-weight:700;color:#000000">Bold item</span></p></li></ul></b>';
    const clean = sanitizeEmailBodyHtml(docs);
    expect(clean).toContain("<ul");
    expect(clean).toContain("<li");
    expect(clean).toContain("font-weight: 700");
    expect(clean).not.toContain("meta");
    expect(clean).not.toContain("id=");
    const gmail = '<div dir="ltr">Hi<div><ol start="2"><li>two</li></ol><a href="https://example.com" onmouseover="x">link</a></div></div>';
    expect(sanitizeEmailBodyHtml(gmail)).toBe('<div dir="ltr">Hi<div><ol start="2"><li>two</li></ol><a href="https://example.com">link</a></div></div>');
  });

  it("cleans what is sent even when the browser sends unsafe HTML", () => {
    const html = editorHtmlToEmailHtml('<p>ok</p><script>alert(1)</script><p><a href="javascript:alert(1)">x</a></p>');
    expect(html).not.toContain("script");
    expect(html).not.toContain("javascript:");
  });
});

describe("one message, three uses: confirmation, Send now, Save to Gmail drafts", () => {
  const editorHtml = textToEditorHtml("Hi Morgan,\n\nTwo things:\n- The CIM\n- A call next week\n\nThanks,\nBram");

  it("prepareEmailMessage makes the text from the editor HTML (not from the typed text)", () => {
    const m = prepareEmailMessage(" Subject ", "ignored", editorHtml);
    expect(m.subject).toBe("Subject");
    expect(m.body).toBe("Hi Morgan,\n\nTwo things:\n- The CIM\n- A call next week\n\nThanks,\nBram");
    expect(m.bodyHtml).toContain("<ul>");
  });

  it("without editor HTML the plain text path is used as before", () => {
    const m = prepareEmailMessage("S", "Hi\n- a", "");
    expect(m.bodyHtml).toBeNull();
    expect(m.body).toBe("Hi\n- a");
    expect(emailBodyParts({ body: "plain", bodyHtml: null })).toEqual({ text: "plain", html: null });
  });

  it("the MIME message has <ul><li> in the HTML part and '- ' in the text part, with the signature after", () => {
    const sig = { html: "<b>Bram Frankel</b>", text: "Bram Frankel" };
    const mime = buildMimeMessage({ to: "m@example.com", subject: "Test", body: "", bodyHtml: editorHtml, signature: sig, boundary: "=_bf_alt_test" });
    const { text, html } = mimeParts(mime);
    expect(text).toBe("Hi Morgan,\r\n\r\nTwo things:\r\n- The CIM\r\n- A call next week\r\n\r\nThanks,\r\nBram\r\n\r\n-- \r\nBram Frankel");
    expect(html).toContain('<ul style="margin:0;padding-left:24px"><li>The CIM</li><li>A call next week</li></ul>');
    expect(html).toContain('<div dir="ltr" class="gmail_signature"><b>Bram Frankel</b></div>');
    expect(html).not.toContain("<p>");
    // The confirmation dialog shows the same HTML.
    expect(html).toBe(emailHtmlFor({ body: "", bodyHtml: editorHtml }, sig.html));
  });
});
