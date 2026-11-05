import { describe, expect, it } from "vitest";
import { GENERAL_RULES_LINE, spotInstructions, type AiSpot } from "./instructions";
import { BUY_BOX_INPUT_KEYS, buyBoxSettingsFromRows, defaultBuyBoxSettings } from "@/lib/work/buy-box";
import { answerDueDate, answerNextAction, answerNextActionDue, answerPrompt, applyKeyFindingDraft, fieldPrompt, stripDashes, nextStepsPrompt, setNextActionLabel, setNextActionNote, trimContext, validateAnswerReply, validateKeyFindingReply, type PageContext } from "@/lib/work/ask-ai";
import { dealFactLines, dealFactsFromRow, parseFindingList } from "@/lib/work/deal-facts";

/** The approved spec (docs/2026-11-02-ai-instructions.md, quoted here): the texts must be used verbatim. */
const SPEC_BASE_1 = "The buyer is an independent searcher sourcing, screening and evaluating small business acquisitions. The goal is to buy one good business, own and run it, and grow it. Judge both whether this is a good business and whether it fits the buyer.";
/** Revision 2 (approved 2026-11-02): the writing rules, verbatim. */
const SPEC_WRITING = "Writing rules: No metaphors, no jargon, no colloquialisms. Use literal words that say exactly what is meant. Standard business terms are allowed (moat, runway, tailwind, headwind, churn, recurring revenue, add-backs, working capital, SDE, EBITDA, multiple, customer concentration, owner dependence) only when the specific fact is named next to the term. When judging something, say for whom it is good or bad (buyer or seller) and compared with what. Never call a price strong, cheap, fair or high unless the facts give a basis. No em-dashes.";
const SPEC_KEY_FINDING = `Write:
Strengths: up to 3, each naming the fact behind it and why it matters to the buyer.
Risks: up to 3, each naming the fact behind it.
Growth paths: up to 3 concrete ways to grow this business, each naming the fact behind it; put the main one first.
Key finding: one sentence under 30 words that weighs the top strength against the top risk and says what decides the deal.
Check with the broker: up to 3 questions for data gaps and mismatches. Never put a gap or mismatch in the Key finding.`;



describe("the AI instructions: the shared base", () => {
  it("reads the settings rows: a missing row is its default, an empty text row is empty, owner-operator yes by default", () => {
    expect(buyBoxSettingsFromRows([])).toEqual(defaultBuyBoxSettings());
    expect(defaultBuyBoxSettings()).toMatchObject({ coreMin: 1_000_000, coreMax: 2_500_000, stretchMin: 750_000, stretchMax: 3_500_000, industries: "B2B services", excluded: ["retail", "direct_to_consumer", "franchises"], regions: ["southeast", "east_coast"], ownerOperator: true });
    const b = buyBoxSettingsFromRows([
      { key: BUY_BOX_INPUT_KEYS.ownerOperator, value_number: 0 },
      { key: BUY_BOX_INPUT_KEYS.coreMin, value_number: "800000" },
      { key: BUY_BOX_INPUT_KEYS.stretchMax, value_number: -5 },
      { key: BUY_BOX_INPUT_KEYS.industries, value_text: "  Healthcare \n services " },
      { key: BUY_BOX_INPUT_KEYS.excluded, value_text: "" },
      { key: BUY_BOX_INPUT_KEYS.regions, value_text: "west,southeast,nowhere" },
      { key: BUY_BOX_INPUT_KEYS.regionsOther, value_text: "Ohio" },
      // The two settings revision 1 removed are not read.
      { key: "buy_box_financing", value_text: "SBA loan" },
      { key: "buy_box_growth_goals", value_text: "Double revenue" },
    ]);
    expect(b).toEqual({ ...defaultBuyBoxSettings(), ownerOperator: false, coreMin: 800_000, industries: "Healthcare services", excluded: [], regions: ["southeast", "west"], regionsOther: "Ohio" });
    expect(buyBoxSettingsFromRows([{ key: BUY_BOX_INPUT_KEYS.ownerOperator, value_number: null }]).ownerOperator).toBe(true);
    expect(buyBoxSettingsFromRows([{ key: BUY_BOX_INPUT_KEYS.industries, value_text: "" }]).industries).toBe("");
  });
});
describe("the AI instructions: the spot part per action", () => {
  it("has one part per spot, and only the Key finding spot asks for strengths and risks", () => {
    const spots: AiSpot[] = ["key_finding", "questions", "tasks", "next_action", "next_steps", "ask", "field"];
    const texts = spots.map((s) => spotInstructions(s, "Next action"));
    expect(new Set(texts).size).toBe(spots.length);
    expect(spotInstructions("key_finding")).toBe(SPEC_KEY_FINDING);
    expect(spotInstructions("questions")).toMatch(/^Write open questions only/);
    expect(spotInstructions("tasks")).toMatch(/^Write tasks only/);
    expect(spotInstructions("next_action")).toBe("Write one next action and its due date only.");
    expect(spotInstructions("ask")).toBe("Answer the question asked, and only that question.");
    expect(spotInstructions("field", "Email subject")).toBe("Write only the text for the Email subject field.");
  });

  const other: PageContext = trimContext({ title: "Project: Market research", lines: ["project: Market research"] });
  it("keeps the other records' prompts and adds the general rules line only", () => {
    for (const p of [answerPrompt(other, "What next?", false), nextStepsPrompt(other), fieldPrompt(other, { key: "project_note", label: "Note" })]) {
      expect(p).toContain(GENERAL_RULES_LINE);
      // Push D: the writing rules are in the system prompt only, so the prompt itself does not repeat them.
      expect(p).not.toContain(SPEC_WRITING);
      expect(p).not.toContain(SPEC_BASE_1);
    }
  });
});

describe("strengths, risks, and growth paths as facts", () => {
  it("reads the stored lists (jsonb array or JSON text), up to 3, no repeats", () => {
    expect(parseFindingList(["a", " a ", "", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(parseFindingList('["x"]')).toEqual(["x"]);
    expect(parseFindingList(null)).toEqual([]);
    expect(parseFindingList({ a: 1 })).toEqual([]);
    const lines = dealFactLines(dealFactsFromRow({ name: "X", key_finding: "K", strengths: ["S1", "S2"], risks: ["R1"], growth_paths: ["G1", "G2", "G3", "G4"] }, null, "Model", null));
    expect(lines.slice(lines.indexOf("key finding: K"))).toEqual(["key finding: K", "strength: S1", "strength: S2", "risk: R1", "growth path (main): G1", "growth path: G2", "growth path: G3"]);
    // Financing is never a fact line (only the instructions' financing line at the later stages).
    expect(dealFactLines(dealFactsFromRow({ name: "X", financing: "equity_plus_debt" }, null, "Model", null)).join("\n")).not.toMatch(/financing|equity/i);
    expect(dealFactsFromRow({ name: "X" }, null, null, null).financing).toBe("equity");
  });
});

describe("the Key finding star", () => {
  it("checks the reply: four parts, up to 3 lines each, one sentence under 30 words", () => {
    const ok = validateKeyFindingReply({ strengths: ["- 70% recurring revenue, so cash is steady", "70% recurring revenue, so cash is steady", "Team of 20 coaches", "Fourth", "Fifth"], risks: "Owner share fell from 19% to 5%", growth_paths: ["1. Add employer contracts: 70% of clients are physicians in groups", "Raise prices"], key_finding: "Steady recurring revenue against an unclear owner exit; the seller transition plan decides it.", broker_questions: ["Which period does the $7.8M cover?"] });
    expect(ok).toEqual({ ok: true, value: { strengths: ["70% recurring revenue, so cash is steady", "Team of 20 coaches", "Fourth"], risks: ["Owner share fell from 19% to 5%"], growthPaths: ["Add employer contracts: 70% of clients are physicians in groups", "Raise prices"], keyFinding: "Steady recurring revenue against an unclear owner exit; the seller transition plan decides it.", brokerQuestions: ["Which period does the $7.8M cover?"] } });
    expect(validateKeyFindingReply({ strengths: [], risks: [], key_finding: "Short.", check_with_the_broker: ["Q?"] })).toMatchObject({ ok: true, value: { brokerQuestions: ["Q?"] } });
    const long = validateKeyFindingReply({ strengths: [], risks: [], key_finding: Array.from({ length: 30 }, () => "word").join(" ") });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.error).toContain("under 30 words");
    expect(validateKeyFindingReply({ strengths: [1], risks: [], key_finding: "x" }).ok).toBe(false);
    expect(validateKeyFindingReply({ strengths: [], risks: [] }).ok).toBe(false);
    expect(validateKeyFindingReply("text").ok).toBe(false);
  });

  it("revision 2: strips em-dashes and en-dashes used as dashes from every returned line", () => {
    expect(stripDashes("Strong price \u2014 but the owner leaves")).toBe("Strong price, but the owner leaves");
    expect(stripDashes("Revenue grew \u2013 slowly")).toBe("Revenue grew, slowly");
    expect(stripDashes("Weeks 3\u20135 and a well-run team")).toBe("Weeks 3\u20135 and a well-run team");
    const r = validateKeyFindingReply({ strengths: ["70% recurring \u2014 steady cash"], risks: ["Owner leaves \u2013 clients may follow"], growth_paths: ["Employer groups \u2014 70% of clients"], key_finding: "The deal depends on the clients \u2014 loyal to the company or the owner.", broker_questions: ["Which period \u2013 2024 or 2025?"] });
    expect(r).toEqual({ ok: true, value: { strengths: ["70% recurring, steady cash"], risks: ["Owner leaves, clients may follow"], growthPaths: ["Employer groups, 70% of clients"], keyFinding: "The deal depends on the clients, loyal to the company or the owner.", brokerQuestions: ["Which period, 2024 or 2025?"] } });
  });

  it("checks the growth paths: a list of text, up to 3 in the order given (the main one first), camelCase read too; none when missing", () => {
    const g = (growth: unknown) => validateKeyFindingReply({ strengths: [], risks: [], growth_paths: growth, key_finding: "Short." });
    expect(g(["Main path", "Second", "Third", "Fourth"])).toMatchObject({ ok: true, value: { growthPaths: ["Main path", "Second", "Third"] } });
    expect(g(["B first", "a second", "b FIRST"])).toMatchObject({ ok: true, value: { growthPaths: ["B first", "a second"] } });
    expect(g(undefined)).toMatchObject({ ok: true, value: { growthPaths: [] } });
    expect(validateKeyFindingReply({ strengths: [], risks: [], growthPaths: ["Camel"], key_finding: "Short." })).toMatchObject({ ok: true, value: { growthPaths: ["Camel"] } });
    const bad = g([{ path: "x" }]);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('"growth_paths" must be a list of text');
    expect(g({ a: 1 }).ok).toBe(false);
  });

  it("Use this: fills the three and adds the broker questions after the ones there, skipping repeats", () => {
    const r = applyKeyFindingDraft({ broker: ["Can we get 3 years of financials?", ""] }, { strengths: ["S"], risks: ["R"], growthPaths: ["G main", "G2"], keyFinding: "K", brokerQuestions: ["can we get 3 years of financials?", "Which period does the $7.8M cover?"] });
    expect(r).toEqual({ keyFinding: "K", strengths: ["S"], risks: ["R"], growthPaths: ["G main", "G2"], broker: ["Can we get 3 years of financials?", "Which period does the $7.8M cover?"], added: 1 });
    expect(applyKeyFindingDraft({ broker: Array.from({ length: 12 }, (_, i) => `Q${i}`) }, { strengths: [], risks: [], growthPaths: [], keyFinding: "K", brokerQuestions: ["New"] }).added).toBe(0);
  });
});

describe("Set next action from an answer", () => {
  it("reads one clear action and an optional date; a word meaning none is no action", () => {
    expect(answerNextAction("  Ask Website Closers which period the $7.8M covers ")).toBe("Ask Website Closers which period the $7.8M covers");
    for (const none of [null, "", "null", "None", "N/A", "-"]) expect(answerNextAction(none)).toBeNull();
    expect(answerNextActionDue("2026-11-09")).toBe("2026-11-09");
    expect(answerNextActionDue("2026-02-30")).toBeNull();
    expect(answerNextActionDue("next week")).toBeNull();
    const r = validateAnswerReply({ bullets: ["x"], next_action: "Email Mark", next_action_due: "2026-11-10" });
    expect(r.ok && [r.value.nextAction, r.value.nextActionDue]).toEqual(["Email Mark", "2026-11-10"]);
    const none = validateAnswerReply({ bullets: ["x"], next_action: "null", next_action_due: "2026-11-10" });
    expect(none.ok && [none.value.nextAction, none.value.nextActionDue]).toEqual([null, null]);
  });

  it("shows the button only with an action, labeled with it", () => {
    expect(setNextActionLabel({ nextAction: "Ask Website Closers which period the $7.8M covers" })).toBe("Set next action: Ask Website Closers which period the $7.8M covers");
    expect(setNextActionLabel({ nextAction: null })).toBeNull();
    expect(setNextActionLabel(null)).toBeNull();
  });

  it("is due tomorrow unless the answer gives a date (an earlier date becomes today), and says where it went", () => {
    expect(answerDueDate(null, "2026-11-04")).toBe("2026-11-05");
    expect(answerDueDate("2026-11-12", "2026-11-04")).toBe("2026-11-12");
    expect(answerDueDate("2026-10-01", "2026-11-04")).toBe("2026-11-04");
    expect(setNextActionNote("record")).toBe("Next action set");
    expect(setNextActionNote("person")).toBe("Next follow-up set");
    expect(setNextActionNote("todo")).toBe("Added to To-dos for today");
  });

  it("asks for next_action and next_action_due in the answer JSON", () => {
    const p = answerPrompt(trimContext({ title: "Home", lines: ["deal: X"] }), "What first?", true);
    expect(p).toContain('"next_action_due": "YYYY-MM-DD" | null');
    expect(p).toContain("one clear thing");
  });
});
