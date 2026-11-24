import { describe, expect, it } from "vitest";
import { boxHtml, openingBodyHtml } from "@/lib/accountability/report-email";
import { editorHtmlToOpening, openingInlineHtml, openingLines, openingPlain, openingToEditorHtml, wordCount } from "@/lib/accountability/opening-format";

const SAVED = ["**Today was mostly seller calls on three deals:**", "- **Seller and broker calls:** worked through open questions with the Moody Law seller.", "- **Sourcing and screening:** Assura & Catalyst went to CIM."].join("\n");

describe("the opening with bold and bullets (2026-11-23)", () => {
  it("reads lines and bullets; a bold heading is never taken for a '* ' bullet", () => {
    expect(openingLines(SAVED)).toEqual([
      { bullet: false, text: "**Today was mostly seller calls on three deals:**" },
      { bullet: true, text: "**Seller and broker calls:** worked through open questions with the Moody Law seller." },
      { bullet: true, text: "**Sourcing and screening:** Assura & Catalyst went to CIM." },
    ]);
    expect(openingLines("One line.\n\nTwo lines.")).toEqual([
      { bullet: false, text: "One line." },
      { bullet: false, text: "Two lines." },
    ]);
  });

  it("draws bold and escapes everything else", () => {
    expect(openingInlineHtml("**Calls:** A & B <x>")).toBe("<b>Calls:</b> A &amp; B &lt;x&gt;");
    expect(openingInlineHtml("plain")).toBe("plain");
    // A "**" with no partner is left out, never shown.
    expect(openingInlineHtml("**open only")).toBe("open only");
  });

  it("gives the words with no marks", () => {
    expect(openingPlain(SAVED)).toBe("Today was mostly seller calls on three deals:\n- Seller and broker calls: worked through open questions with the Moody Law seller.\n- Sourcing and screening: Assura & Catalyst went to CIM.");
  });

  it("goes to the editor and back unchanged", () => {
    const html = openingToEditorHtml(SAVED);
    expect(html).toBe("<p><strong>Today was mostly seller calls on three deals:</strong></p><ul><li><p><strong>Seller and broker calls:</strong> worked through open questions with the Moody Law seller.</p></li><li><p><strong>Sourcing and screening:</strong> Assura &amp; Catalyst went to CIM.</p></li></ul>");
    expect(editorHtmlToOpening(html)).toBe(SAVED);
    expect(editorHtmlToOpening(openingToEditorHtml("An old opening.\nSecond line."))).toBe("An old opening.\nSecond line.");
    expect(editorHtmlToOpening("")).toBe("");
    expect(editorHtmlToOpening("<p></p>")).toBe("");
  });

  it("keeps only bold and bullets from the editor", () => {
    expect(editorHtmlToOpening('<p>See <em>the</em> <a href="https://x.com">link</a></p><ol><li><p>one</p></li></ol>')).toBe("See the link\n- one");
    // Bold that runs over two lines is closed on each line.
    expect(editorHtmlToOpening("<p><strong>first<br>second</strong> rest</p>")).toBe("**first**\n**second** rest");
    // Spaces inside the bold marks move outside them.
    expect(editorHtmlToOpening("<p><strong>Calls: </strong>done</p>")).toBe("**Calls:** done");
    // Typed stars never become marks.
    expect(editorHtmlToOpening("<p>a ** b</p>")).toBe("a b");
  });

  it("draws the opening in the report as the layout H mockup: a bold heading per kind of work, its bullets under it in the quiet color", () => {
    const text = "**Deal diligence across three active opportunities**\n- Reviewed financials & built models\n- Drafted deal terms\n**Networking and outreach**\n- Connected with a new broker";
    const html = openingBodyHtml(text, true, 14);
    expect(html.match(/data-opening-heading="1"/g)?.length).toBe(2);
    expect(html).toMatch(/font-weight:600;">Deal diligence across three active opportunities<\/div><ul style="[^"]*color:#635d58">/);
    expect(html.match(/<li /g)?.length).toBe(3);
    expect(html).toContain("Reviewed financials &amp; built models");
    expect(html).not.toContain("**");
    // The editor gives the same text back.
    expect(editorHtmlToOpening(openingToEditorHtml(text))).toBe(text);
    // An opening written as sentences (before this release) reads as plain text.
    const old = openingBodyHtml("A deal day: an hour on the Moody structure.\nSecond line.", true, 14);
    expect(old).not.toContain("<ul");
    expect(old).not.toContain("font-weight");
    // A plain line right above bullets is a heading too; bold inside a bullet still shows.
    expect(openingBodyHtml("Deals\n- **Moody:** one\n- two")).toMatch(/font-weight:bold;">Deals<\/div><ul[^>]*><li[^>]*><b>Moody:<\/b> one/);
  });

  it("gives the six day counts equal columns that fit one row (2026-11-23)", () => {
    const html = boxHtml(["Listings reviewed", "Deals added", "Deals moved", "Brokers contacted", "Calls and meetings", "Network outreach"].map((label, value) => ({ label, value })));
    const widths = [...html.matchAll(/display:inline-block;width:([\d.]+)%;min-width:96px/g)].map((m) => Number(m[1]));
    expect(widths.length).toBe(6);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
  });

  it("counts words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("B2B ad network · seller retiring · fits my ops background")).toBe(9);
  });
});
