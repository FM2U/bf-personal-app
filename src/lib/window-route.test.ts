import { describe, expect, it } from "vitest";
import {
  fullPageHref,
  hrefToView,
  nextStep,
  parentView,
  parseWindowParam,
  previousStep,
  SETUP_STEPS,
  stepForField,
  stepPosition,
  windowParam,
  windowSize,
  withWindow,
  workPosition,
  type WindowView,
} from "./window-route";

const ID = "3f2b8c1e-1234-4abc-9def-0123456789ab";
const ID2 = "9a8b7c6d-1234-4abc-9def-0123456789ab";

describe("window addresses", () => {
  it("every view survives the round trip through its w parameter", () => {
    const views: WindowView[] = [
      { kind: "record", table: "initiatives", id: ID },
      { kind: "edit", table: "goals", id: ID },
      { kind: "new", table: "milestones", prefill: { goal_id: ID } },
      { kind: "new", table: "tasks", prefill: {} },
      { kind: "draft", id: ID },
      { kind: "setup", draftId: null, manual: false },
      { kind: "setup", draftId: null, manual: true },
      { kind: "setup", draftId: ID, step: "goals" },
      { kind: "work", taskId: null },
      { kind: "work", taskId: ID },
      { kind: "plan", initiativeId: ID },
    ];
    for (const v of views) expect(parseWindowParam(windowParam(v))).toEqual(v);
  });
  it("anything else is no window", () => {
    for (const w of [null, "", "r/initiatives", `r/not_a_table/${ID}`, "r/initiatives/not-an-id", `setup/${ID}/nowhere`, "work/abc", "x/y", `e/tasks/${ID}/more`]) expect(parseWindowParam(w)).toBeNull();
  });
  it("adds and removes the window on the page address, keeping the page's own parameters", () => {
    expect(withWindow("/opportunities/p1?view=list", { kind: "record", table: "pipeline_items", id: ID })).toBe(`/opportunities/p1?view=list&w=r%2Fpipeline_items%2F${ID}`);
    expect(withWindow(`/plan?w=r%2Finitiatives%2F${ID}`, { kind: "edit", table: "initiatives", id: ID })).toBe(`/plan?w=e%2Finitiatives%2F${ID}`);
    expect(withWindow(`/?w=work&x=1`, null)).toBe("/?x=1");
    expect(withWindow(`/?w=work#today`, null)).toBe("/");
  });
  it("sizes: overviews, editors, setup, and work are large; the quick view is medium", () => {
    expect(windowSize({ kind: "record", table: "initiatives", id: ID })).toBe("large");
    expect(windowSize({ kind: "record", table: "pipeline_items", id: ID })).toBe("large");
    expect(windowSize({ kind: "record", table: "tasks", id: ID })).toBe("medium");
    expect(windowSize({ kind: "record", table: "contacts", id: ID })).toBe("medium");
    expect(windowSize({ kind: "edit", table: "tasks", id: ID })).toBe("large");
    expect(windowSize({ kind: "work", taskId: null })).toBe("large");
  });
  it("Back from a view opened straight at it goes to the view it belongs to", () => {
    expect(parentView({ kind: "edit", table: "goals", id: ID })).toEqual({ kind: "record", table: "goals", id: ID });
    expect(parentView({ kind: "plan", initiativeId: ID })).toEqual({ kind: "record", table: "initiatives", id: ID });
    expect(parentView({ kind: "record", table: "goals", id: ID })).toBeNull();
  });
  it("full pages", () => {
    expect(fullPageHref({ kind: "record", table: "scenarios", id: ID })).toBe(`/plan/scenarios/${ID}`);
    expect(fullPageHref({ kind: "record", table: "tasks", id: ID })).toBe(`/records/tasks/${ID}`);
    expect(fullPageHref({ kind: "edit", table: "tasks", id: ID })).toBe(`/records/tasks/${ID}?edit=1`);
    expect(fullPageHref({ kind: "setup", draftId: ID, step: "goals" })).toBe(`/plan/initiatives/drafts/${ID}`);
    expect(fullPageHref({ kind: "setup", draftId: null, manual: false })).toBe("/plan/start");
  });
});

describe("which links open a window", () => {
  it("on a page: initiatives, goals, milestones, pipeline items, tasks, contacts, organizations, scenarios, drafts", () => {
    for (const t of ["initiatives", "goals", "milestones", "pipeline_items", "tasks", "contacts", "organizations"]) expect(hrefToView(`/records/${t}/${ID}`)).toEqual({ kind: "record", table: t, id: ID });
    expect(hrefToView(`/plan/scenarios/${ID}`)).toEqual({ kind: "record", table: "scenarios", id: ID });
    expect(hrefToView(`/plan/initiatives/drafts/${ID}`)).toEqual({ kind: "draft", id: ID });
    expect(hrefToView(`/plan/initiatives/drafts/${ID}?step=goals`)).toEqual({ kind: "setup", draftId: ID, step: "goals" });
  });
  it("on a page, other links stay links: other record types, edit links, new forms, sections, other sites", () => {
    expect(hrefToView(`/records/accounts/${ID}`)).toBeNull();
    expect(hrefToView(`/records/tasks/${ID}?edit=1`)).toBeNull();
    expect(hrefToView("/records/tasks/new?due_date=2026-10-27")).toBeNull();
    expect(hrefToView(`/records/tasks/${ID}#notes`)).toBeNull();
    expect(hrefToView(`/plan/scenarios/compare`)).toBeNull();
    expect(hrefToView(`https://example.com/records/tasks/${ID}`, { origin: "http://localhost:3000" })).toBeNull();
    expect(hrefToView(`/plan/initiatives/drafts/${ID}?notice=x`)).toBeNull();
  });
  it("inside a window: any record, Edit, and + Add open in the same window", () => {
    expect(hrefToView(`/records/accounts/${ID}`, { inWindow: true })).toEqual({ kind: "record", table: "accounts", id: ID });
    expect(hrefToView(`/records/tasks/${ID}?edit=1`, { inWindow: true })).toEqual({ kind: "edit", table: "tasks", id: ID });
    expect(hrefToView(`/records/milestones/new?goal_id=${ID}`, { inWindow: true })).toEqual({ kind: "new", table: "milestones", prefill: { goal_id: ID } });
    expect(hrefToView(`/records/initiatives/new`, { inWindow: true })).toBeNull();
    expect(hrefToView(`/records/tasks/${ID}?edit=1&x=2`, { inWindow: true })).toBeNull();
  });
});

describe("step-by-step setup", () => {
  it("eight steps in order; Save moves on; the last step stays", () => {
    expect(SETUP_STEPS).toEqual(["describe", "name", "goals", "milestones", "tasks", "target", "plan", "review"]);
    expect(nextStep("describe")).toBe("name");
    expect(nextStep("plan")).toBe("review");
    expect(nextStep("review")).toBe("review");
    expect(previousStep("describe")).toBeNull();
    expect(previousStep("goals")).toBe("name");
    expect(stepPosition("goals")).toEqual({ index: 3, total: 8 });
  });
  it("a summary line opens the step that holds its field", () => {
    expect(stepForField("i-name")).toBe("name");
    expect(stepForField("g-title-1")).toBe("goals");
    expect(stepForField("m-title-0")).toBe("milestones");
    expect(stepForField("t-title-1")).toBe("tasks");
    expect(stepForField("tg-name")).toBe("target");
    expect(stepForField("b-amt")).toBe("target");
    expect(stepForField("pd-title")).toBe("plan");
    expect(stepForField("c-name-0")).toBe("plan");
  });
});

describe("work through tasks", () => {
  it("position and the next task", () => {
    expect(workPosition([ID, ID2], null)).toEqual({ index: 1, total: 2, next: ID2 });
    expect(workPosition([ID, ID2], ID2)).toEqual({ index: 2, total: 2, next: null });
    expect(workPosition([], null)).toEqual({ index: 0, total: 0, next: null });
  });
});
