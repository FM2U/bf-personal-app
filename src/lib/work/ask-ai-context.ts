import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCtx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import type { AskContext, PageContext } from "@/lib/work/ask-ai";
import { trimContext } from "@/lib/work/ask-ai";
import { loadDealPage, loadDeals, loadListings, loadWorkCtx, loadWorkNow, type DealRow } from "@/lib/work/data";
import { dueLabel } from "@/lib/work/stages";
import { lastContactLabel, orgRoleLine, purposeLabel } from "@/lib/work/outreach";
import { loadOutreach, loadPersonPage, type PersonRow } from "@/lib/work/outreach-data";
import { loadTodos } from "@/lib/work/personal-todos-data";
import { loadItemPage, loadPipelineBoard, loadPipelinesHome, type ItemRow } from "@/lib/work/pipelines-data";
import { loadProjectPage, loadRosara, loadRosaraHome, type ProjectRow } from "@/lib/work/projects-data";
import { openTodos, type DealTodo } from "@/lib/work/todos";
import type { TimelineEvent } from "@/lib/work/timeline";
import { QUESTION_GROUPS } from "@/lib/work/questions";

/**
 * What the AI reads for the Ask AI panel (batch B2): only the records of the page the panel was opened from, as
 * plain lines (names, stages, next actions, waits, recent timeline lines), never more. A card star narrows the lines
 * to that card; a field star adds the field. The result goes to the prompts in src/lib/work/ask-ai.ts.
 */

const fmt = (d: string) => fmtDate(d, "MMM d");

function dealLine(d: DealRow, today: string): string {
  const due = d.nextAction ? dueLabel(d.nextActionDue, today, fmt).text : "none";
  const wait = d.waitLevel !== "none" ? `; waiting on ${d.waitingOn} for ${d.waitDays} days` : "";
  return `deal: ${d.name} | stage ${d.stageName ?? "none"} (day ${d.dayInStage}) | next action: ${d.nextAction ?? "none"} (due ${due}${d.nextActionMinutes ? `, ${d.nextActionMinutes} min` : ""})${wait}${d.keyFinding ? ` | key finding: ${d.keyFinding}` : ""}`;
}

function personLine(p: PersonRow, today: string): string {
  const next = p.nextFollowUp ? dueLabel(p.nextFollowUp, today, fmt).text : "no date";
  return `person: ${p.name} | ${orgRoleLine(p) || "no organization"} | purpose: ${p.purposes.map(purposeLabel).join(", ") || "none"} | next follow-up: ${next}${p.followUpFor ? ` (${p.followUpFor})` : ""} | last contact: ${lastContactLabel(p.lastContactOn, p.lastContactKind, today, fmt)}${p.note ? ` | note: ${p.note}` : ""}`;
}

function projectLine(p: ProjectRow, today: string): string {
  const due = p.nextAction ? dueLabel(p.nextActionDue, today, fmt).text : "none";
  return `project: ${p.name} | milestone: ${p.milestone ?? "none"} | next action: ${p.nextAction ?? "none"} (due ${due}${p.nextActionMinutes ? `, ${p.nextActionMinutes} min` : ""}) | ${p.openTasks} open tasks${p.status === "closed" ? " | closed" : ""}`;
}

function itemLine(i: ItemRow, today: string): string {
  const due = i.nextAction ? dueLabel(i.nextActionDue, today, fmt).text : "none";
  const wait = i.waitLevel !== "none" ? `; waiting on ${i.waitingOn} for ${i.waitDays} days` : "";
  const what = i.kind === "job" ? `role ${i.title ?? "not set"}` : `project ${i.title ?? "not set"}${i.fee !== null ? `, fee $${Math.round(i.fee).toLocaleString("en-US")}` : ""}`;
  return `${i.kind === "job" ? "opportunity" : "consulting"}: ${i.name} | ${what} | contact ${i.contactName ?? "not set"} | stage ${i.stageName ?? "none"} (day ${i.dayInStage}) | next action: ${i.nextAction ?? "none"} (due ${due})${wait}${i.note ? ` | note: ${i.note}` : ""}`;
}

function taskLines(tasks: readonly DealTodo[]): string[] {
  return openTodos(tasks).map((t) => `task: ${t.text}`);
}

function timelineLines(events: readonly TimelineEvent[], n = 10): string[] {
  return events.slice(0, n).map((e) => `timeline ${e.date}: ${e.kind === "finding" ? "finding: " : ""}${e.title}${e.detail ? `. ${e.detail}` : ""}`);
}

/** The card a star sits on keeps only the lines that belong to it (the record's own line always stays). */
const CARD_TAGS: Record<string, string[]> = {
  "Next actions": ["deal:", "person:", "project:", "opportunity:", "consulting:"],
  Tasks: ["task:"],
  "Open questions": ["question:", "key finding:"],
  "What to find out": ["question:"],
  "Weekly focus": ["focus:", "project:"],
  "Suggested next steps": [],
};

export async function buildPageContext(sb: SupabaseClient, ownerId: string, c: AskContext): Promise<PageContext> {
  const ctx = await loadCtx(sb, ownerId);
  const today = ctx.today;
  let title = c.label;
  let lines: string[] = [];
  let head: string[] = [];
  const id = c.recordId ?? "";
  switch (c.page) {
    case "home": {
      const [now, rosara, pipes] = await Promise.all([loadWorkNow(sb, ownerId), loadRosaraHome(sb, ctx), loadPipelinesHome(sb, await loadWorkCtx(sb, ownerId))]);
      title = `Home (Work on now), ${fmtDate(today, "EEEE, MMM d")}`;
      lines = [
        ...now.deals.map((d) => dealLine(d, today)),
        ...now.outreach.due.map((p) => personLine(p, today)),
        ...(rosara.focus ? [`focus: ${rosara.focus}`] : []),
        ...rosara.actions.map((p) => projectLine(p, today)),
        ...pipes.jobs.map((i) => itemLine(i, today)),
        ...pipes.consulting.map((i) => itemLine(i, today)),
      ];
      break;
    }
    case "listings": {
      const d = await loadListings(sb, ownerId);
      title = "Screen listings";
      lines = d.listings.map((l) => `listing: ${l.name} | ${l.whatItDoes ?? ""} | ${l.location ?? ""} | ${l.earningsLabel ?? "no figure"} ${l.earnings ?? ""} | buy box: ${l.buyBox.label}`);
      break;
    }
    case "deals": {
      const d = await loadDeals(sb, ownerId);
      title = "Deals";
      lines = d.groups.flatMap((g) => g.deals.map((x) => dealLine(x, today)));
      break;
    }
    case "deal": {
      const d = await loadDealPage(sb, ownerId, id);
      if (d.deal) {
        title = `Deal: ${d.deal.name}`;
        head = [dealLine(d.deal, today), `facts: ${[d.deal.whatItDoes, d.deal.location, d.deal.industry, d.deal.brokerName ? `broker ${d.deal.brokerName}` : null, d.deal.whySelling ? `why selling: ${d.deal.whySelling}` : null].filter(Boolean).join(" | ")}`];
        lines = [
          ...(d.deal.keyFinding ? [`key finding: ${d.deal.keyFinding}`] : []),
          ...QUESTION_GROUPS.flatMap((g) => d.deal!.openQuestions[g.key].map((q) => `question (${g.label}): ${q}`)),
          ...taskLines(d.todos),
          ...timelineLines(d.timeline),
        ];
      }
      break;
    }
    case "outreach": {
      const d = await loadOutreach(sb, ctx);
      title = `Outreach, ${d.people.length} people, ${d.counter.count} of ${d.counter.target} this week`;
      lines = d.people.map((p) => personLine(p, today));
      break;
    }
    case "person": {
      const d = await loadPersonPage(sb, ctx, id);
      if (d.person) {
        title = `Person: ${d.person.name}`;
        head = [personLine(d.person, today)];
        lines = [...taskLines(d.tasks), ...timelineLines(d.timeline)];
      }
      break;
    }
    case "rosara": {
      const d = await loadRosara(sb, ctx);
      title = "Rosara projects";
      lines = [...(d.focus ? [`focus: ${d.focus}`] : []), ...d.projects.map((p) => projectLine(p, today))];
      break;
    }
    case "project": {
      const d = await loadProjectPage(sb, ctx, id);
      if (d.project) {
        title = `Project: ${d.project.name}`;
        head = [projectLine(d.project, today), `goal: ${d.project.goal ?? "not set"}`];
        lines = [...taskLines(d.tasks), ...timelineLines(d.timeline)];
      }
      break;
    }
    case "jobs":
    case "consulting": {
      const kind = c.page === "jobs" ? "job" : "consulting";
      const d = await loadPipelineBoard(sb, ownerId, kind);
      title = kind === "job" ? "Job search" : "Consulting";
      lines = d.groups.flatMap((g) => g.deals.map((i) => itemLine(i, today)));
      break;
    }
    case "opportunity":
    case "consulting_item": {
      const kind = c.page === "opportunity" ? "job" : "consulting";
      const d = await loadItemPage(sb, ownerId, kind, id);
      if (d.item) {
        title = `${kind === "job" ? "Opportunity" : "Consulting"}: ${d.item.name}`;
        head = [itemLine(d.item, today), `facts: ${[d.item.location, d.item.payRange ? `pay ${d.item.payRange}` : null, d.item.source ? `source ${d.item.source}` : null, d.item.scope ? `scope: ${d.item.scope}` : null, d.item.startDate ? `start ${d.item.startDate}` : null].filter(Boolean).join(" | ")}`];
        lines = [...d.item.findOut.map((q) => `question: ${q}`), ...taskLines(d.todos), ...timelineLines(d.timeline)];
      }
      break;
    }
    case "todos": {
      const d = await loadTodos(sb, ctx);
      title = "To-dos";
      lines = [...d.sections.today.map((t) => `to-do (today): ${t.text}`), ...d.sections.week.map((t) => `to-do (next 7 days): ${t.text}${t.dueOn ? ` (due ${fmt(t.dueOn)})` : ""}`), ...d.sections.later.map((t) => `to-do (later): ${t.text}${t.dueOn ? ` (due ${fmt(t.dueOn)})` : ""}`)];
      break;
    }
  }
  if (c.card && CARD_TAGS[c.card]) {
    const tags = CARD_TAGS[c.card];
    if (tags.length) lines = lines.filter((l) => tags.some((t) => l.startsWith(t) || l.includes(` ${t}`)));
    head.push(`focus on: the ${c.card} card`);
  }
  if (c.field) {
    head.push(`the field to fill: ${c.field.label}${c.field.current ? ` (holds: ${c.field.current.slice(0, 200)})` : " (empty)"}`);
    if (c.field.extra) head.push(c.field.extra);
  }
  return trimContext({ title, lines: [...head, ...lines] });
}
