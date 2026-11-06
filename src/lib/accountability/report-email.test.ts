import { describe, expect, it } from "vitest";
import { blocksHtml, editedHtml, noteHtml, noteText, reportInnerHtml, reportText, sectionBodyHtml } from "./report-email";
import { buildSections, cleanNotes, sendsNotes, type ReportData } from "./report-sections";

const d: ReportData = {
  partnerName: "Jake Morgan", partnerFirst: "Jake", dateLong: "Tuesday, Nov 3, 2026", dateShort: "Tuesday, Nov 3", withWeek: false,
  pill: { text: "Listings screened missed", status: "missed" },
  today: [{ label: "Listings screened", value: "3", small: "of 5", note: "2 passed", status: "missed", pct: 60 }],
  targets: [{ id: "t1", group: "missed", text: "Listings screened: 3 of 5 today, 8 of 10 this week", commitment: true, asks: true, reason: "Two CIMs came in" }],
  owed: null,
  waits: [{ id: "w1", name: "Summit Logistics Group", days: 11, who: "Mark Reed" }],
  threshold: 5,
  deals: [{ id: "p", name: "Pinecrest Landscaping", stage: "IOI or LOI", position: 8, lastActivity: "2026-11-01", status: "LOI sent; waiting on Dana Whitfield", next: "Follow up with Dana, Nov 4", activity: [] }],
  jobs: [],
  period: "today",
  week: null,
  tomorrow: { label: "Tomorrow", text: "Push Mark for the Summit call & finish <Dalton>." },
};

describe("the report email's formatting", () => {
  it("draws every list as a parent line with simple ul/li children, inline styles only", () => {
    const html = reportInnerHtml(d);
    expect(html).toMatch(/Waiting on brokers 5\+ days<\/div><ul style="[^"]+"><li style="[^"]+"><b>Summit Logistics Group:<\/b> 11 days, Mark Reed<\/li><\/ul>/);
    // Targets: the group, one child per target, the details as a child line under it.
    expect(html).toMatch(/>Missed<\/div><ul [^>]+><li [^>]+>Listings screened: 3 of 5 today, 8 of 10 this week<ul [^>]+><li [^>]+>Commitment. Reason: Two CIMs came in<\/li><\/ul><\/li><\/ul>/);
    // Top 3: the deal, then Stage, Status, Next step.
    expect(html).toContain(">Pinecrest Landscaping</div>");
    expect(html).toMatch(/Stage:<\/span> IOI or LOI<\/li><li [^>]+><span [^>]+>Status:<\/span> LOI sent; waiting on Dana Whitfield<\/li><li [^>]+><span [^>]+>Next step:<\/span> Follow up with Dana, Nov 4/);
    expect(html).not.toMatch(/<style|<script|class=/i);
    expect(html).toContain("Push Mark for the Summit call &amp; finish &lt;Dalton&gt;.");
  });
  it("leaves out a section unticked today and shows a section's edited text as bullets", () => {
    const edited = { ...d, choices: { include: { today: false }, edits: { waiting: "Waiting on brokers\n  - Summit: Mark owes the date\n    - Called twice" } } };
    const html = reportInnerHtml(edited);
    expect(html).not.toContain(">Listings screened</div>");
    expect(html).toMatch(/font-weight:bold;[^"]*">Waiting on brokers<\/div><ul [^>]+><li [^>]+>Summit: Mark owes the date<ul [^>]+><li [^>]+>Called twice<\/li><\/ul><\/li><\/ul>/);
    expect(reportText(edited)).toContain("WAITING ON BROKERS\nWaiting on brokers\n  - Summit: Mark owes the date");
  });
  it("the window and the email draw a section from the same parts", () => {
    const waiting = buildSections(d).find((s) => s.key === "waiting")!;
    expect(reportInnerHtml(d)).toContain(sectionBodyHtml(waiting));
    expect(blocksHtml([{ title: "Top 3 opportunities", items: [] }])).toContain(">Top 3 opportunities</div>");
  });
  it("edited text: plain lines stay paragraphs, bullets nest by indent", () => {
    expect(editedHtml("Just a line")).toMatch(/^<div style="[^"]+">Just a line<\/div>$/);
    const h = editedHtml("- a\n- b\n  - c\n- d");
    expect(h.match(/<li/g)!.length).toBe(4);
    expect(h.match(/<ul/g)!.length).toBe(2);
  });
});

describe("today's notes (+ Note, 2026-11-05)", () => {
  const withNotes: ReportData = { ...d, notes: { top: "Pinecrest is the one to watch.\nDana wants <the> numbers & a call.", tomorrow: "Short day." } };
  it("prints a note under its section with a thin left rule, escaped, line breaks kept, in HTML and plain text", () => {
    const html = reportInnerHtml(withNotes);
    expect(html).toMatch(/Follow up with Dana, Nov 4<\/li><\/ul><\/div><div data-note="1" style="[^"]*border-left:2px solid #d5dbe3[^"]*">Pinecrest is the one to watch.<br>Dana wants &lt;the&gt; numbers &amp; a call.<\/div>/);
    expect(html).toContain(">Short day.</div>");
    const text = reportText(withNotes);
    expect(text).toContain("Next step: Follow up with Dana, Nov 4\n\n| Pinecrest is the one to watch.\n| Dana wants <the> numbers & a call.");
    expect(text).toContain("Push Mark for the Summit call & finish <Dalton>.\n\n| Short day.");
  });
  it("sits under the edited text when the section was rewritten with Edit", () => {
    const html = reportInnerHtml({ ...withNotes, choices: { edits: { top: "- Pinecrest: LOI out" } } });
    expect(html).toMatch(/Pinecrest: LOI out<\/li><\/ul><div data-note="1"[^>]*>Pinecrest is the one to watch./);
  });
  it("a section left out today does not send its note, but the note stays on the section", () => {
    const out = { ...withNotes, choices: { include: { top: false } } };
    expect(reportInnerHtml(out)).not.toContain("Pinecrest is the one to watch.");
    expect(reportText(out)).not.toContain("Pinecrest is the one to watch.");
    expect(buildSections(out).find((s) => s.key === "top")!.note).toContain("Pinecrest is the one to watch.");
    expect(sendsNotes(out)).toBe(true);
    expect(sendsNotes({ ...out, notes: { top: "x" } })).toBe(false);
  });
  it("cleans notes: known sections only, end spaces trimmed, blank notes dropped, cut at 1000", () => {
    expect(cleanNotes({ top: "  a  \r\nb   ", nope: "x", waiting: "   ", review: 3, jobs: "y".repeat(1200) })).toEqual({ top: "a\nb", jobs: "y".repeat(1000) });
    expect(noteHtml("  ")).toBe("");
    expect(noteText("a\n\nb")).toBe("| a\n|\n| b");
  });
});
