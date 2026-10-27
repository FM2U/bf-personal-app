import { describe, expect, it } from "vitest";
import { emptyProposal, newChecklist, newGoal, newMilestone, newRecurringTask, normalizeDraft, selectedCount, validateStep, type DraftState } from "./draft";
import { includeAll, validateForApproval } from "./proposal";

const blank = (): DraftState => {
  const p = emptyProposal();
  return { proposal: p, include: includeAll(p) };
};

describe("initiative drafts in the step-by-step setup", () => {
  it("a half-filled draft is read with what it has", () => {
    const s = normalizeDraft({ proposal: { initiative: { name: "Walk", purpose: "" }, goals: [{ title: "Walk 3 times a week", deadline: "2027-01-01" }], milestones: [{ title: "" }] }, include: { goals: [false] } });
    expect(s).not.toBeNull();
    expect(s!.proposal.initiative.name).toBe("Walk");
    expect(s!.proposal.goals[0].comparison).toBe("lte");
    expect(s!.proposal.milestones[0].due_date).toBe("");
    expect(s!.include.goals).toEqual([false]);
    expect(s!.include.milestones).toEqual([true]);
    expect(normalizeDraft(null)).toBeNull();
    expect(normalizeDraft({ include: {} })).toBeNull();
  });
  it("Save checks only the current step's included items", () => {
    const s = blank();
    expect(validateStep(s, "name")).toMatch(/give the initiative a name/);
    s.proposal.initiative.name = "Morning walk";
    expect(validateStep(s, "name")).toBeNull();
    s.proposal.goals.push({ ...newGoal("2026-10-27"), title: "" });
    s.include.goals.push(true);
    expect(validateStep(s, "goals")).toMatch(/^Goal 1:/);
    s.include.goals[0] = false;
    expect(validateStep(s, "goals")).toBeNull();
    expect(validateStep(s, "tasks")).toBeNull();
  });
  it("a milestone needs an included goal", () => {
    const s = blank();
    s.proposal.milestones.push({ ...newMilestone("2026-10-27"), title: "First walk", completion_test: "Walked once" });
    s.include.milestones.push(true);
    expect(validateStep(s, "milestones")).toMatch(/belongs to a goal/);
    s.proposal.goals.push({ ...newGoal("2026-10-27"), title: "Walk weekly" });
    s.include.goals.push(true);
    expect(validateStep(s, "milestones")).toBeNull();
  });
  it("blank items need their words before they pass", () => {
    const s = blank();
    s.proposal.recurring_tasks.push(newRecurringTask());
    s.include.recurring_tasks.push(true);
    expect(validateStep(s, "tasks")).toMatch(/^Recurring task 1:/);
    s.proposal.checklists.push(newChecklist());
    s.include.checklists.push(true);
    expect(validateStep(s, "plan")).toMatch(/^Checklist 1:/);
  });
  it("an initiative added manually can be approved with only a name", () => {
    const s = blank();
    expect(validateForApproval(s.proposal).ok).toBe(false);
    s.proposal.initiative.name = "Morning walk";
    expect(validateForApproval(s.proposal).ok).toBe(true);
    expect(selectedCount(s)).toEqual({ selected: 1, total: 1 });
  });
});
