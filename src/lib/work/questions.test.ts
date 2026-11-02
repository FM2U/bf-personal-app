import { describe, expect, it } from "vitest";
import { cleanQuestions, countQuestions, emptyQuestions, mergeQuestions, parseOpenQuestions, QUESTION_GROUPS, questionsEmailDraft, questionsFromLines, questionsPrompt, todosPrompt, validateQuestionsReply, validateTodosReply, type DealContext } from "./questions";

const ctx: DealContext = {
  facts: {
    name: "Dalton Services",
    listingName: "00 Commercial HVAC Service Contractor",
    companyName: "Dalton Services",
    stage: "CIM review",
    screened: true,
    whatItDoes: "Commercial HVAC service and maintenance contracts",
    location: "Chattanooga, TN",
    industry: "Home and building services",
    brokerName: "Rachel Kim, Transworld",
    source: "Broker newsletter",
    whySelling: "Retiring, no successor",
    revenue: 5_600_000,
    ebitda: 1_700_000,
    sde: null,
    askingPrice: 6_000_000,
    yearEstablished: null,
    employees: null,
    listingUrl: null,
    keyFinding: "70% of revenue is recurring maintenance contracts",
    openQuestions: null,
    listingText: "Commercial HVAC contractor in Chattanooga.\n\nThe owner works in the field two days a week and plans to stay six months.",
  },
  nextAction: "Review the CIM and write the key finding",
  timeline: ["Oct 30, email received: CIM received from Rachel Kim", "Oct 27, call: Owner is 58, retiring. 11 technicians."],
  documentNames: ["Dalton_CIM.pdf"],
  existing: { seller: ["Why sell now at 58?"], broker: [], self: [] },
};

describe("open questions", () => {
  it("has the three groups in order with their labels", () => {
    expect(QUESTION_GROUPS.map((g) => g.key)).toEqual(["seller", "broker", "self"]);
    expect(QUESTION_GROUPS.map((g) => g.label)).toEqual(["Ask the seller", "Ask the broker", "Find out myself"]);
  });

  it("reads the stored JSON (object or text), falls back to the old one-per-line text as seller questions, and gives empty groups otherwise", () => {
    expect(parseOpenQuestions({ seller: ["A?"], broker: ["B?"], self: [] })).toEqual({ seller: ["A?"], broker: ["B?"], self: [] });
    expect(parseOpenQuestions('{"seller":["A?"],"broker":[],"self":["C?"]}')).toEqual({ seller: ["A?"], broker: [], self: ["C?"] });
    expect(parseOpenQuestions(null, "Why sell?\n- Any customer over 10%?\n\n")).toEqual({ seller: ["Why sell?", "Any customer over 10%?"], broker: [], self: [] });
    expect(parseOpenQuestions(null, null)).toEqual(emptyQuestions());
    expect(parseOpenQuestions("not json", null)).toEqual(emptyQuestions());
    expect(parseOpenQuestions(["a list"], null)).toEqual(emptyQuestions());
  });

  it("cleans lines: trims, drops empty and repeated lines, caps the count and length", () => {
    const q = cleanQuestions({ seller: ["  A?  ", "", "a?", "B?"], broker: Array.from({ length: 20 }, (_, i) => `Q${i}`), self: "not a list" as unknown as string[] });
    expect(q.seller).toEqual(["A?", "B?"]);
    expect(q.broker).toHaveLength(12);
    expect(q.self).toEqual([]);
    expect(cleanQuestions({ seller: ["x".repeat(500)] }).seller[0]).toHaveLength(240);
    expect(countQuestions(q)).toBe(14);
  });

  it("merges new lines after the existing ones, skipping repeats in any letter case", () => {
    const { merged, added } = mergeQuestions({ seller: ["Why sell?"], broker: [], self: ["Market size?"] }, { seller: ["why sell?", "Would you stay?"], broker: ["Other bidders?"], self: [] });
    expect(merged).toEqual({ seller: ["Why sell?", "Would you stay?"], broker: ["Other bidders?"], self: ["Market size?"] });
    expect(added).toBe(2);
  });

  it("asks for JSON with the three groups, the deal facts, the timeline, the documents, and the questions already asked", () => {
    const p = questionsPrompt(ctx);
    expect(p).toContain("TASK: open_questions");
    expect(p).toContain("Deal: Dalton Services");
    expect(p).toContain("stage: CIM review");
    // Fix 2026-11-02: every fact as an exact figure (asking with the multiple), the listing text, and the no-false-gaps rule.
    expect(p).toContain("revenue: $5,600,000");
    expect(p).toContain("EBITDA: $1,700,000");
    expect(p).toContain("asking price: $6,000,000 (3.5x EBITDA)");
    expect(p).toContain("why selling: Retiring, no successor");
    expect(p).toContain("The owner works in the field two days a week");
    expect(p).toContain("Only say information is missing when it is absent from the facts and the listing text above; name the exact field and who to ask.");
    expect(p).toContain("Oct 27, call: Owner is 58");
    expect(p).toContain("Documents on file: Dalton_CIM.pdf");
    expect(p).toContain('"Why sell now at 58?"');
    expect(p).toContain('{"seller": ["..."], "broker": ["..."], "self": ["..."]}');
    expect(p).not.toContain("SDE:");
  });

  it("checks the reply strictly and says what is wrong", () => {
    expect(validateQuestionsReply({ seller: ["A?"], broker: [], self: ["C?"] })).toEqual({ ok: true, value: { seller: ["A?"], broker: [], self: ["C?"] } });
    expect(validateQuestionsReply(["A?"])).toMatchObject({ ok: false });
    expect(validateQuestionsReply({ seller: "A?", broker: [] })).toMatchObject({ ok: false, error: expect.stringContaining('"seller" is not a list') });
    expect((validateQuestionsReply({ seller: "A?", broker: [] }) as { error: string }).error).toContain('"self" is missing');
    expect(validateQuestionsReply({ seller: [], broker: [], self: [] })).toMatchObject({ ok: false, error: expect.stringContaining("every list is empty") });
    expect(validateQuestionsReply({ seller: [1], broker: [], self: [] })).toMatchObject({ ok: false, error: expect.stringContaining("not text") });
  });

  it("reads a plain-text reply (the reader's items) by its group headings; lines before any heading go to the seller", () => {
    const r = validateQuestionsReply({ items: ["Why sell now?", "Ask the broker:", "Can we get 3 years of financials?", "Are there other bidders?", "Find out myself", "Who are the local competitors?"] });
    expect(r).toEqual({ ok: true, value: { seller: ["Why sell now?"], broker: ["Can we get 3 years of financials?", "Are there other bidders?"], self: ["Who are the local competitors?"] } });
    expect(questionsFromLines(["Seller", "A?", "Broker", "B?"])).toEqual({ seller: ["A?"], broker: ["B?"], self: [] });
    expect(validateQuestionsReply({ items: [] })).toMatchObject({ ok: false });
  });

  it("asks for up to 5 to-dos and checks that reply too", () => {
    const p = todosPrompt(ctx, ["Ask for the customer list"]);
    expect(p).toContain("TASK: deal_todos");
    expect(p).toContain('"Ask for the customer list"');
    expect(p).toContain("Why sell now at 58?");
    expect(p).toContain('{"items": ["..."]}');
    expect(validateTodosReply({ items: ["A", " a ", "B", "C", "D", "E", "F"] })).toEqual({ ok: true, value: ["A", "B", "C", "D", "E"] });
    expect(validateTodosReply({ todos: ["Older key"] })).toEqual({ ok: true, value: ["Older key"] });
    expect(validateTodosReply(["Bare list"])).toEqual({ ok: true, value: ["Bare list"] });
    expect(validateTodosReply({ items: [] })).toEqual({ ok: true, value: [] });
    expect(validateTodosReply({ items: [1] })).toMatchObject({ ok: false, error: expect.stringContaining("not text") });
    expect(validateTodosReply("A")).toMatchObject({ ok: false, error: expect.stringContaining('"items"') });
  });

  it("drafts the email with the seller and broker groups as bullets under bold headings, to the first name", () => {
    const d = questionsEmailDraft({ dealName: "Dalton Services", toName: "Rachel Kim", questions: { seller: ["Why sell now at 58?", "Would you stay 12 months?"], broker: ["Is the asking firm?"], self: ["Local competitors?"] } });
    expect(d.subject).toBe("Dalton Services, questions");
    expect(d.body).toBe(["Hi Rachel,", "", "A few questions on Dalton Services as I work through it.", "", "**Ask the seller**", "- Why sell now at 58?", "- Would you stay 12 months?", "", "**Ask the broker**", "- Is the asking firm?", "", "Thanks,", "Bram"].join("\n"));
    expect(d.body).not.toContain("Local competitors");
    expect(questionsEmailDraft({ dealName: "X", toName: null, questions: { seller: [], broker: ["B?"], self: [] } }).body).toContain("Hi there,");
    expect(questionsEmailDraft({ dealName: "X", toName: null, questions: { seller: [], broker: ["B?"], self: [] } }).body).not.toContain("Ask the seller");
  });
});
