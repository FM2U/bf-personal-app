import { describe, expect, it } from "vitest";
import { cleanDrafts, draftsPrompt, OPENING_EXAMPLE, tidyOpening, draftTargets, NO_DRAFTS, validateDraftsReply, withoutPlaceholders } from "./report-drafts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("the 4:00 pm AI drafts (step 4, 2026-11-15)", () => {
  it("writes only what is empty or still an AI draft; typed, edited and kept text stays", () => {
    expect(draftTargets({ opening: "", tomorrow: "", drafts: NO_DRAFTS, recordIds: [A, B] })).toEqual({ opening: true, tomorrow: true, today: [A, B] });
    expect(draftTargets({ opening: "Typed by hand", tomorrow: "Typed", drafts: NO_DRAFTS, recordIds: [A] })).toEqual({ opening: false, tomorrow: false, today: [A] });
    const drafts = { at: "x", opening: true, tomorrow: false, now: {}, today: { [A]: { text: "AI line", ai: true }, [B]: { text: "Kept line", ai: false } } };
    expect(draftTargets({ opening: "AI text", tomorrow: "Typed", drafts, recordIds: [A, B] })).toEqual({ opening: true, tomorrow: false, today: [A] });
  });

  it("keeps the saved drafts clean (the old Now lines are read but no longer drafted)", () => {
    expect(cleanDrafts(null)).toEqual(NO_DRAFTS);
    expect(cleanDrafts({ at: "2026-11-15T21:00:00Z", opening: true, tomorrow: "yes", now: { [A]: { text: "  a  line ", ai: true }, "not-an-id": { text: "x", ai: true }, [B]: { text: "", ai: true } }, today: { [B.toUpperCase()]: { text: "signed the NDA", ai: false } } })).toEqual({ at: "2026-11-15T21:00:00Z", opening: true, tomorrow: false, now: { [A]: { text: "a line", ai: true } }, today: { [B]: { text: "signed the NDA", ai: false } } });
  });

  it("asks for each record worked on today's Today line from its kept rows (release 4)", () => {
    const prompt = draftsPrompt({
      dateLabel: "Monday, Nov 16",
      tomorrowLabel: "Tomorrow",
      dayLines: ["listings screened: 4"],
      activity: ["Dalton Services: Moved from Broker call to Seller call"],
      records: [
        { id: A, track: "Acquisition", name: "Dalton Services", stage: "Seller call", topPriority: 1, newToday: false, moved: "moved from Broker call today", activity: ["Moved from Broker call to Seller call", "Deal structure, 60 min"], nextAction: "Call the owner", nextActionDue: "2026-11-17", waiting: "3 days on Rachel Kim for the CIM", notes: ["Owner wants out within a year"] },
        { id: B, track: "Job search", name: "COO, Acme", stage: "Interview", topPriority: null, newToday: true, moved: null, activity: ["Call with Dana, 45 min"], nextAction: null, nextActionDue: null, waiting: null, notes: [] },
      ],
      dueNext: ["Call the owner (Dalton Services)"],
      want: { opening: false, tomorrow: true, today: [A] },
    });
    expect(prompt).toContain("TASK: report_drafts");
    expect(prompt).toContain("The signed-in user sends");
    expect(prompt).toContain(`- id ${A} | Acquisition | Dalton Services | top priority 1 | stage Seller call | moved from Broker call today | done today: Moved from Broker call to Seller call | done today: Deal structure, 60 min | next action: Call the owner (due 2026-11-17)`);
    expect(prompt).toContain("waiting: 3 days on Rachel Kim for the CIM | note: Owner wants out within a year | today: write");
    expect(prompt).toContain(`- id ${B} | Job search | COO, Acme | new today | stage Interview | done today: Call with Dana, 45 min | no next action set | today: keep`);
    expect(prompt).not.toContain('"opening"');
    expect(prompt).toContain('{"tomorrow": "...", "today": [{"id": "<id>", "text": "..."}]}');
  });

  it("reads the reply: the parts asked for, Today lines only for the ids asked, no dashes", () => {
    const want = { opening: true, tomorrow: true, today: [A] };
    const r = validateDraftsReply({ opening: "Most of today went to Dalton — the owner wants out.", tomorrow: "Call the owner at 10.", today: [{ id: A, text: "seller call held; financials requested" }, { id: B, text: "not asked" }] }, want);
    expect(r).toEqual({ ok: true, value: { opening: "Most of today went to Dalton, the owner wants out.", tomorrow: "Call the owner at 10.", today: { [A]: "seller call held; financials requested" } } });
    expect(validateDraftsReply({ tomorrow: "x" }, want)).toMatchObject({ ok: false });
    expect(validateDraftsReply({ opening: "x", tomorrow: "y", today: [] }, want)).toMatchObject({ ok: false });
    expect(validateDraftsReply({ opening: "x" }, { opening: true, tomorrow: false, today: [] })).toEqual({ ok: true, value: { opening: "x", tomorrow: null, today: {} } });
  });

  it("never passes the '00 ' start of a listing name to the AI (2026-11-16)", () => {
    expect(withoutPlaceholders("deals moved: 2 (00 AI-Enabled Back-Office to NDA signed; Industrial Crating to NDA signed)")).toBe("deals moved: 2 (AI-Enabled Back-Office to NDA signed; Industrial Crating to NDA signed)");
    expect(withoutPlaceholders("00 Established Testing Laboratory: moved to Interested")).toBe("Established Testing Laboratory: moved to Interested");
    expect(withoutPlaceholders("calls: 0; emails: 1")).toBe("calls: 0; emails: 1");
    expect(withoutPlaceholders("Call Mark at 4:00 pm (Summit)")).toBe("Call Mark at 4:00 pm (Summit)");
  });

  it("asks the opening for a bold heading per kind of work with bullets under it, no lead line, the mockup's example, no repeated counts (2026-11-23)", () => {
    const prompt = draftsPrompt({ dateLabel: "Mon", tomorrowLabel: "Tomorrow", dayLines: [], activity: [], records: [], dueNext: [], want: { opening: true, tomorrow: false, today: [] } });
    expect(prompt).not.toContain("2 or 3 plain sentences");
    expect(prompt).not.toContain("Today was mostly");
    expect(prompt).toContain("No lead line");
    expect(prompt).toContain("in your own short wording");
    expect(prompt).toContain("no hours and no minutes");
    expect(prompt).toContain("never a number that repeats a figure in the today box");
    for (const l of OPENING_EXAMPLE.split("\n")) expect(prompt).toContain(l);
  });

  it("keeps the opening's lines, bold marks and bullets from the reply", () => {
    const r = validateDraftsReply({ opening: "**Seller calls on two deals**\n\n- Two calls — both moved.\n**Job search**\n• Found three options.\n- **Broken: no closing mark" }, { opening: true, tomorrow: false, today: [] });
    expect(r).toEqual({ ok: true, value: { opening: "**Seller calls on two deals**\n- Two calls, both moved.\n**Job search**\n- Found three options.\n- Broken: no closing mark", tomorrow: null, today: {} } });
    expect(tidyOpening("**Job search**\\n- found x")).toBe("**Job search**\n- found x");
  });
});
