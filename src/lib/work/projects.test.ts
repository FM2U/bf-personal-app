import { describe, expect, it } from "vitest";
import { compareProjects, matchesProjectFilter, matchesProjectSearch, projectFilterCounts, projectSections, type ProjectLike } from "./projects";

const today = "2026-11-03";
const p = (id: string, over: Partial<ProjectLike> = {}): ProjectLike => ({ id, name: id, milestone: null, status: "open", nextAction: "Do it", nextActionDue: "2026-11-10", closedAt: null, ...over });
const projects: ProjectLike[] = [
  p("Rosara platform", { nextActionDue: "2026-11-04", milestone: "Agency hub onboarding flow" }),
  p("Market research", { nextActionDue: today }),
  p("Meridian late", { nextActionDue: "2026-11-01" }),
  p("Competition", { nextAction: null, nextActionDue: null }),
  p("No date", { nextActionDue: null }),
  p("Business model", { nextActionDue: "2026-11-05" }),
  p("Website", { status: "closed", closedAt: "2026-10-25T16:00:00Z", nextAction: null, nextActionDue: null }),
  p("Old site", { status: "closed", closedAt: "2026-09-01T16:00:00Z" }),
];

describe("project sections", () => {
  it("sorts Active by the next due date (a project without a date last), Due today oldest first, Closed newest close first", () => {
    const s = projectSections(projects, today);
    expect(s.today.map((x) => x.id)).toEqual(["Meridian late", "Market research"]);
    expect(s.active.map((x) => x.id)).toEqual(["Rosara platform", "Business model", "No date"]);
    expect(s.needs.map((x) => x.id)).toEqual(["Competition"]);
    expect(s.closed.map((x) => x.id)).toEqual(["Website", "Old site"]);
    expect(compareProjects(projects[0], projects[5])).toBeLessThan(0);
  });

  it("counts the filter pills: All counts the open projects; Closed the closed ones; Find matches the name or the milestone", () => {
    expect(projectFilterCounts(projects, today)).toEqual({ all: 6, today: 2, needs: 1, closed: 2 });
    expect(matchesProjectFilter(projects[6], "all", today)).toBe(false);
    expect(matchesProjectFilter(projects[6], "closed", today)).toBe(true);
    expect(matchesProjectSearch(projects[0], "onboarding")).toBe(true);
    expect(matchesProjectSearch(projects[0], "ROSARA")).toBe(true);
    expect(matchesProjectSearch(projects[0], "market")).toBe(false);
    expect(matchesProjectSearch(projects[0], "  ")).toBe(true);
  });
});
