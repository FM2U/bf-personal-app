import { describe, expect, it } from "vitest";
import { answerPrompt, contextLabel, estimateCents, estimateLabel, fieldPrompt, isRecordPage, nextStepsPrompt, panelSpec, recordNoun, splitStepLine, SUGGESTED_QUESTIONS, tasksPrompt, trimContext, validateAnswerReply, validateFieldReply, validateNextStepsReply, nextActionPrompt, validateNextActionReply, NEXT_ACTION_MAX_DAYS } from "./ask-ai";

describe("the Ask AI panel", () => {
  it("has three suggested questions per page and knows the record pages", () => {
    for (const [page, qs] of Object.entries(SUGGESTED_QUESTIONS)) {
      expect(qs, page).toHaveLength(3);
      for (const q of qs) expect(q).not.toContain("—");
    }
    expect(isRecordPage("deal")).toBe(true);
    expect(isRecordPage("project")).toBe(true);
    expect(isRecordPage("home")).toBe(false);
  });

  it("keeps the context small and puts the page's lines in the prompts with the strict JSON asked for", () => {
    const c = trimContext({ title: "Deal: Dalton", lines: [" a  b ", "", "x".repeat(500), ...Array.from({ length: 100 }, (_, i) => `line ${i}`)] });
    expect(c.lines).toHaveLength(80);
    expect(c.lines[0]).toBe("a b");
    expect(c.lines[1]).toHaveLength(240);
    const p = nextStepsPrompt(c);
    expect(p).toContain("TASK: next_steps");
    expect(p).toContain("- a b");
    expect(p).toContain('"steps"');
    const q = answerPrompt(c, 'What should I do "first"?', true);
    expect(q).toContain("TASK: ask_page");
    expect(q).toContain("What should I do 'first'?");
    expect(q).toContain("email: {subject, body}");
    expect(answerPrompt(c, "x", false)).toContain("Set email to null");
    const f = fieldPrompt(c, { key: "next_action", label: "Next action", current: "Call him" });
    expect(f).toContain("TASK: field_draft");
    expect(f).toContain("Call him");
    expect(fieldPrompt(c, { key: "weekly_focus", label: "Weekly focus" })).toContain("The field is empty.");
  });

  it("checks the next steps reply: at most three, no repeats, text required", () => {
    const r = validateNextStepsReply({ steps: [{ text: "Email Mark", reason: "11 days quiet" }, { text: "email mark", reason: "dup" }, { text: "Call Monday" }, { text: "Send the buy box" }, { text: "Fifth" }] });
    expect(r.ok && r.value).toEqual([{ text: "Email Mark", reason: "11 days quiet" }, { text: "Call Monday", reason: "" }, { text: "Send the buy box", reason: "" }]);
    expect(validateNextStepsReply({ steps: [] }).ok).toBe(false);
    expect(validateNextStepsReply({ nope: 1 }).ok).toBe(false);
    expect(validateNextStepsReply(["Plain line"]).ok && (validateNextStepsReply(["Plain line"]) as { value: { text: string }[] }).value[0].text).toBe("Plain line");
    // A plain-text reply read as {items}: "step: reason" and "step (reason)" split; a bare line is a step without a reason.
    const plain = validateNextStepsReply({ items: ["Email Mark Reed: he has been quiet for 11 days", "Book the seller call (the CIM is read)", "Write the key finding"] });
    expect(plain.ok && plain.value).toEqual([{ text: "Email Mark Reed", reason: "he has been quiet for 11 days" }, { text: "Book the seller call", reason: "the CIM is read" }, { text: "Write the key finding", reason: "" }]);
    expect(splitStepLine("See https://example.com")).toEqual({ text: "See https://example.com", reason: "" });
  });

  it("reads a plain-text answer (the reader's items or text) as the bullets", () => {
    const r = validateAnswerReply({ items: ["Meridian first", "Then Dalton"] });
    expect(r.ok && r.value.bullets).toEqual(["Meridian first", "Then Dalton"]);
    const t = validateAnswerReply({ text: "Nothing is due." });
    expect(t.ok && t.value).toEqual({ bullets: ["Nothing is due."], nextAction: null, email: null });
  });

  it("checks the answer reply: bullets required, at most six, an optional next action and email", () => {
    const r = validateAnswerReply({ bullets: ["- First", "* Second", "", "**Third:** kept bold", "4", "5", "6", "7"], next_action: "Email Mark Reed", email: { subject: "Hi", body: "Hello\r\nthere" } });
    expect(r.ok && r.value.bullets).toEqual(["First", "Second", "**Third:** kept bold", "4", "5", "6"]);
    expect(r.ok && r.value.nextAction).toBe("Email Mark Reed");
    expect(r.ok && r.value.email).toEqual({ subject: "Hi", body: "Hello\nthere" });
    const bare = validateAnswerReply({ bullets: "One line", email: null });
    expect(bare.ok && bare.value).toEqual({ bullets: ["One line"], nextAction: null, email: null });
    expect(validateAnswerReply({ bullets: [] }).ok).toBe(false);
    expect(validateAnswerReply("text").ok).toBe(false);
    expect(validateFieldReply({ text: "  Call Rita  " })).toEqual({ ok: true, value: "Call Rita" });
    expect(validateFieldReply({ text: "" }).ok).toBe(false);
  });

  it("estimates the cost in cents and labels it; no label without price figures", () => {
    expect(estimateCents(4000, 500, 3, 15)).toBeCloseTo(((1400 * 3 + 500 * 15) / 1_000_000) * 100, 6);
    expect(estimateLabel(0.2)).toBe("under 1 cent");
    expect(estimateLabel(1.2)).toBe("about 1 cent");
    expect(estimateLabel(2.6)).toBe("about 3 cents");
    expect(estimateLabel(null)).toBeNull();
    expect(contextLabel({ label: "Work on now", card: "Next actions" })).toBe("Context: Next actions, Work on now");
    expect(contextLabel({ label: "Rosara", field: { key: "weekly_focus", label: "Weekly focus" } })).toBe("Context: the Weekly focus field, Rosara");
    expect(contextLabel({ label: "Deals" })).toBe("Context: Deals");
  });
});

describe("the panel about a card or a field (Edit batch B, item 3)", () => {
  const deal = { page: "deal" as const, recordId: "11111111-1111-4111-8111-111111111111", label: "Dalton Services" };

  it("from the page pill: the page's questions, next steps only on a record page", () => {
    const home = panelSpec({ page: "home", label: "Work on now" });
    expect(home.title).toBe("Ask AI");
    expect(home.questions).toEqual([...SUGGESTED_QUESTIONS.home]);
    expect(home.suggest).toBeNull();
    expect(home.askHeading).toBe("Ask about this page");
    const d = panelSpec(deal);
    expect(d.questions).toEqual([...SUGGESTED_QUESTIONS.deal]);
    expect(d.suggest).toMatchObject({ kind: "next_steps", use: "Set as next action" });
  });

  it("from the Tasks card star: the title, questions about the tasks, Suggest tasks for this deal, Add as a task", () => {
    const s = panelSpec({ ...deal, card: "Tasks" });
    expect(s.title).toBe("Ask AI about Tasks");
    expect(s.sub).toBe("Context: Tasks, Dalton Services");
    expect(s.questions).toHaveLength(3);
    expect(s.questions[1]).toBe("Which task is missing on this deal?");
    expect(s.suggest).toEqual({ kind: "tasks", heading: "Suggested tasks", button: "Suggest tasks for this deal", use: "Add as a task" });
    expect(s.askHeading).toBe("Ask about Tasks");
    expect(panelSpec({ page: "person", recordId: deal.recordId, label: "Mark Reed", card: "Tasks" }).suggest?.button).toBe("Suggest tasks for this person");
  });

  it("from the Open questions and Next actions stars", () => {
    expect(panelSpec({ ...deal, card: "Open questions" }).suggest).toMatchObject({ kind: "questions", button: "Suggest questions" });
    const home = panelSpec({ page: "home", label: "Work on now", card: "Next actions" });
    expect(home.title).toBe("Ask AI about Next actions");
    expect(home.suggest).toMatchObject({ kind: "next_steps", button: "Suggest next steps" });
    expect(home.questions[0]).toBe("Which of these should I do first?");
  });

  it("from a field star: the title names the field, questions about it, no next steps (the draft is the section)", () => {
    const f = panelSpec({ ...deal, field: { key: "key_finding", label: "Key finding" } });
    expect(f.title).toBe("Ask AI about the Key finding field");
    expect(f.questions).toEqual(["What should the Key finding say?", "What is missing before the Key finding can be written?", "Write the Key finding in half the words"]);
    expect(f.suggest).toBeNull();
    expect(f.askHeading).toBe("Ask about the Key finding");
  });

  it("asks for tasks with the record's noun and the page context", () => {
    const p = tasksPrompt({ title: "Deal: Dalton Services", lines: ["task: Read the CIM"] }, "deal");
    expect(p).toContain("Suggest tasks for this deal");
    expect(p).toContain("task: Read the CIM");
    expect(recordNoun("consulting_item")).toBe("engagement");
    expect(recordNoun("listings")).toBe("page");
  });
});

/** Edit batch C round 2, item 3: the next action star. */
describe("the next action star", () => {
  const today = "2026-11-04"; // a Wednesday
  it("opens the panel about the Next action card with its own suggestion (one action and a due date)", () => {
    for (const page of ["deal", "project", "opportunity", "consulting_item"] as const) {
      const spec = panelSpec({ page, recordId: "x", label: "X", card: "Next action" });
      expect(spec.suggest).toMatchObject({ kind: "next_action", heading: "Suggested next action", use: "Use this" });
      expect(spec.title).toBe("Ask AI about Next action");
      expect(spec.questions).toHaveLength(3);
    }
    const p = panelSpec({ page: "person", recordId: "x", label: "Mark Reed", card: "Next follow-up" });
    expect(p.suggest).toMatchObject({ kind: "next_action", heading: "Suggested next follow-up", use: "Use this" });
  });
  it("asks for the step, a due date, minutes, and a reason, from the stage, its default, the timeline, and the tasks", () => {
    const c = { title: "Deal: Dalton", lines: ["deal: Dalton | stage CIM review", "stage default next action: Ask for the seller call (due in 3 days)", "task: Read the CIM"] };
    const p = nextActionPrompt(c, today, "action", "deal");
    expect(p).toContain("TASK: next_action");
    expect(p).toContain("Today is Wednesday, 2026-11-04.");
    expect(p).toContain("stage default next action: Ask for the seller call");
    expect(p).toContain('"due": "YYYY-MM-DD"');
    expect(p).toContain("Minutes: about how long");
    expect(p).not.toContain("—");
    const f = nextActionPrompt(c, today, "follow_up", "person");
    expect(f).toContain("next follow-up with this person");
    expect(f).toContain("Set minutes to null.");
  });
  it("reads a good reply", () => {
    expect(validateNextActionReply({ action: "Call Carla about the seller call", due: "2026-11-06", minutes: 30, reason: "The CIM is read" }, today)).toEqual({ ok: true, value: { action: "Call Carla about the seller call", due: "2026-11-06", minutes: 30, reason: "The CIM is read" } });
  });
  it("accepts other key names and a number of days", () => {
    const r = validateNextActionReply({ what_for: "Check in about the Q1 work", due_in_days: 2 }, today, "follow_up");
    expect(r).toEqual({ ok: true, value: { action: "Check in about the Q1 work", due: "2026-11-06", minutes: null, reason: "" } });
    expect(validateNextActionReply([{ next_action: "Send the NDA", due_date: "2026-11-05" }], today)).toMatchObject({ ok: true, value: { action: "Send the NDA", due: "2026-11-05" } });
  });
  it("keeps the date sensible: not before today, not past 60 days, a weekend moves to Monday", () => {
    expect(validateNextActionReply({ action: "x", due: "2026-10-01" }, today)).toMatchObject({ value: { due: today } });
    expect(validateNextActionReply({ action: "x", due: "2027-06-01" }, today)).toMatchObject({ ok: true });
    const far = validateNextActionReply({ action: "x", due: "2027-06-01" }, today);
    expect(far.ok && far.value.due <= "2027-01-05").toBe(true);
    expect(NEXT_ACTION_MAX_DAYS).toBe(60);
    expect(validateNextActionReply({ action: "x", due: "2026-11-07" }, today)).toMatchObject({ value: { due: "2026-11-09" } });
    expect(validateNextActionReply({ action: "x", due: "2026-11-08" }, today)).toMatchObject({ value: { due: "2026-11-09" } });
  });
  it("keeps minutes only between 5 and 480 and never for a person", () => {
    expect(validateNextActionReply({ action: "x", due: today, minutes: 2 }, today)).toMatchObject({ value: { minutes: null } });
    expect(validateNextActionReply({ action: "x", due: today, minutes: 45.4 }, today)).toMatchObject({ value: { minutes: 45 } });
    expect(validateNextActionReply({ action: "x", due: today, minutes: null }, today)).toMatchObject({ value: { minutes: null } });
    expect(validateNextActionReply({ action: "x", due: today, minutes: 30 }, today, "follow_up")).toMatchObject({ value: { minutes: null } });
  });
  it("refuses a reply without an action or a readable date (the call asks again)", () => {
    expect(validateNextActionReply({ due: today }, today)).toMatchObject({ ok: false });
    expect(validateNextActionReply({ action: "x", due: "next Tuesday" }, today)).toEqual({ ok: false, error: 'the reply needs a "due" date as YYYY-MM-DD' });
    expect(validateNextActionReply("Call him tomorrow", today)).toMatchObject({ ok: false });
    expect(validateNextActionReply(null, today)).toMatchObject({ ok: false });
  });
  it("cuts a long action and drops a list mark", () => {
    const r = validateNextActionReply({ action: `- ${"word ".repeat(80)}`, due: today }, today);
    expect(r.ok && r.value.action.length).toBe(160);
    expect(r.ok && r.value.action.startsWith("word")).toBe(true);
  });
});
