import { describe, expect, it } from "vitest";
import { chaseDraft, dayInStage, daysLabel, daysWaiting, doneOutcome, dueLabel, nextStageName, progressSegments, STAGE_DEFAULTS, stageIndex, waitLevel, WORK_STAGES } from "./stages";

describe("the nine stages", () => {
  it("are in the approved order with a default next action each", () => {
    expect(WORK_STAGES).toEqual(["Interested", "NDA signed", "Broker call", "CIM review", "Seller call", "Model", "Partner presentation", "IOI or LOI", "Diligence"]);
    for (const s of WORK_STAGES) expect(STAGE_DEFAULTS[s].title.length).toBeGreaterThan(5);
    expect(STAGE_DEFAULTS.Interested).toMatchObject({ title: "Sign the NDA and ask the broker for a call", dueInDays: 1 });
    expect(STAGE_DEFAULTS["IOI or LOI"].dueInDays).toBe(7);
    expect(STAGE_DEFAULTS.Diligence.dueInDays).toBe(14);
  });

  it("progress mark: done before, gold on the current one, gray after; all gray for Passed", () => {
    expect(progressSegments("CIM review")).toEqual(["done", "done", "done", "current", "todo", "todo", "todo", "todo", "todo"]);
    expect(progressSegments("Interested")[0]).toBe("current");
    expect(progressSegments("Passed").every((s) => s === "todo")).toBe(true);
    expect(stageIndex("Lost")).toBe(-1);
  });

  it("knows the next stage", () => {
    expect(nextStageName("CIM review")).toBe("Seller call");
    expect(nextStageName("Diligence")).toBeNull();
    expect(nextStageName("Passed")).toBeNull();
  });
});

describe("Done on a next action", () => {
  it("asks to move when the action is the stage's default (any letter case), otherwise clears", () => {
    expect(doneOutcome({ stageName: "Seller call", nextAction: "Ask for tax returns and start the model", defaultTitle: "Ask for tax returns and start the model" })).toEqual({ kind: "ask", nextStage: "Model" });
    expect(doneOutcome({ stageName: "Seller call", nextAction: "ask for tax returns and start the model ", defaultTitle: "Ask for tax returns and start the model" })).toEqual({ kind: "ask", nextStage: "Model" });
    expect(doneOutcome({ stageName: "CIM review", nextAction: "Review the CIM and write the key finding", defaultTitle: STAGE_DEFAULTS["CIM review"].title })).toEqual({ kind: "clear" });
    expect(doneOutcome({ stageName: "Diligence", nextAction: STAGE_DEFAULTS.Diligence.title, defaultTitle: STAGE_DEFAULTS.Diligence.title })).toEqual({ kind: "clear" });
    expect(doneOutcome({ stageName: "Model", nextAction: null, defaultTitle: "Book the partner meeting" })).toEqual({ kind: "clear" });
  });
});

describe("waiting on someone", () => {
  it("counts days and colors them: amber at the threshold, red at double", () => {
    expect(daysWaiting("2026-10-19", "2026-10-30")).toBe(11);
    expect(daysWaiting(null, "2026-10-30")).toBe(0);
    expect(waitLevel("Mark Reed", 11)).toBe("red");
    expect(waitLevel("Dana", 6)).toBe("amber");
    expect(waitLevel("Dana", 5)).toBe("amber");
    expect(waitLevel("Dana", 4)).toBe("quiet");
    expect(waitLevel("Dana", 10)).toBe("red");
    expect(waitLevel("", 30)).toBe("none");
    expect(waitLevel("Dana", 7, 7)).toBe("amber");
    expect(waitLevel("Dana", 13, 7)).toBe("amber");
    expect(waitLevel("Dana", 14, 7)).toBe("red");
  });

  it("labels days and the day in stage", () => {
    expect(daysLabel(0)).toBe("Today");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(6)).toBe("6 days");
    expect(dayInStage("2026-10-27T14:00:00Z", "2026-10-30", (ts) => ts.slice(0, 10))).toBe(4);
    expect(dayInStage(null, "2026-10-30", (ts) => ts.slice(0, 10))).toBe(1);
  });

  it("drafts the chase email to the contact's first name", () => {
    const d = chaseDraft({ dealName: "Summit Logistics Group", waitingOn: "A seller call to be scheduled", contactName: "Mark Reed", days: 11 });
    expect(d.subject).toBe("Following up on Summit Logistics Group");
    expect(d.body).toContain("Hi Mark,");
    expect(d.body).toContain("a seller call to be scheduled");
    expect(d.body).toContain("11 days");
    expect(d.body).not.toMatch(/[\u2013\u2014]/);
    expect(chaseDraft({ dealName: "X", waitingOn: null, contactName: null, days: 1 }).body).toContain("Hi there,");
  });
});

describe("due labels", () => {
  const fmt = (d: string) => d;
  it("says Today, Yesterday, N days late, Tomorrow, or the date", () => {
    expect(dueLabel("2026-10-30", "2026-10-30", fmt)).toEqual({ text: "Today", tone: "today" });
    expect(dueLabel("2026-10-29", "2026-10-30", fmt)).toEqual({ text: "Yesterday", tone: "over" });
    expect(dueLabel("2026-10-27", "2026-10-30", fmt)).toEqual({ text: "3 days late", tone: "over" });
    expect(dueLabel("2026-10-31", "2026-10-30", fmt)).toEqual({ text: "Tomorrow", tone: "later" });
    expect(dueLabel("2026-11-03", "2026-10-30", fmt)).toEqual({ text: "2026-11-03", tone: "later" });
    expect(dueLabel(null, "2026-10-30", fmt)).toEqual({ text: "No date", tone: "none" });
  });
});
