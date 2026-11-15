import { describe, expect, it } from "vitest";
import { cleanDrafts, draftsPrompt, draftTargets, NO_DRAFTS, validateDraftsReply } from "./report-drafts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("the 4:00 pm AI drafts (step 4, 2026-11-15)", () => {
  it("writes only what is empty or still an AI draft; typed, edited and kept text stays", () => {
    expect(draftTargets({ opening: "", tomorrow: "", drafts: NO_DRAFTS, pickIds: [A, B] })).toEqual({ opening: true, tomorrow: true, now: [A, B] });
    expect(draftTargets({ opening: "Typed by hand", tomorrow: "Typed", drafts: NO_DRAFTS, pickIds: [A] })).toEqual({ opening: false, tomorrow: false, now: [A] });
    const drafts = { at: "x", opening: true, tomorrow: false, now: { [A]: { text: "AI line", ai: true }, [B]: { text: "Kept line", ai: false } } };
    expect(draftTargets({ opening: "AI text", tomorrow: "Typed", drafts, pickIds: [A, B] })).toEqual({ opening: true, tomorrow: false, now: [A] });
  });

  it("keeps the saved drafts clean", () => {
    expect(cleanDrafts(null)).toEqual(NO_DRAFTS);
    expect(cleanDrafts({ at: "2026-11-15T21:00:00Z", opening: true, tomorrow: "yes", now: { [A]: { text: "  a  line ", ai: true }, "not-an-id": { text: "x", ai: true }, [B]: { text: "", ai: true } } })).toEqual({ at: "2026-11-15T21:00:00Z", opening: true, tomorrow: false, now: { [A]: { text: "a line", ai: true } } });
  });

  it("asks only for the parts it may write, with each pick's facts and its id", () => {
    const prompt = draftsPrompt({
      dateLabel: "Monday, Nov 16",
      tomorrowLabel: "Tomorrow",
      dayLines: ["listings screened: 4"],
      activity: ["Dalton Services: moved to Seller call"],
      picks: [
        { id: A, track: "Acquisition", name: "Dalton Services", stage: "Seller call", why: "Recurring contracts", nextAction: "Call the owner", nextActionDue: "2026-11-17", nextDecision: "Go or no-go by 2026-11-25", movedToday: true, waiting: "3 days on Rachel Kim for the CIM", notes: ["Owner wants out within a year"] },
        { id: B, track: "Job search", name: "COO, Acme", stage: "Interview", why: null, nextAction: null, nextActionDue: null, nextDecision: null, movedToday: false, waiting: null, notes: [] },
      ],
      dueNext: ["Call the owner (Dalton Services)"],
      want: { opening: false, tomorrow: true, now: [A] },
    });
    expect(prompt).toContain("TASK: report_drafts");
    expect(prompt).toContain("The signed-in user sends");
    expect(prompt).toContain(`- id ${A} | Acquisition | Dalton Services | stage Seller call (moved there today) | why it fits: Recurring contracts | next action: Call the owner (due 2026-11-17)`);
    expect(prompt).toContain("waiting: 3 days on Rachel Kim for the CIM | note: Owner wants out within a year | now: write");
    expect(prompt).toContain(`- id ${B} | Job search | COO, Acme | stage Interview | no next action set | now: keep`);
    expect(prompt).not.toContain('"opening"');
    expect(prompt).toContain('{"tomorrow": "...", "now": [{"id": "<id>", "text": "..."}]}');
  });

  it("reads the reply: the parts asked for, Now lines only for the ids asked, no dashes", () => {
    const want = { opening: true, tomorrow: true, now: [A] };
    const r = validateDraftsReply({ opening: "Most of today went to Dalton — the owner wants out.", tomorrow: "Call the owner at 10.", now: [{ id: A, text: "Seller call held; financials requested" }, { id: B, text: "not asked" }] }, want);
    expect(r).toEqual({ ok: true, value: { opening: "Most of today went to Dalton, the owner wants out.", tomorrow: "Call the owner at 10.", now: { [A]: "Seller call held; financials requested" } } });
    expect(validateDraftsReply({ tomorrow: "x" }, want)).toMatchObject({ ok: false });
    expect(validateDraftsReply({ opening: "x", tomorrow: "y", now: [] }, want)).toMatchObject({ ok: false });
    expect(validateDraftsReply({ opening: "x" }, { opening: true, tomorrow: false, now: [] })).toEqual({ ok: true, value: { opening: "x", tomorrow: null, now: {} } });
  });
});
