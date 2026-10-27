import { describe, expect, it } from "vitest";
import { approvalPatch, approvedKey, blockState, clock, dismissalPatch, dismissedKey, parseBlockKey, planBlocks, suggestKey } from "./time-blocks";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const DAY = "2026-10-27";
const tasks = [
  { id: T1, title: "Request financials" },
  { id: T2, title: "Draft IOI template" },
  { id: T3, title: "Call Lender A" },
];

describe("time blocks: state kept in the key", () => {
  it("suggested, approved, deleted, and added by hand", () => {
    expect(blockState({ dedupe_key: suggestKey(T1, DAY) })).toBe("suggested");
    expect(blockState({ dedupe_key: approvedKey(T1, DAY), google_event_id: "g1" })).toBe("approved");
    expect(blockState({ dedupe_key: dismissedKey(T1, DAY) })).toBe("dismissed");
    expect(blockState({ dedupe_key: null, google_event_id: null })).toBe("manual");
    expect(blockState({ dedupe_key: null, google_event_id: "g2" })).toBe("approved");
    expect(parseBlockKey(suggestKey(T2, DAY))).toEqual({ state: "suggested", taskId: T2, date: DAY });
    expect(parseBlockKey("review:daily:2026-10-27")).toBeNull();
  });
});

describe("time blocks: suggestions each morning", () => {
  it("one block per priority task, from 2 hours after the morning hour, 15 minutes apart", () => {
    const plan = planBlocks({ tasks, count: 2, minutes: 60, startMin: 9 * 60, taken: [] });
    expect(plan).toEqual([
      { taskId: T1, title: "Request financials", startMin: 540, endMin: 600 },
      { taskId: T2, title: "Draft IOI template", startMin: 615, endMin: 675 },
    ]);
    expect(clock(615)).toBe("10:15 AM");
  });
  it("skips tasks already approved or deleted today, counts approved blocks against the daily number, and starts after them", () => {
    const plan = planBlocks({ tasks, count: 2, minutes: 30, startMin: 540, taken: [{ taskId: T1, state: "approved", endMin: 660 }, { taskId: T2, state: "dismissed" }] });
    expect(plan).toEqual([{ taskId: T3, title: "Call Lender A", startMin: 675, endMin: 705 }]);
  });
  it("suggests nothing when the daily number is 0 or already approved, and never past 10 PM", () => {
    expect(planBlocks({ tasks, count: 0, minutes: 60, startMin: 540, taken: [] })).toEqual([]);
    expect(planBlocks({ tasks, count: 1, minutes: 60, startMin: 540, taken: [{ taskId: T1, state: "approved", endMin: 600 }] })).toEqual([]);
    expect(planBlocks({ tasks, count: 3, minutes: 60, startMin: 21 * 60 + 30, taken: [] })).toEqual([]);
  });
});

describe("time blocks: approval", () => {
  it("Approve keeps the Google event id and marks the block approved for that task and day", () => {
    expect(approvalPatch({ dedupe_key: suggestKey(T1, "2026-10-26"), task_id: T1 }, "g9", DAY)).toEqual({ google_event_id: "g9", dedupe_key: approvedKey(T1, "2026-10-26") });
    // A block added by hand for a task: approved for today.
    expect(approvalPatch({ dedupe_key: null, task_id: T2 }, "g10", DAY)).toEqual({ google_event_id: "g10", dedupe_key: approvedKey(T2, DAY) });
    expect(approvalPatch({ dedupe_key: null, task_id: null }, "g11", DAY)).toEqual({ google_event_id: "g11", dedupe_key: null });
  });
  it("Delete keeps a suggestion hidden (not suggested again that day); a block added by hand is removed", () => {
    expect(dismissalPatch({ dedupe_key: suggestKey(T1, DAY) })).toEqual({ dedupe_key: dismissedKey(T1, DAY) });
    expect(dismissalPatch({ dedupe_key: null })).toBeNull();
  });
});
