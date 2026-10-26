import { describe, expect, it } from "vitest";
import {
  GROUPED_ALERTS,
  groupedAlertStep,
  groupMovesByCount,
  isCommitmentTask,
  isReplacedPerItemAlert,
  isReviewTemplateTitle,
  movedNote,
  planRollover,
  resolveCloseReasons,
  scoreText,
  stageTaskIsCommitmentByDefault,
  tasksToReview,
  templateIsCommitmentByDefault,
} from "./commitment-rule";
import { completionScore } from "./scores";

describe("commitment classification", () => {
  it("treats only the review templates as commitments by default", () => {
    expect(isReviewTemplateTitle("Complete the daily close")).toBe(true);
    expect(isReviewTemplateTitle("Complete the weekly review")).toBe(true);
    expect(isReviewTemplateTitle("Complete the monthly review")).toBe(true);
    expect(isReviewTemplateTitle("Complete the quarterly review")).toBe(true);
    expect(templateIsCommitmentByDefault("Download the full data export (Settings, Export)")).toBe(false);
    expect(templateIsCommitmentByDefault("Import or enter transactions")).toBe(false);
    expect(templateIsCommitmentByDefault(null)).toBe(false);
  });

  it("makes only the next-action stage task a commitment by default", () => {
    expect(stageTaskIsCommitmentByDefault(true)).toBe(true);
    expect(stageTaskIsCommitmentByDefault(false)).toBe(false);
    expect(stageTaskIsCommitmentByDefault(null)).toBe(false);
  });

  it("classifies tasks by where they came from", () => {
    // Pipeline next action task and stage tasks
    expect(isCommitmentTask({ source: "pipeline", source_key: "pipeline:item:2026-10-26" })).toBe(true);
    expect(isCommitmentTask({ source: "pipeline", source_key: "stage-task:item:st" }, { stageTaskIsCommitment: true })).toBe(true);
    expect(isCommitmentTask({ source: "pipeline", source_key: "stage-task:item:st" }, { stageTaskIsCommitment: false })).toBe(false);
    expect(isCommitmentTask({ source: "pipeline", source_key: "set-next-action:item:stage" })).toBe(false);
    // Templates follow the template flag, or the review rule when the flag is unknown
    expect(isCommitmentTask({ source: "template", title: "Complete the weekly review" })).toBe(true);
    expect(isCommitmentTask({ source: "template", title: "Categorize new transactions" })).toBe(false);
    expect(isCommitmentTask({ source: "template", title: "Categorize new transactions" }, { templateIsCommitment: true })).toBe(true);
    // Regular tasks
    for (const source of ["manual", "follow_up", "connection", "review", "ai", "partner_report", "decision_condition", "missed_commitment", "milestone"]) {
      expect(isCommitmentTask({ source })).toBe(false);
    }
    // Connection tasks keep priority 1 but are still regular tasks
    expect(isCommitmentTask({ source: "connection", source_key: "reconnect:google:2026-10-26" })).toBe(false);
    // The owner can still mark a manual task as a commitment
    expect(isCommitmentTask({ source: "manual" }, { markedByOwner: true })).toBe(true);
  });
});

describe("rollover of regular tasks", () => {
  const today = "2026-10-26";
  const tasks = [
    { id: "a", status: "todo", due_date: "2026-10-25", times_moved: 0 },
    { id: "b", status: "todo", due_date: "2026-10-20", times_moved: 4 },
    { id: "c", status: "todo", due_date: "2026-10-25", times_moved: null },
    { id: "done", status: "done", due_date: "2026-10-25", times_moved: 0 },
    { id: "skipped", status: "skipped", due_date: "2026-10-25", times_moved: 0 },
    { id: "today", status: "todo", due_date: today, times_moved: 0 },
    { id: "future", status: "todo", due_date: "2026-10-30", times_moved: 0 },
    { id: "nodate", status: "todo", due_date: null, times_moved: 0 },
    { id: "commitment", status: "todo", due_date: "2026-10-24", times_moved: 0 },
  ];
  const moves = planRollover(tasks, new Set(["commitment"]), today);

  it("moves only open regular tasks that are past due, counting each move", () => {
    expect(moves.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(moves.find((m) => m.id === "a")?.times_moved).toBe(1);
    expect(moves.find((m) => m.id === "b")?.times_moved).toBe(5);
    expect(moves.find((m) => m.id === "c")?.times_moved).toBe(1);
  });

  it("never moves commitments", () => {
    expect(moves.some((m) => m.id === "commitment")).toBe(false);
  });

  it("groups moves into one update per new count", () => {
    const g = groupMovesByCount(moves);
    expect(g.get(1)?.sort()).toEqual(["a", "c"]);
    expect(g.get(5)).toEqual(["b"]);
  });

  it("shows a small note and lists tasks for the weekly review at the threshold", () => {
    expect(movedNote(0)).toBe("");
    expect(movedNote(null)).toBe("");
    expect(movedNote(1)).toBe("Moved 1 time");
    expect(movedNote(6)).toBe("Moved 6 times");
    const list = tasksToReview(
      [
        { id: "x", status: "todo", times_moved: 4 },
        { id: "y", status: "todo", times_moved: 5 },
        { id: "z", status: "todo", times_moved: 9 },
        { id: "d", status: "done", times_moved: 9 },
      ],
      5,
    );
    expect(list.map((t) => t.id)).toEqual(["z", "y"]);
    // An invalid threshold falls back to 5
    expect(tasksToReview([{ id: "y", status: "todo", times_moved: 5 }], 0).length).toBe(1);
  });
});

describe("grouped alerts", () => {
  it("inserts one alert when the count first goes above 0", () => {
    expect(groupedAlertStep("stalled", null, 3)).toEqual({ action: "insert", message: "3 pipeline items are stalled." });
    expect(groupedAlertStep("next_action", null, 1)).toEqual({ action: "insert", message: "1 pipeline item needs a next action." });
    expect(groupedAlertStep("stage_limit", null, 2)).toMatchObject({ action: "insert", message: expect.stringContaining("2 stage time limits passed") });
  });

  it("updates the same alert in place when the count changes, and leaves it when it does not", () => {
    const open = { id: "al", message: "3 pipeline items are stalled." };
    expect(groupedAlertStep("stalled", open, 3)).toEqual({ action: "none" });
    expect(groupedAlertStep("stalled", open, 2)).toEqual({ action: "update", id: "al", message: "2 pipeline items are stalled." });
  });

  it("resolves the alert when the count reaches 0", () => {
    expect(groupedAlertStep("next_action", { id: "al", message: "x" }, 0)).toEqual({ action: "resolve", id: "al" });
    expect(groupedAlertStep("next_action", null, 0)).toEqual({ action: "none" });
  });

  it("links to the filtered lists and the open decisions", () => {
    expect(GROUPED_ALERTS.next_action.href).toBe("/opportunities?filter=needs-next-action");
    expect(GROUPED_ALERTS.stalled.href).toBe("/opportunities?filter=stalled");
    expect(GROUPED_ALERTS.stage_limit.href).toBe("/plan/decisions");
  });

  it("finds the per-item alerts that grouping replaces", () => {
    const limitIds = new Set(["d1"]);
    expect(isReplacedPerItemAlert({ dedupe_key: "pipeline-next-action:item" }, limitIds)).toBe(true);
    expect(isReplacedPerItemAlert({ dedupe_key: "pipeline-stalled:item:2026-10-01" }, limitIds)).toBe(true);
    expect(isReplacedPerItemAlert({ dedupe_key: "decision:d1", related_type: "decisions", related_id: "d1" }, limitIds)).toBe(true);
    // Other decisions, missed commitments, and the grouped alerts themselves stay
    expect(isReplacedPerItemAlert({ dedupe_key: "decision:d2", related_type: "decisions", related_id: "d2" }, limitIds)).toBe(false);
    expect(isReplacedPerItemAlert({ dedupe_key: "miss:c:2026-10-25" }, limitIds)).toBe(false);
    expect(isReplacedPerItemAlert({ dedupe_key: "group:pipeline-stalled" }, limitIds)).toBe(false);
  });
});

describe("daily close: one reason can cover several misses", () => {
  const items = [
    { key: "c_1", label: "Deal A: Sign NDA" },
    { key: "c_2", label: "Deal B: Request CIM and financials" },
    { key: "t_1", label: "Network outreach" },
  ];

  it("applies the shared reason to every checked item", () => {
    const r = resolveCloseReasons(items, { shared_reason: "Broker call ran long", use_shared_c_1: "yes", use_shared_c_2: "yes", use_shared_t_1: "yes" });
    expect(r.missing).toEqual([]);
    expect(r.reasons).toEqual({ c_1: "Broker call ran long", c_2: "Broker call ran long", t_1: "Broker call ran long" });
  });

  it("uses an item's own reason instead of the shared one", () => {
    const r = resolveCloseReasons(items, { shared_reason: "Sick", use_shared_c_1: "yes", use_shared_c_2: "yes", use_shared_t_1: "yes", reason_t_1: "No contacts due" });
    expect(r.reasons.t_1).toBe("No contacts due");
    expect(r.reasons.c_1).toBe("Sick");
  });

  it("requires a reason for every unchecked item without its own reason", () => {
    const r = resolveCloseReasons(items, { shared_reason: "Sick", use_shared_c_1: "yes" });
    expect(r.missing.map((m) => m.key)).toEqual(["c_2", "t_1"]);
  });

  it("requires a reason when the shared reason is empty", () => {
    const r = resolveCloseReasons(items, { shared_reason: "   ", use_shared_c_1: "yes", use_shared_c_2: "yes", use_shared_t_1: "yes" });
    expect(r.missing.length).toBe(3);
  });

  it("accepts a reason saved earlier and cuts reasons to 200 characters", () => {
    const r = resolveCloseReasons([{ key: "t_1", label: "Network outreach", existingReason: "Given yesterday" }, { key: "c_1", label: "X" }], { reason_c_1: "y".repeat(300) });
    expect(r.missing).toEqual([]);
    expect(r.reasons.t_1).toBe("Given yesterday");
    expect(r.reasons.c_1.length).toBe(200);
  });

  it("needs nothing when nothing was missed", () => {
    expect(resolveCloseReasons([], {})).toEqual({ reasons: {}, missing: [] });
  });
});

describe("scores with the new definition", () => {
  it("shows No commitments instead of 0% or 100% when nothing was decided", () => {
    expect(scoreText(null)).toBe("No commitments");
    expect(scoreText(undefined)).toBe("No commitments");
    expect(scoreText(0)).toBe("0%");
    expect(scoreText(100)).toBe("100%");
  });

  it("leaves released commitments out of the score", () => {
    const s = completionScore(
      [
        { due_date: "2026-10-20", status: "met" },
        { due_date: "2026-10-21", status: "released" },
        { due_date: "2026-10-22", status: "released" },
      ],
      "2026-10-19",
      "2026-10-25",
    );
    expect(s).toEqual({ met: 1, missed: 0, total: 1, pct: 100 });
    const none = completionScore([{ due_date: "2026-10-21", status: "released" }], "2026-10-19", "2026-10-25");
    expect(none.pct).toBeNull();
    expect(none.total).toBe(0);
  });
});
