import { describe, expect, it } from "vitest";
import { answerPrompt, contextLabel, estimateCents, estimateLabel, fieldPrompt, isRecordPage, nextStepsPrompt, SUGGESTED_QUESTIONS, trimContext, validateAnswerReply, validateFieldReply, validateNextStepsReply } from "./ask-ai";

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
  });

  it("checks the answer reply: bullets required, at most six, an optional next action and email", () => {
    const r = validateAnswerReply({ bullets: ["- First", "Second", "", "3", "4", "5", "6", "7"], next_action: "Email Mark Reed", email: { subject: "Hi", body: "Hello\r\nthere" } });
    expect(r.ok && r.value.bullets).toEqual(["First", "Second", "3", "4", "5", "6"]);
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
