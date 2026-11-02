import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCtx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import type { AskContext, PageContext } from "@/lib/work/ask-ai";
import { trimContext } from "@/lib/work/ask-ai";
import { loadDealPage, loadDeals, loadListings, loadPipelineOfKind, loadWorkCtx, loadWorkNow, type DealRow } from "@/lib/work/data";
import { dueLabel } from "@/lib/work/stages";
import { lastContactLabel, orgRoleLine, purposeLabel } from "@/lib/work/outreach";
import { loadOutreach, loadPersonPage, type PersonRow } from "@/lib/work/outreach-data";
import { loadHomeTodos, loadTodos } from "@/lib/work/personal-todos-data";
import { loadItemPage, loadPipelineBoard, loadPipelinesHome, type ItemRow } from "@/lib/work/pipelines-data";
import { loadProjectPage, loadRosara, loadRosaraHome, type ProjectRow } from "@/lib/work/projects-data";
import { openTodos, type DealTodo } from "@/lib/work/todos";
import type { TimelineEvent } from "@/lib/work/timeline";
import { dealFactLines, dealFactsOf, moneyExact } from "@/lib/work/deal-facts";
import { financingLineFor, stageLineFor, type BuyerScope, type StageLine } from "@/lib/ai/instructions";
import { loadBuyBoxSettings } from "@/lib/work/buy-box-data";
import { loadEndOfDay, loadReportsPage, loadTargetsPage } from "@/lib/accountability/data";
import { endOfDayLines, reportsLines, targetsLines } from "@/lib/accountability/ask-ai";

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
  "Next actions": ["deal:", "person:", "project:", "opportunity:", "consulting:", "to-do:"],
  Tasks: ["task:"],
  "Open questions": ["question:", "key finding:"],
  "What to find out": ["question:"],
  "Weekly focus": ["focus:", "project:"],
  "Suggested next steps": [],
  // Edit batch C round 2: the next action star reads the whole record (stage, default, timeline, tasks).
  "Next action": [],
  "Next follow-up": [],
  Reasons: ["target:", "listings screened:", "deals moved:", "calls:", "network outreach:", "next actions done:", "waiting on broker:"],
  "What matters tomorrow": ["tomorrow line:", "deals moved:", "waiting on broker:", "next actions done:", "target:"],
  Report: [],
};

export async function buildPageContext(sb: SupabaseClient, ownerId: string, c: AskContext): Promise<PageContext> {
  const ctx = await loadCtx(sb, ownerId);
  const today = ctx.today;
  let title = c.label;
  let lines: string[] = [];
  let head: string[] = [];
  let dealRecord = false;
  let listingText: string | null = null;
  /** AI instructions (2026-11-02): the stage line of a deal or a listing; null on the Deals list; undefined elsewhere. */
  let buyerStage: StageLine | null | undefined;
  /** AI instructions revision 1: the deal's financing line (only from Model onward; revision 2). */
  let financing: string | null = null;
  const id = c.recordId ?? "";
  const nextCard = c.card === "Next action" || c.card === "Next follow-up";
  /** "stage default next action: Ask for the seller call (due in 3 days)" for the next action star. */
  const stageDefault = async (kind: "acquisition" | "job" | "consulting", stageId: string | null): Promise<string[]> => {
    if (!nextCard || !stageId) return [];
    const pipe = await loadPipelineOfKind(sb, ownerId, kind);
    const st = pipe?.byId[stageId];
    if (!st) return [];
    return [`stage default next action: ${st.defaultTitle ?? "none"}${st.defaultTitle && st.defaultDueInDays !== null ? ` (due in ${st.defaultDueInDays} days)` : ""}`, ...(pipe!.stages.find((x) => x.position === st.position + 1 && x.outcome === "open") ? [`next stage: ${pipe!.stages.find((x) => x.position === st.position + 1)!.name}`] : [])];
  };
  switch (c.page) {
    case "home": {
      const [now, rosara, pipes, todos] = await Promise.all([loadWorkNow(sb, ownerId), loadRosaraHome(sb, ctx), loadPipelinesHome(sb, await loadWorkCtx(sb, ownerId)), loadHomeTodos(sb, ctx)]);
      title = `Home (Work on now), ${fmtDate(today, "EEEE, MMM d")}`;
      lines = [
        ...now.deals.map((d) => dealLine(d, today)),
        ...now.outreach.due.map((p) => personLine(p, today)),
        ...(rosara.focus ? [`focus: ${rosara.focus}`] : []),
        ...rosara.actions.map((p) => projectLine(p, today)),
        ...pipes.jobs.map((i) => itemLine(i, today)),
        ...pipes.consulting.map((i) => itemLine(i, today)),
        ...todos.map((t) => `to-do: ${t.text} (due ${t.dueOn ? dueLabel(t.dueOn, today, fmt).text : "no date"})`),
      ];
      break;
    }
    case "listings": {
      const d = await loadListings(sb, ownerId);
      title = "Screen listings";
      // Fix 2026-11-02: revenue, earnings, and asking price with the multiple, as exact figures.
      buyerStage = "screening";
      lines = d.listings.map((l) => `listing: ${l.name} | ${l.whatItDoes ?? ""} | ${l.location ?? ""} | revenue ${moneyExact(l.revenue) ?? "not stated"} | ${l.earningsLabel ?? "earnings"} ${moneyExact(l.earnings) ?? "not stated"} | asking ${moneyExact(l.askingPrice) ?? "not stated"}${l.askingMultiple ? ` (${l.askingMultiple})` : ""} | buy box: ${l.buyBox.label}`);
      break;
    }
    case "deals": {
      const d = await loadDeals(sb, ownerId);
      title = "Deals";
      buyerStage = null;
      lines = d.groups.flatMap((g) => g.deals.map((x) => dealLine(x, today)));
      break;
    }
    case "deal": {
      const d = await loadDealPage(sb, ownerId, id);
      if (d.deal) {
        title = `${d.deal.screened ? "Deal" : "Listing"}: ${d.deal.name}`;
        // Fix 2026-11-02: every fact (money, multiple, source, link, year, employees, key finding, open questions) and the
        // original listing text, for the page pill, every card star, the next action star, and every field star.
        head = [dealLine(d.deal, today), ...(await stageDefault("acquisition", d.deal.stageId)), ...dealFactLines(dealFactsOf(d.deal, d.listingText))];
        lines = [...taskLines(d.todos), ...timelineLines(d.timeline)];
        dealRecord = true;
        listingText = d.listingText;
        buyerStage = stageLineFor(d.deal.stageName, d.deal.screened);
        financing = financingLineFor(d.deal.stageName, d.deal.screened, d.deal.financing);
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
        head = [itemLine(d.item, today), ...(await stageDefault(kind, d.item.stageId)), `facts: ${[d.item.location, d.item.payRange ? `pay ${d.item.payRange}` : null, d.item.source ? `source ${d.item.source}` : null, d.item.scope ? `scope: ${d.item.scope}` : null, d.item.startDate ? `start ${d.item.startDate}` : null].filter(Boolean).join(" | ")}`];
        lines = [...d.item.findOut.map((q) => `question: ${q}`), ...taskLines(d.todos), ...timelineLines(d.timeline)];
      }
      break;
    }
    // Batch C: Targets, End of day, Reports read their own pages' numbers.
    case "targets": {
      const d = await loadTargetsPage(sb, ctx);
      title = `Targets, ${d.weekLabel}`;
      lines = targetsLines(d);
      break;
    }
    case "end_of_day": {
      const d = await loadEndOfDay(sb, ctx);
      title = `End of day, ${d.dateLabel}`;
      lines = endOfDayLines(d);
      break;
    }
    case "reports": {
      const d = await loadReportsPage(sb, ctx);
      title = `Reports, ${d.periods[0]?.lead ?? ""}`;
      lines = reportsLines(d);
      break;
    }
    case "todos": {
      const d = await loadTodos(sb, ctx);
      title = "To-dos";
      lines = [...d.sections.today.map((t) => `to-do (today): ${t.text}`), ...d.sections.week.map((t) => `to-do (next 7 days): ${t.text}${t.dueOn ? ` (due ${fmt(t.dueOn)})` : ""}`), ...d.sections.later.map((t) => `to-do (later): ${t.text}${t.dueOn ? ` (due ${fmt(t.dueOn)})` : ""}`)];
      break;
    }
  }
  if (nextCard) head.push(`today: ${fmtDate(today, "EEEE")}, ${today}`);
  if (c.card && CARD_TAGS[c.card]) {
    const tags = CARD_TAGS[c.card];
    if (tags.length) lines = lines.filter((l) => tags.some((t) => l.startsWith(t) || l.includes(` ${t}`)));
    head.push(`focus on: the ${c.card} card`);
  }
  if (c.field) {
    head.push(`the field to fill: ${c.field.label}${c.field.current ? ` (holds: ${c.field.current.slice(0, 200)})` : " (empty)"}`);
    if (c.field.extra) head.push(c.field.extra);
  }
  // The buy box is read on every click, so the instructions follow any change in Settings.
  const buyer: BuyerScope | null = buyerStage === undefined ? null : { buyBox: await loadBuyBoxSettings(sb, ownerId), stage: buyerStage, financing };
  return trimContext({ title, lines: [...head, ...lines], ...(dealRecord ? { deal: true, listingText } : {}), ...(buyer ? { buyer } : {}) });
}
