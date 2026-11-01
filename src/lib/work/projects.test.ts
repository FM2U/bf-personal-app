import { describe, expect, it } from "vitest";
import { compareProjects, dueThisWeekLabel, matchesProjectFilter, matchesProjectSearch, projectFilterCounts, projectSectionOf, projectSections, projectTasksLabel, rosaraTile, type ProjectLike } from "./projects";

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
  it("puts a project under Due today when its next action is due today or earlier, under No next action without one, under Closed when closed", () => {
    expect(projectSectionOf(projects[1], today)).toBe("today");
    expect(projectSectionOf(projects[2], today)).toBe("today");
    expect(projectSectionOf(projects[0], today)).toBe("active");
    expect(projectSectionOf(projects[3], today)).toBe("needs");
    expect(projectSectionOf(projects[4], today)).toBe("active");
    expect(projectSectionOf(projects[6], today)).toBe("closed");
  });

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

  it("builds the Rosara tile: the soonest next action, the open count, and how many are due this week", () => {
    const t = rosaraTile(projects, today, "2026-11-10");
    expect(t.next?.id).toBe("Meridian late");
    expect(t.open).toBe(6);
    expect(t.dueThisWeek).toBe(4);
    expect(rosaraTile([], today, "2026-11-10")).toEqual({ next: null, open: 0, dueThisWeek: 0 });
    expect(dueThisWeekLabel(2)).toBe("2 due this week");
    expect(dueThisWeekLabel(1)).toBe("1 due this week");
    expect(dueThisWeekLabel(0)).toBe("Nothing due this week");
    expect(projectTasksLabel(0)).toBe("No open tasks");
    expect(projectTasksLabel(1)).toBe("1 open task");
    expect(projectTasksLabel(5)).toBe("5 open tasks");
  });
});
