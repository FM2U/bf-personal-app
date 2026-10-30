import { describe, expect, it } from "vitest";
import {
  blockText,
  buildDayDetail,
  changesStepProblem,
  closeStep,
  dayState,
  emptyOutcome,
  initiativeLine,
  nextActionTasks,
  nextEmptyPosition,
  outcomeSlots,
  parseBlockMinutes,
  parseFocusedHours,
  pickableActions,
  waitingRows,
  type Outcome,
} from "./today";

const outcome = (position: number, title: string, extra: Partial<Outcome> = {}): Outcome => ({ ...emptyOutcome(position), title, ...extra });

describe("Today: outcomes", () => {
  it("fills three slots, keeps saved rows in their positions, and gives empty rows the last initiative", () => {
    const slots = outcomeSlots([outcome(2, "Call the broker", { initiativeId: "a" })], "a");
    expect(slots.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(slots[1].title).toBe("Call the broker");
    expect(slots[0].initiativeId).toBe("a");
    expect(slots[0].blockMinutes).toBe(60);
  });

  it("finds the next empty slot", () => {
    expect(nextEmptyPosition([outcome(1, "A"), outcome(2, "  "), outcome(3, "C")])).toBe(2);
    expect(nextEmptyPosition([outcome(1, "A"), outcome(2, "B"), outcome(3, "C")])).toBeNull();
  });

  it("reads a typed block in minutes or hours and shows it as minutes", () => {
    expect(parseBlockMinutes("90")).toBe(90);
    expect(parseBlockMinutes("90 min")).toBe(90);
    expect(parseBlockMinutes("1.5 h")).toBe(90);
    expect(parseBlockMinutes("1h30")).toBe(90);
    expect(parseBlockMinutes("2000")).toBe(1440);
    expect(parseBlockMinutes("")).toBeNull();
    expect(parseBlockMinutes("soon")).toBeNull();
    expect(blockText(90)).toBe("90 min");
    expect(blockText(null)).toBe("");
  });

  it("reads focused hours with one decimal, 0 to 24", () => {
    expect(parseFocusedHours("4")).toBe(4);
    expect(parseFocusedHours("2,5")).toBe(2.5);
    expect(parseFocusedHours("30")).toBe(24);
    expect(parseFocusedHours("")).toBeNull();
    expect(parseFocusedHours("four")).toBeNull();
  });
});

describe("Today: pick from next actions, next actions, waiting on", () => {
  const today = "2026-10-30";
  const tasks = [
    { id: "t1", title: "Send the LOI", due_date: "2026-10-29", initiative_id: "acq", pipeline_item_id: "i1", priority: 2 },
    { id: "t2", title: "Pay the storage bill", due_date: "2026-10-30", initiative_id: "fin", pipeline_item_id: null, priority: 1 },
    { id: "t3", title: "Complete the daily close", due_date: "2026-10-30", initiative_id: null, pipeline_item_id: null, priority: 2 },
    { id: "t4", title: "Next week", due_date: "2026-11-02", initiative_id: null, pipeline_item_id: null, priority: 1 },
    { id: "t5", title: "Review the CIM", due_date: "2026-10-30", initiative_id: null, pipeline_item_id: "i2", priority: 3 },
  ];
  const items = [
    { id: "i1", name: "Demo HVAC", next_action: "Send the LOI", next_action_due: "2026-10-29", initiative_id: "acq" },
    { id: "i3", name: "Demo Bakery", next_action: "Call the owner", next_action_due: "2026-10-30", initiative_id: "acq" },
    { id: "i4", name: "Demo Later", next_action: "Wait", next_action_due: "2026-11-05", initiative_id: "acq" },
  ];

  it("offers overdue tasks first, then today's by priority, then item actions without a task, never the close task", () => {
    const picks = pickableActions(tasks, items, [], today);
    expect(picks.map((p) => p.key)).toEqual(["task:t1", "task:t2", "task:t5", "item:i3"]);
    expect(picks[0].overdue).toBe(true);
    expect(picks[3].forName).toBe("Demo Bakery");
    expect(picks[3].initiativeId).toBe("acq");
  });

  it("leaves out tasks and items already used by an outcome", () => {
    const used = [outcome(1, "Send the LOI", { taskId: "t1", pipelineItemId: "i1" }), outcome(2, "Call", { pipelineItemId: "i3" })];
    expect(pickableActions(tasks, items, used, today).map((p) => p.key)).toEqual(["task:t2", "task:t5"]);
  });

  it("lists next actions due today or earlier, overdue first, without the close task", () => {
    expect(nextActionTasks(tasks, today).map((t) => t.id)).toEqual(["t1", "t2", "t5"]);
  });

  it("lists tasks waiting on someone, the longest wait first", () => {
    const rows = waitingRows([
      { id: "a", title: "LOI reply", status: "todo", waiting_on: "Broker Dan", waiting_since: "2026-10-24" },
      { id: "b", title: "NDA", status: "todo", waiting_on: "  ", waiting_since: "2026-10-20" },
      { id: "c", title: "Model review", status: "todo", waiting_on: "Sam", waiting_since: "2026-10-28" },
      { id: "d", title: "Done one", status: "done", waiting_on: "Pat", waiting_since: "2026-10-01" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(rows[0].who).toBe("Broker Dan");
  });
});

describe("Close the day", () => {
  it("uses the step in the address, otherwise the saved one, otherwise 1", () => {
    expect(closeStep("2", null)).toBe(2);
    expect(closeStep("9", 3)).toBe(3);
    expect(closeStep(undefined, "2")).toBe(2);
    expect(closeStep(undefined, undefined)).toBe(1);
  });

  it("requires tomorrow's top priority", () => {
    expect(changesStepProblem("  ")).toBe("Write tomorrow's top priority (one line).");
    expect(changesStepProblem("Finish the model")).toBeNull();
  });

  it("knows whether the day is open, closed, or a weekend", () => {
    expect(dayState(null, true)).toBe("open");
    expect(dayState({ status: "draft" }, true)).toBe("open");
    expect(dayState({ status: "completed" }, true)).toBe("closed");
    expect(dayState({ status: "completed" }, false)).toBe("closed");
    expect(dayState(null, false)).toBe("weekend");
  });
});

describe("The daily report content (day detail)", () => {
  const detail = buildDayDetail({
    date: "2026-10-30",
    focusedHours: 4,
    changes: "  The call moved.  ",
    tomorrow: "Finish the model",
    initiatives: [
      { id: "acq", name: "Acquisition Search" },
      { id: "con", name: "Consulting" },
      { id: "quiet", name: "Rosara" },
    ],
    outcomes: [outcome(2, "Call brokers", { initiativeId: "acq", status: "partial", resultNote: "One call" }), outcome(1, "Review the CIM", { initiativeId: "acq", status: "complete", blockMinutes: 90, actualMinutes: 75 }), outcome(3, "   ")],
    targets: [
      { name: "Listings screened", initiativeId: "acq", count: 12, required: 20, met: false, off: false, period: "day" },
      { name: "Network outreach", initiativeId: "acq", count: 3, required: 3, met: true, off: false, period: "day" },
      { name: "Weekend only", initiativeId: "acq", count: 0, required: 1, met: false, off: true, period: "day" },
    ],
    tasksDone: [{ initiativeId: "con", pipelineItemId: null }, { initiativeId: null, pipelineItemId: "hvac" }, { initiativeId: null, pipelineItemId: null }],
    items: [
      { id: "hvac", name: "Demo HVAC", initiativeId: "acq" },
      { id: "wash", name: "Demo Car Wash", initiativeId: "acq" },
    ],
    moves: [
      { itemId: "hvac", stage: "CIM review", pass: false, reason: null },
      { itemId: "wash", stage: "Passed", pass: true, reason: null },
    ],
    outreach: [{ pipelineItemId: "hvac" }, { pipelineItemId: null }],
    outreachInitiativeId: "acq",
  });

  it("lists the outcomes in position order, skipping empty rows, with the initiative name", () => {
    expect(detail.outcomes.map((o) => o.title)).toEqual(["Review the CIM", "Call brokers"]);
    expect(detail.outcomes[0]).toMatchObject({ status: "complete", initiative: "Acquisition Search", block: 90, actual: 75, result: null });
    expect(detail.outcomes[1].result).toBe("One call");
  });

  it("groups activity by initiative, leaves out quiet initiatives and inactive targets, and puts unlinked work under Other", () => {
    expect(detail.initiatives.map((g) => g.name)).toEqual(["Acquisition Search", "Consulting", "Other"]);
    const acq = detail.initiatives[0];
    expect(acq.targets.map((t) => t.name)).toEqual(["Listings screened", "Network outreach"]);
    expect(acq.tasksDone).toBe(1);
    expect(acq.moved).toEqual([{ item: "Demo HVAC", stage: "CIM review" }]);
    expect(acq.passes).toEqual([{ item: "Demo Car Wash", reason: null }]);
    expect(acq.outreach).toBe(2);
    expect(detail.initiatives[1].tasksDone).toBe(1);
    expect(detail.initiatives[2].tasksDone).toBe(1);
    // The Network outreach target already shows the count, so no separate outreach line.
    expect(initiativeLine(acq)).toBe("Acquisition Search: Listings screened 12 of 20; Network outreach 3 of 3; 1 task done; moved: Demo HVAC to CIM review; passed: Demo Car Wash");
    expect(initiativeLine({ name: "Rosara", targets: [], tasksDone: 0, moved: [], passes: [], outreach: 2 })).toBe("Rosara: 2 outreach messages sent");
  });

  it("trims the changes and tomorrow lines", () => {
    expect(detail.changes).toBe("The call moved.");
    expect(detail.tomorrow).toBe("Finish the model");
    expect(detail.focusedHours).toBe(4);
  });
});
