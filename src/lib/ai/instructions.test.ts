import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_BUYER, BASE_JUDGE, BASE_RULES, baseInstructions, buyBoxLine, buyerInstructions, GENERAL_RULES_LINE, KEY_FINDING_SPOT, STAGE_LINES, stageLineFor, spotInstructions, type AiSpot } from "./instructions";
import { BUY_BOX_INPUT_KEYS, buyBoxSettingsFromRows, defaultBuyBoxSettings, type BuyBoxSettings } from "@/lib/work/buy-box";
import { answerDueDate, answerNextAction, answerNextActionDue, answerPrompt, applyKeyFindingDraft, fieldPrompt, keyFindingPrompt, nextActionPrompt, nextStepsPrompt, setNextActionLabel, setNextActionNote, tasksPrompt, trimContext, validateAnswerReply, validateKeyFindingReply, type PageContext } from "@/lib/work/ask-ai";
import { questionsPrompt, todosPrompt, emptyQuestions, type DealContext } from "@/lib/work/questions";
import { dealFactLines, dealFactsFromRow, parseFindingList } from "@/lib/work/deal-facts";

/** The approved spec (docs/2026-11-02-ai-instructions.md, quoted here): the texts must be used verbatim. */
const SPEC_BASE_1 = "The buyer is an independent searcher sourcing, screening and evaluating small business acquisitions. The goal is to buy one good business, own and run it, and grow it. Judge both whether this is a good business and whether it fits the buyer.";
const SPEC_JUDGE = "Judge the business on, in this order of weight: how revenue repeats; customer concentration; owner dependence and whether the team runs it; margins and their trend; where growth comes from and whether it lasts; how customers are won and what that costs; competition and switching costs; market tailwinds and headwinds (demand trends, regulation, reimbursement, technology); capital needs; price versus earnings; fit with the buy box and growth goals.";
const SPEC_RULES = "Use only the facts and listing text below. Do not count marketing claims as strengths without a figure behind them. Only say information is missing when it is absent from the facts and the listing text; name the field and who to ask. Plain words, no hype.";
const SPEC_KEY_FINDING = `Write:
Strengths: up to 3, each naming the fact behind it and why it matters to the buyer.
Risks: up to 3, each naming the fact behind it.
Key finding: one sentence under 30 words that weighs the top strength against the top risk and says what decides the deal.
Check with the broker: up to 3 questions for data gaps and mismatches. Never put a gap or mismatch in the Key finding.`;

const FIXTURE = readFileSync(path.resolve(import.meta.dirname, "../../../dev-tools/fixtures/listing-physician-coaching.txt"), "utf8");

const set = (over: Partial<BuyBoxSettings> = {}): BuyBoxSettings => ({ ...defaultBuyBoxSettings(), ...over });

describe("the AI instructions: the shared base", () => {
  it("uses the approved texts verbatim", () => {
    expect(BASE_BUYER).toBe(SPEC_BASE_1);
    expect(BASE_JUDGE).toBe(SPEC_JUDGE);
    expect(BASE_RULES).toBe(SPEC_RULES);
    expect(KEY_FINDING_SPOT).toBe(SPEC_KEY_FINDING);
    const base = baseInstructions(set());
    for (const t of [SPEC_BASE_1, SPEC_JUDGE, SPEC_RULES]) expect(base).toContain(t);
    expect(base).not.toMatch(/Bram|\u2014|\u2013/);
  });

  it("fills the buy box from the settings and leaves out the optional parts that are not set", () => {
    expect(buyBoxLine(set())).toBe("Buy box: $1M to $2.5M EBITDA (or SDE when there is no EBITDA), B2B services (no retail, direct to consumer, or franchises), Southeast or East Coast, owner-operator.");
    const full = buyBoxLine(set({ ownerOperator: false, financing: "SBA loan and seller note", growthGoals: "Add a second location within 3 years." }));
    expect(full).toBe("Buy box: $1M to $2.5M EBITDA (or SDE when there is no EBITDA), B2B services (no retail, direct to consumer, or franchises), Southeast or East Coast, not owner-operator (a hired manager runs it), financing: SBA loan and seller note, growth goals: Add a second location within 3 years.");
    expect(buyBoxLine(set({ financing: "  ", growthGoals: null }))).not.toMatch(/financing|growth goals/);
    expect(baseInstructions(set({ growthGoals: "Double revenue" }))).toContain("growth goals: Double revenue.");
  });

  it("reads the settings rows: owner-operator yes by default, 0 is no, text trimmed to one line", () => {
    expect(buyBoxSettingsFromRows([])).toMatchObject({ ownerOperator: true, financing: null, growthGoals: null });
    const b = buyBoxSettingsFromRows([
      { key: BUY_BOX_INPUT_KEYS.ownerOperator, value_number: 0 },
      { key: BUY_BOX_INPUT_KEYS.financing, value_text: "  SBA \n loan " },
      { key: BUY_BOX_INPUT_KEYS.growthGoals, value_text: "" },
    ]);
    expect(b).toMatchObject({ ownerOperator: false, financing: "SBA loan", growthGoals: null });
    expect(buyBoxSettingsFromRows([{ key: BUY_BOX_INPUT_KEYS.ownerOperator, value_number: null }]).ownerOperator).toBe(true);
  });
});

describe("the AI instructions: the stage line", () => {
  it("picks the line from the deal's state", () => {
    expect(stageLineFor(null, false)).toBe("screening");
    expect(stageLineFor("CIM review", false)).toBe("screening");
    for (const s of ["Interested", "NDA signed"]) expect(stageLineFor(s, true)).toBe("screening");
    for (const s of ["CIM review", "Broker call", "Seller call", "Model", "Partner presentation"]) expect(stageLineFor(s, true)).toBe("after_cim");
    for (const s of ["IOI or LOI", "Diligence"]) expect(stageLineFor(s, true)).toBe("diligence");
    expect(stageLineFor("Passed", true)).toBe("screening");
    expect(STAGE_LINES.screening).toContain("give a quick view of business quality and any deal-breakers".replace(/^g/, "G"));
    expect(STAGE_LINES.after_cim).toContain("Test the main claims and the growth story.");
    expect(STAGE_LINES.diligence).toContain("Focus on what still needs verifying.");
  });

  it("puts the base, the stage line, and the spot part in that order, with no stage line on a list of deals", () => {
    const i = buyerInstructions({ buyBox: set(), stage: "after_cim" }, "questions");
    expect(i.indexOf(SPEC_BASE_1)).toBe(0);
    expect(i.indexOf(SPEC_RULES)).toBeLessThan(i.indexOf(STAGE_LINES.after_cim));
    expect(i.indexOf(STAGE_LINES.after_cim)).toBeLessThan(i.indexOf(spotInstructions("questions")));
    const list = buyerInstructions({ buyBox: set(), stage: null }, "ask");
    for (const l of Object.values(STAGE_LINES)) expect(list).not.toContain(l);
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

  const deal: PageContext = trimContext({ title: "Deal: Dalton Services", lines: ["name: Dalton Services", "stage: CIM review"], deal: true, listingText: null, buyer: { buyBox: set({ growthGoals: "Add commercial HVAC" }), stage: "after_cim" } });
  const other: PageContext = trimContext({ title: "Project: Market research", lines: ["project: Market research"] });

  it("sends the base, the stage line, the spot, then the facts, in every deal prompt", () => {
    const prompts: [string, string, AiSpot][] = [
      ["key_finding", keyFindingPrompt(deal), "key_finding"],
      ["ask_page", answerPrompt(deal, "What is the biggest risk?", true), "ask"],
      ["next_steps", nextStepsPrompt(deal), "next_steps"],
      ["tasks", tasksPrompt(deal, "deal"), "tasks"],
      ["next_action", nextActionPrompt(deal, "2026-11-04", "action", "deal"), "next_action"],
      ["field_draft", fieldPrompt(deal, { key: "next_action", label: "Next action" }), "field"],
    ];
    for (const [name, p, spot] of prompts) {
      expect(p, name).toContain(SPEC_BASE_1);
      expect(p, name).toContain("growth goals: Add commercial HVAC.");
      expect(p, name).toContain(STAGE_LINES.after_cim);
      expect(p, name).toContain(spotInstructions(spot, "Next action"));
      expect(p.indexOf(SPEC_RULES), name).toBeLessThan(p.indexOf("Page: Deal: Dalton Services"));
      expect(p.indexOf(spotInstructions(spot, "Next action")), name).toBeLessThan(p.indexOf("- name: Dalton Services"));
      expect(p, name).not.toContain(GENERAL_RULES_LINE);
    }
  });

  it("keeps the other records' prompts and adds the general rules line only", () => {
    for (const p of [answerPrompt(other, "What next?", false), nextStepsPrompt(other), fieldPrompt(other, { key: "project_note", label: "Note" })]) {
      expect(p).toContain(GENERAL_RULES_LINE);
      expect(p).not.toContain(SPEC_BASE_1);
    }
  });

  it("gives Suggest questions and Suggest tasks the instructions, with the stage line of the deal", () => {
    const facts = dealFactsFromRow({ name: "00 Physician Coaching Company", screened: false, listing_text: FIXTURE, key_finding: "Ownership share fell to 5%", strengths: ["70% recurring"], risks: ["Founder leaving"] }, { revenue: 7843427, sde: 2534975, asking_price: 10000000 }, null, emptyQuestions());
    const c: DealContext = { facts, nextAction: null, timeline: [], documentNames: [], existing: emptyQuestions(), buyBox: set({ financing: "SBA loan" }) };
    const q = questionsPrompt(c);
    expect(q.startsWith("TASK: open_questions\n")).toBe(true);
    expect(q).toContain(SPEC_BASE_1);
    expect(q).toContain(STAGE_LINES.screening);
    expect(q).toContain(spotInstructions("questions"));
    expect(q).toContain("financing: SBA loan");
    expect(q.indexOf(spotInstructions("questions"))).toBeLessThan(q.indexOf("Deal facts:"));
    // Strengths and risks are facts for every later AI action.
    expect(q).toContain("strength: 70% recurring");
    expect(q).toContain("risk: Founder leaving");
    const t = todosPrompt({ ...c, facts: { ...facts, screened: true, stage: "Diligence" } }, []);
    expect(t).toContain(STAGE_LINES.diligence);
    expect(t).toContain(spotInstructions("tasks"));
  });
});

describe("strengths and risks as facts", () => {
  it("reads the stored lists (jsonb array or JSON text), up to 3, no repeats", () => {
    expect(parseFindingList(["a", " a ", "", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(parseFindingList('["x"]')).toEqual(["x"]);
    expect(parseFindingList(null)).toEqual([]);
    expect(parseFindingList({ a: 1 })).toEqual([]);
    const lines = dealFactLines(dealFactsFromRow({ name: "X", key_finding: "K", strengths: ["S1", "S2"], risks: ["R1"] }, null, "Model", null));
    expect(lines.slice(lines.indexOf("key finding: K"))).toEqual(["key finding: K", "strength: S1", "strength: S2", "risk: R1"]);
  });
});

describe("the Key finding star", () => {
  it("checks the reply: four parts, up to 3 lines each, one sentence under 30 words", () => {
    const ok = validateKeyFindingReply({ strengths: ["- 70% recurring revenue, so cash is steady", "70% recurring revenue, so cash is steady", "Team of 20 coaches", "Fourth", "Fifth"], risks: "Owner share fell from 19% to 5%", key_finding: "Steady recurring revenue against an unclear owner exit; the seller transition plan decides it.", broker_questions: ["Which period does the $7.8M cover?"] });
    expect(ok).toEqual({ ok: true, value: { strengths: ["70% recurring revenue, so cash is steady", "Team of 20 coaches", "Fourth"], risks: ["Owner share fell from 19% to 5%"], keyFinding: "Steady recurring revenue against an unclear owner exit; the seller transition plan decides it.", brokerQuestions: ["Which period does the $7.8M cover?"] } });
    expect(validateKeyFindingReply({ strengths: [], risks: [], key_finding: "Short.", check_with_the_broker: ["Q?"] })).toMatchObject({ ok: true, value: { brokerQuestions: ["Q?"] } });
    const long = validateKeyFindingReply({ strengths: [], risks: [], key_finding: Array.from({ length: 30 }, () => "word").join(" ") });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.error).toContain("under 30 words");
    expect(validateKeyFindingReply({ strengths: [1], risks: [], key_finding: "x" }).ok).toBe(false);
    expect(validateKeyFindingReply({ strengths: [], risks: [] }).ok).toBe(false);
    expect(validateKeyFindingReply("text").ok).toBe(false);
  });

  it("Use this: fills the three and adds the broker questions after the ones there, skipping repeats", () => {
    const r = applyKeyFindingDraft({ broker: ["Can we get 3 years of financials?", ""] }, { strengths: ["S"], risks: ["R"], keyFinding: "K", brokerQuestions: ["can we get 3 years of financials?", "Which period does the $7.8M cover?"] });
    expect(r).toEqual({ keyFinding: "K", strengths: ["S"], risks: ["R"], broker: ["Can we get 3 years of financials?", "Which period does the $7.8M cover?"], added: 1 });
    expect(applyKeyFindingDraft({ broker: Array.from({ length: 12 }, (_, i) => `Q${i}`) }, { strengths: [], risks: [], keyFinding: "K", brokerQuestions: ["New"] }).added).toBe(0);
  });

  it("asks for the four parts as JSON after the facts", () => {
    const deal = trimContext({ title: "Listing: X", lines: ["name: X"], deal: true, listingText: "Listing body", buyer: { buyBox: set(), stage: "screening" } });
    const p = keyFindingPrompt(deal);
    expect(p.startsWith("TASK: key_finding\n")).toBe(true);
    expect(p).toContain(SPEC_KEY_FINDING);
    expect(p).toContain(STAGE_LINES.screening);
    expect(p.indexOf("Listing body")).toBeGreaterThan(p.indexOf(SPEC_KEY_FINDING));
    expect(p).toMatch(/"strengths".*"risks".*"key_finding".*"broker_questions"/);
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
