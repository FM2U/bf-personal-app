import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_BUY_BOX_PREFERENCE, BASE_BUYER, BASE_GROWTH, BASE_JUDGE, BASE_RULES, WRITING_RULES, baseInstructions, buyBoxLine, buyerInstructions, FINANCING_LINES, financingLineFor, GENERAL_RULES_LINE, KEY_FINDING_SPOT, STAGE_LINES, stageLineFor, spotInstructions, type AiSpot } from "./instructions";
import { BUY_BOX_INPUT_KEYS, buyBoxSettingsFromRows, defaultBuyBoxSettings, type BuyBoxSettings } from "@/lib/work/buy-box";
import { answerDueDate, answerNextAction, answerNextActionDue, answerPrompt, applyKeyFindingDraft, fieldPrompt, keyFindingPrompt, stripDashes, nextActionPrompt, nextStepsPrompt, setNextActionLabel, setNextActionNote, tasksPrompt, trimContext, validateAnswerReply, validateKeyFindingReply, type PageContext } from "@/lib/work/ask-ai";
import { questionsPrompt, todosPrompt, emptyQuestions, type DealContext } from "@/lib/work/questions";
import { dealFactLines, dealFactsFromRow, parseFindingList } from "@/lib/work/deal-facts";

/** The approved spec (docs/2026-11-02-ai-instructions.md, quoted here): the texts must be used verbatim. */
const SPEC_BASE_1 = "The buyer is an independent searcher sourcing, screening and evaluating small business acquisitions. The goal is to buy one good business, own and run it, and grow it. Judge both whether this is a good business and whether it fits the buyer.";
const SPEC_JUDGE = "Judge the business on, in this order of weight: how revenue repeats; customer concentration; owner dependence and whether the team runs it; margins and their trend; where growth comes from and whether it lasts; how customers are won and what that costs; competition and switching costs; market tailwinds and headwinds (demand trends, regulation, reimbursement, technology); capital needs; price versus earnings; fit with the buy box and its paths to growth.";
const SPEC_RULES = "Use only the facts and listing text below. Do not count marketing claims as strengths without a figure behind them. Only say information is missing when it is absent from the facts and the listing text; name the field and who to ask.";
/** Revision 1 (approved 2026-11-02): the two sentences added to the shared base, verbatim, and the financing lines. */
const SPEC_GROWTH = "A clear path to growth is required for a good fit; a deal with no credible path counts as a risk.";
const SPEC_PREFERENCE = "The buy box is a preference, not a hard rule; say plainly when a business outside it is still worth pursuing.";
const SPEC_DEBT = "Financing: equity plus debt; check whether earnings can comfortably carry a loan.";
const SPEC_EQUITY = "Financing: all equity.";
/** Revision 2 (approved 2026-11-02): the writing rules, verbatim. */
const SPEC_WRITING = "Writing rules: No metaphors, no jargon, no colloquialisms. Use literal words that say exactly what is meant. Standard business terms are allowed (moat, runway, tailwind, headwind, churn, recurring revenue, add-backs, working capital, SDE, EBITDA, multiple, customer concentration, owner dependence) only when the specific fact is named next to the term. When judging something, say for whom it is good or bad (buyer or seller) and compared with what. Never call a price strong, cheap, fair or high unless the facts give a basis. No em-dashes.";
const SPEC_KEY_FINDING = `Write:
Strengths: up to 3, each naming the fact behind it and why it matters to the buyer.
Risks: up to 3, each naming the fact behind it.
Growth paths: up to 3 concrete ways to grow this business, each naming the fact behind it; put the main one first.
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
    expect(BASE_GROWTH).toBe(SPEC_GROWTH);
    expect(BASE_BUY_BOX_PREFERENCE).toBe(SPEC_PREFERENCE);
    const base = baseInstructions(set());
    for (const t of [SPEC_BASE_1, SPEC_JUDGE, SPEC_RULES, SPEC_GROWTH, SPEC_PREFERENCE]) expect(base).toContain(t);
    // The preference follows the buy box line; the growth sentence follows how to judge.
    expect(base.indexOf(SPEC_PREFERENCE)).toBe(base.indexOf(buyBoxLine(set())) + buyBoxLine(set()).length + 1);
    expect(base.indexOf(SPEC_GROWTH)).toBe(base.indexOf(SPEC_JUDGE) + SPEC_JUDGE.length + 1);
    expect(base).not.toMatch(/Bram|\u2014|\u2013|growth goals:|financing:/);
  });

  it("revision 2: the writing rules verbatim, once, right after the general rules; the judge list ends with its paths to growth", () => {
    expect(WRITING_RULES).toBe(SPEC_WRITING);
    const base = baseInstructions(set());
    expect(base.endsWith(`${SPEC_RULES}\n\n${SPEC_WRITING}`)).toBe(true);
    expect(base.split(SPEC_WRITING).length).toBe(2);
    expect(base).not.toMatch(/Plain words|no hype|growth goals/i);
    expect(BASE_JUDGE.endsWith("; fit with the buy box and its paths to growth.")).toBe(true);
    expect(GENERAL_RULES_LINE).toContain(SPEC_WRITING);
    expect(GENERAL_RULES_LINE).not.toMatch(/Plain words|no hype/i);
  });

  it("fills the buy box from the settings: core and stretch ranges, industries with the excluded types, regions, owner-operator", () => {
    expect(buyBoxLine(set())).toBe("Buy box: $1M to $2.5M EBITDA (or SDE when there is no EBITDA), stretch range $0.75M to $3.5M, B2B services (no retail, direct to consumer, or franchises), Southeast or East Coast, owner-operator.");
    const custom = buyBoxLine(set({ coreMin: 500_000, coreMax: 2_000_000, stretchMin: 400_000, stretchMax: 3_000_000, industries: "Home services", excluded: ["franchises"], excludedOther: "restaurants, trucking", regions: ["midwest"], regionsOther: "Texas", ownerOperator: false }));
    expect(custom).toBe("Buy box: $0.5M to $2M EBITDA (or SDE when there is no EBITDA), stretch range $0.4M to $3M, Home services (no franchises, restaurants, or trucking), Midwest or Texas, not owner-operator (a hired manager runs it).");
    expect(buyBoxLine(set({ industries: "", excluded: [], regions: [], regionsOther: null }))).toBe("Buy box: $1M to $2.5M EBITDA (or SDE when there is no EBITDA), stretch range $0.75M to $3.5M, any industry, any US region, owner-operator.");
    expect(baseInstructions(set({ coreMin: 1_200_000 }))).toContain("Buy box: $1.2M to $2.5M EBITDA");
  });

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

describe("the AI instructions: the financing line (revision 1, from Model onward in revision 2)", () => {
  it("says equity plus debt or all equity only from Model onward: Model, Partner presentation, IOI or LOI, Diligence, Closed", () => {
    expect(FINANCING_LINES.equity_plus_debt).toBe(SPEC_DEBT);
    expect(FINANCING_LINES.equity).toBe(SPEC_EQUITY);
    for (const st of ["Model", "Partner presentation", "IOI or LOI", "Diligence", "Closed"]) {
      expect(financingLineFor(st, true, "equity_plus_debt")).toBe(SPEC_DEBT);
      expect(financingLineFor(st, true, "equity")).toBe(SPEC_EQUITY);
      expect(financingLineFor(st, true, null)).toBe(SPEC_EQUITY);
    }
    for (const st of ["Interested", "NDA signed", "CIM review", "Broker call", "Seller call", "Passed", null]) expect(financingLineFor(st, true, "equity_plus_debt")).toBeNull();
    // A listing (not screened) gets nothing, whatever its stage field says.
    expect(financingLineFor("Model", false, "equity_plus_debt")).toBeNull();
  });

  it("puts the financing line after the stage line and before the spot part; earlier stages say nothing about financing", () => {
    const model = buyerInstructions({ buyBox: set(), stage: "after_cim", financing: financingLineFor("Model", true, "equity_plus_debt") }, "tasks");
    expect(model.indexOf(STAGE_LINES.after_cim)).toBeLessThan(model.indexOf(SPEC_DEBT));
    expect(model.indexOf(SPEC_DEBT)).toBeLessThan(model.indexOf(spotInstructions("tasks")));
    const cim = buyerInstructions({ buyBox: set(), stage: "after_cim", financing: financingLineFor("CIM review", true, "equity_plus_debt") }, "tasks");
    expect(cim).not.toMatch(/Financing:|financing/i);
    const partner = buyerInstructions({ buyBox: set(), stage: stageLineFor("Partner presentation", true), financing: financingLineFor("Partner presentation", true, "equity_plus_debt") }, "tasks");
    expect(partner).toContain(SPEC_DEBT);
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

  const deal: PageContext = trimContext({ title: "Deal: Dalton Services", lines: ["name: Dalton Services", "stage: Model", "growth path (main): Add commercial HVAC"], deal: true, listingText: null, buyer: { buyBox: set(), stage: "after_cim", financing: financingLineFor("Model", true, "equity_plus_debt") } });
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
      expect(p, name).toContain("- growth path (main): Add commercial HVAC");
      expect(p, name).toContain(SPEC_DEBT);
      expect(p, name).toContain(SPEC_GROWTH);
      expect(p, name).toContain(SPEC_PREFERENCE);
      expect(p, name).toContain(STAGE_LINES.after_cim);
      expect(p, name).toContain(spotInstructions(spot, "Next action"));
      expect(p.indexOf(SPEC_RULES), name).toBeLessThan(p.indexOf("Page: Deal: Dalton Services"));
      expect(p.indexOf(spotInstructions(spot, "Next action")), name).toBeLessThan(p.indexOf("- name: Dalton Services"));
      expect(p, name).not.toContain(GENERAL_RULES_LINE);
      expect(p.split(SPEC_WRITING).length, name).toBe(2);
      expect(p, name).not.toMatch(/Plain words, no hype/);
    }
  });

  it("keeps the other records' prompts and adds the general rules line only", () => {
    for (const p of [answerPrompt(other, "What next?", false), nextStepsPrompt(other), fieldPrompt(other, { key: "project_note", label: "Note" })]) {
      expect(p).toContain(GENERAL_RULES_LINE);
      expect(p.split(SPEC_WRITING).length).toBe(2);
      expect(p).not.toContain(SPEC_BASE_1);
    }
  });

  it("gives Suggest questions and Suggest tasks the instructions, with the stage line of the deal", () => {
    const facts = dealFactsFromRow({ name: "00 Physician Coaching Company", screened: false, listing_text: FIXTURE, key_finding: "Ownership share fell to 5%", strengths: ["70% recurring"], risks: ["Founder leaving"], growth_paths: ["Add a second specialty", "Raise prices 5%"], financing: "equity_plus_debt" }, { revenue: 7843427, sde: 2534975, asking_price: 10000000 }, null, emptyQuestions());
    const c: DealContext = { facts, nextAction: null, timeline: [], documentNames: [], existing: emptyQuestions(), buyBox: set({ coreMin: 2_000_000 }) };
    const q = questionsPrompt(c);
    expect(q.startsWith("TASK: open_questions\n")).toBe(true);
    expect(q).toContain(SPEC_BASE_1);
    expect(q).toContain(STAGE_LINES.screening);
    expect(q).toContain(spotInstructions("questions"));
    expect(q).toContain("Buy box: $2M to $2.5M EBITDA");
    // A listing: nothing about financing.
    expect(q).not.toMatch(/Financing:/);
    expect(q.indexOf(spotInstructions("questions"))).toBeLessThan(q.indexOf("Deal facts:"));
    // Strengths and risks are facts for every later AI action.
    expect(q).toContain("strength: 70% recurring");
    expect(q).toContain("risk: Founder leaving");
    expect(q).toContain("growth path (main): Add a second specialty\ngrowth path: Raise prices 5%");
    const t = todosPrompt({ ...c, facts: { ...facts, screened: true, stage: "Diligence" } }, []);
    expect(t).toContain(STAGE_LINES.diligence);
    expect(t).toContain(spotInstructions("tasks"));
    expect(t).toContain(SPEC_DEBT);
    expect(todosPrompt({ ...c, facts: { ...facts, screened: true, stage: "Model", financing: "equity" } }, [])).toContain(SPEC_EQUITY);
    expect(todosPrompt({ ...c, facts: { ...facts, screened: true, stage: "CIM review" } }, [])).not.toMatch(/Financing:/);
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

  it("asks for the four parts as JSON after the facts", () => {
    const deal = trimContext({ title: "Listing: X", lines: ["name: X"], deal: true, listingText: "Listing body", buyer: { buyBox: set(), stage: "screening" } });
    const p = keyFindingPrompt(deal);
    expect(p.startsWith("TASK: key_finding\n")).toBe(true);
    expect(p).toContain(SPEC_KEY_FINDING);
    expect(p).toContain(STAGE_LINES.screening);
    expect(p.indexOf("Listing body")).toBeGreaterThan(p.indexOf(SPEC_KEY_FINDING));
    expect(p).toMatch(/"strengths".*"risks".*"growth_paths".*"key_finding".*"broker_questions"/);
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
