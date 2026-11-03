import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DealRow } from "./data";
import { answerPrompt, contextLabel, fieldPrompt, nextActionPrompt, nextStepsPrompt, tasksPrompt, trimContext, type PageContext } from "./ask-ai";
import { dealFactLines, dealFactsFromRow, dealFactsOf, LISTING_TEXT_AI_MAX, listingTextBlock, listingTextForAi, moneyExact, NO_FALSE_GAPS_RULE } from "./deal-facts";
import { listingPrompt, listingTextToSave, LISTING_TEXT_MAX } from "./listing-text";
import { emptyQuestions, questionsPrompt, todosPrompt } from "./questions";

/** The listing Bram pasted (2026-11-02): a physician coaching company, asking $10,000,000, cash flow $2,534,975. */
const FIXTURE = readFileSync(path.resolve(import.meta.dirname, "../../../dev-tools/fixtures/listing-physician-coaching.txt"), "utf8");
const SENTENCE = "ownership’s share of coaching sessions dropped from 19% in 2025 to just 5% in 2026";

/** A listing as the deal page loads it: the money figures in deal_financials, the facts on the row. */
const listing: DealRow = {
  id: "00000000-0000-0000-0000-0000000000aa",
  name: "00 Physician Coaching Company",
  listingName: "00 Physician Coaching Company",
  companyName: null,
  screened: false,
  status: "open",
  stageId: null,
  stageName: null,
  stageIndex: -1,
  nextStage: null,
  dayInStage: 0,
  whatItDoes: "One-on-one burnout coaching for physicians, NPs, and PAs",
  location: "Remote",
  industry: "Healthcare coaching",
  brokerName: "Website Closers",
  source: "Broker newsletter",
  listingUrl: "https://www.websiteclosers.com/businesses/physician-coaching",
  whySelling: null,
  yearEstablished: 2010,
  employees: "20+ associate coaches",
  keyFinding: null,
  strengths: [],
  risks: [],
  growthPaths: [],
  financing: "equity",
  openQuestions: { seller: ["How many clients renew the extension?"], broker: [], self: [] },
  topTodo: null,
  nextAction: null,
  nextActionDue: null,
  nextActionMinutes: null,
  actionIsDefault: false,
  waitingOn: null,
  waitingSince: null,
  waitDays: 0,
  waitLevel: "none",
  passReason: null,
  passReasonLabel: null,
  contactId: null,
  contactName: null,
  contactEmail: null,
  revenue: 3_400_000,
  ebitda: null,
  sde: 2_534_975,
  askingPrice: 10_000_000,
  earnings: 2_534_975,
  earningsLabel: "SDE",
  askingMultiple: "3.9x",
  createdAt: "2026-11-02T14:00:00Z",
  stageEnteredAt: null,
};

/** The deal context the Ask AI panel builds (src/lib/work/ask-ai-context.ts, case "deal"), minus the database reads. */
function dealPageContext(d: DealRow, text: string | null, extra: string[] = []): PageContext {
  return trimContext({ title: `Listing: ${d.name}`, lines: [`deal: ${d.name} | stage none (day 0) | next action: none (due none)`, ...dealFactLines(dealFactsOf(d, text)), ...extra], deal: true, listingText: text });
}

describe("the facts every AI action on a deal or a listing reads (Fix 2026-11-02)", () => {
  it("gives every fact as one line: money as exact figures, the asking price with its multiple, source, link, year, employees", () => {
    const lines = dealFactLines(dealFactsOf(listing, FIXTURE));
    expect(lines).toContain("name: 00 Physician Coaching Company");
    expect(lines).toContain("company name: not known yet");
    expect(lines).toContain("stage: listing (not screened yet)");
    expect(lines).toContain("what it does: One-on-one burnout coaching for physicians, NPs, and PAs");
    expect(lines).toContain("revenue: $3,400,000");
    expect(lines).toContain("SDE: $2,534,975");
    expect(lines).toContain("asking price: $10,000,000 (3.9x SDE)");
    expect(lines).toContain("location: Remote");
    expect(lines).toContain("industry: Healthcare coaching");
    expect(lines).toContain("source: Broker newsletter");
    expect(lines).toContain("broker: Website Closers");
    expect(lines).toContain("year established: 2010");
    expect(lines).toContain("employees: 20+ associate coaches");
    expect(lines).toContain("link: https://www.websiteclosers.com/businesses/physician-coaching");
    expect(lines).toContain("question (Ask the seller): How many clients renew the extension?");
    // Unknown facts are left out, never written as "not set" for the AI to call missing.
    expect(lines.some((l) => l.startsWith("EBITDA:") || l.startsWith("why selling:") || l.startsWith("key finding:"))).toBe(false);
  });

  it("names a deal's company and listing, its stage, key finding, and EBITDA multiple", () => {
    const lines = dealFactLines(dealFactsOf({ ...listing, name: "Dalton Services", companyName: "Dalton Services", listingName: "00 HVAC Contractor", screened: true, stageName: "CIM review", ebitda: 1_700_000, sde: null, askingPrice: 6_000_000, keyFinding: "70% recurring", whySelling: "Retiring" }, null));
    expect(lines).toContain("listed as: 00 HVAC Contractor");
    expect(lines).toContain("stage: CIM review");
    expect(lines).toContain("asking price: $6,000,000 (3.5x EBITDA)");
    expect(lines).toContain("key finding: 70% recurring");
    expect(lines).toContain("why selling: Retiring");
  });

  it("the deal context for a deal with financials carries the money figures and the listing text", () => {
    const c = dealPageContext(listing, FIXTURE);
    expect(c.deal).toBe(true);
    expect(c.lines).toContain("revenue: $3,400,000");
    expect(c.lines).toContain("asking price: $10,000,000 (3.9x SDE)");
    const block = listingTextBlock(c.listingText);
    expect(block).toContain(SENTENCE);
    expect(block).toContain("Year Established\n2010");
  });

  it("keeps the listing text's paragraphs and cuts it at about 8,000 characters", () => {
    expect(listingTextForAi(FIXTURE)).toContain("Business Model\n\nThe business delivers");
    expect(listingTextForAi("a\r\n\r\n\r\n\r\nb  \nc")).toBe("a\n\nb\nc");
    expect(listingTextForAi("   ")).toBeNull();
    const long = Array.from({ length: 6 }, () => FIXTURE).join("\n\n");
    const cut = listingTextForAi(long)!;
    expect(cut.length).toBeLessThanOrEqual(LISTING_TEXT_AI_MAX + 6);
    expect(cut.length).toBeGreaterThan(LISTING_TEXT_AI_MAX * 0.85);
    expect(cut.endsWith("\n[...]")).toBe(true);
    expect(listingTextBlock(null)).toBe("Original listing text: none saved.");
  });

  it("reads the facts from the database rows (the 0027 columns when present)", () => {
    const f = dealFactsFromRow({ name: "00 Coaching", company_name: null, screened: false, source: "Broker newsletter", listing_url: "https://x.com/a", year_established: 2010, employees: "20+ coaches", listing_text: FIXTURE, why_selling: "" }, { revenue: "3400000", ebitda: null, sde: 2534975, asking_price: 10000000 }, null, emptyQuestions());
    expect(f).toMatchObject({ name: "00 Coaching", revenue: 3_400_000, sde: 2_534_975, askingPrice: 10_000_000, yearEstablished: 2010, employees: "20+ coaches", whySelling: null, screened: false });
    expect(f.listingText).toBe(FIXTURE);
    // Before database update 0027 the row has no such columns: they read as unknown.
    expect(dealFactsFromRow({ name: "00 Coaching" }, null, "Interested", null)).toMatchObject({ yearEstablished: null, employees: null, listingText: null, revenue: null, screened: true, stage: "Interested" });
    expect(moneyExact(2534975)).toBe("$2,534,975");
    expect(moneyExact(null)).toBeNull();
  });
});

describe("every deal or listing prompt carries the facts, the listing text, and the no-false-gaps rule", () => {
  const c = dealPageContext(listing, FIXTURE);

  it("the Key finding star (field draft): revenue, asking price, a sentence from the listing text, then the rule", () => {
    const p = fieldPrompt(c, { key: "key_finding", label: "Key finding", current: "" });
    expect(p).toContain("TASK: field_draft");
    expect(p).toContain("revenue: $3,400,000");
    expect(p).toContain("asking price: $10,000,000");
    expect(p).toContain(SENTENCE);
    expect(p).toContain(NO_FALSE_GAPS_RULE);
    expect(NO_FALSE_GAPS_RULE).toBe("Only say information is missing when it is absent from the facts and the listing text above; name the exact field and who to ask.");
    // The rule comes after the facts and the text ("above").
    expect(p.indexOf(NO_FALSE_GAPS_RULE)).toBeGreaterThan(p.indexOf(SENTENCE));
    expect(p.indexOf(SENTENCE)).toBeGreaterThan(p.indexOf("revenue: $3,400,000"));
  });

  it("the next action star, suggested next steps, suggested tasks, and Ask about this page", () => {
    for (const p of [nextActionPrompt(c, "2026-11-04", "action", "deal"), nextStepsPrompt(c), tasksPrompt(c, "deal"), answerPrompt(c, "What is missing?", true)]) {
      expect(p).toContain("revenue: $3,400,000");
      expect(p).toContain("SDE: $2,534,975");
      expect(p).toContain("asking price: $10,000,000 (3.9x SDE)");
      expect(p).toContain(SENTENCE);
      expect(p).toContain(NO_FALSE_GAPS_RULE);
    }
  });

  it("a card star keeps the facts (the card filter narrows only the other lines)", () => {
    const p = fieldPrompt(dealPageContext(listing, FIXTURE, ["task: Read the CIM"]), { key: "task_text", label: "Task" });
    expect(p).toContain("year established: 2010");
    expect(p).toContain("link: https://www.websiteclosers.com/businesses/physician-coaching");
  });

  it("a deal without listing text says so before the rule", () => {
    const p = fieldPrompt(dealPageContext(listing, null), { key: "key_finding", label: "Key finding" });
    expect(p).toContain("Original listing text: none saved.");
    expect(p).toContain(NO_FALSE_GAPS_RULE);
  });

  it("pages that are not a deal or a listing do not get the rule", () => {
    const p = nextStepsPrompt({ title: "Project: Rosara hub", lines: ["project: Rosara hub"] });
    expect(p).not.toContain(NO_FALSE_GAPS_RULE);
    expect(p).not.toContain("Original listing text");
    expect(contextLabel({ label: "x" })).toBe("Context: x");
  });

  it("Suggest questions (also at Interested) and Suggest tasks read the same facts and text", () => {
    const ctx = { facts: dealFactsOf(listing, FIXTURE), nextAction: null, timeline: [], documentNames: [], existing: emptyQuestions() };
    for (const p of [questionsPrompt(ctx), todosPrompt(ctx, [])]) {
      expect(p).toContain("Deal: 00 Physician Coaching Company");
      expect(p).toContain("revenue: $3,400,000");
      expect(p).toContain("asking price: $10,000,000 (3.9x SDE)");
      expect(p).toContain(SENTENCE);
      expect(p).toContain(NO_FALSE_GAPS_RULE);
    }
  });
});

describe("Fill from text reads year established, employees, and why selling; the text is kept", () => {
  it("asks for the three fields and sends the fixture text", () => {
    const p = listingPrompt(FIXTURE);
    expect(p).toContain('"why_selling": ""');
    expect(p).toContain('"year_established": ""');
    expect(p).toContain('"employees": ""');
    expect(p).toContain("Year Established\n2010");
  });
  it("keeps the pasted text as pasted (paragraphs kept, cut at the paste limit); Save on the card needs 20 characters", () => {
    expect(listingTextToSave(FIXTURE)).toBe(FIXTURE.trim());
    expect(listingTextToSave(" a\r\n\r\nb ")).toBe("a\n\nb");
    expect(listingTextToSave("")).toBeNull();
    expect(listingTextToSave("too short", 20)).toBeNull();
    expect(listingTextToSave("x".repeat(LISTING_TEXT_MAX + 50))!.length).toBe(LISTING_TEXT_MAX);
  });
});
