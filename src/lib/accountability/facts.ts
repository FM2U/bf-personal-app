/**
 * The facts every target, the End of day strip, Reports, and the Outreach counter count from, built from the rows
 * the app reads (pure; src/lib/accountability/data.ts loads the rows and calls it, and the sample's week figures are
 * checked through the same function in src/lib/work/sample.test.ts, Edit batch C item 6). Stage history by item, in
 * order: the first stage is the screening (Passed or Interested on a deal); every later working stage is a move.
 * Outgoing emails and calls are the contacts; work events give the follow-ups, next actions done, and the focus done.
 * Push E2: tasks on records checked off count as next actions done in their record's area, and personal to-dos
 * checked off as to-dos done.
 */
import { passReasonLabel } from "@/lib/work/buy-box";
import { displayName } from "@/lib/work/names";
import { EMPTY_FACTS, type DoneArea, type Facts } from "@/lib/accountability/targets";

type Row = Record<string, unknown>;

type FactsRows = {
  items: Row[];
  /** stage_history rows (item_id, stage_id, entered_at), oldest first. */
  history: Row[];
  /** communications rows (occurred_at, method, direction, contact_id). */
  comms: Row[];
  /** work_events rows (kind, label, happened_on, on_time, meta). */
  events: Row[];
  /** contacts rows (id, name, outreach_role). */
  people: Row[];
  /**
   * Push E2, item 5: deal_todos rows checked off (text, done_at, record_type, record_id, deal_id). A task on a record
   * counts as a next action done in its record's area; a personal to-do (no record) counts as a to-do done.
   */
  tasks?: Row[];
  stageById: Record<string, { name: string; outcome: string }>;
  /** The lane of each pipeline id. */
  laneOf: Record<string, "Deals" | "Job search" | "Consulting">;
  /** Facts from this date on (YYYY-MM-DD). */
  since: string;
  /** A timestamp's date in the owner's time zone. */
  local: (ts: string) => string;
};

type Pass = { on: string; name: string; reason: string | null };

export function buildFacts(r: FactsRows): { facts: Facts; passes: Pass[] } {
  const personById = new Map(r.people.map((p) => [String(p.id), p]));
  const itemById = new Map(r.items.map((i) => [String(i.id), i]));
  const nameOf = (i: Row) => displayName({ name: String(i.name), companyName: (i.company_name as string | null) ?? null });
  const byItem = new Map<string, Row[]>();
  for (const h of r.history) {
    if (!h.stage_id) continue;
    const list = byItem.get(String(h.item_id)) ?? [];
    list.push(h);
    byItem.set(String(h.item_id), list);
  }
  const facts: Facts = { ...EMPTY_FACTS, screened: [], moves: [], comms: [], followUps: [], actionsDone: [], focusDone: [], todosDone: [] };
  // The area of a record, with the names the Area selector uses (push E2, item 5).
  const itemArea = (id: unknown, kind?: unknown): DoneArea => {
    const item = id ? itemById.get(String(id)) : undefined;
    const lane = item ? r.laneOf[String(item.pipeline_id)] : undefined;
    if (lane) return lane;
    return kind === "job" ? "Job search" : kind === "consulting" ? "Consulting" : "Deals";
  };
  const passes: Pass[] = [];
  for (const [itemId, rows] of byItem) {
    const item = itemById.get(itemId);
    if (!item) continue;
    const lane = r.laneOf[String(item.pipeline_id)];
    if (!lane) continue;
    let prev: { name: string; outcome: string } | null = null;
    for (const h of [...rows].sort((a, b) => (String(a.entered_at) < String(b.entered_at) ? -1 : String(a.entered_at) > String(b.entered_at) ? 1 : 0))) {
      const stage = r.stageById[String(h.stage_id)];
      if (!stage) continue;
      const on = r.local(String(h.entered_at));
      if (!prev) {
        if (lane === "Deals" && (stage.name === "Interested" || stage.name === "Passed") && on >= r.since) {
          const reason = stage.name === "Passed" ? passReasonLabel((item.pass_reason as string | null) ?? null) : null;
          facts.screened.push({ on, outcome: stage.name === "Passed" ? "passed" : "interested", name: nameOf(item), reason });
          if (stage.name === "Passed") passes.push({ on, name: nameOf(item), reason });
        }
      } else if (stage.name !== prev.name && on >= r.since) {
        if (stage.outcome === "open" || stage.outcome === "won") facts.moves.push({ on, name: nameOf(item), from: prev.name, to: stage.name, keyFinding: (item.key_finding as string | null) ?? null, lane });
        else if (stage.name === "Passed" && lane === "Deals") passes.push({ on, name: nameOf(item), reason: passReasonLabel((item.pass_reason as string | null) ?? null) });
      }
      prev = stage;
    }
  }
  for (const c of r.comms) {
    if (c.direction === "incoming" || c.awaiting_log) continue;
    const on = r.local(String(c.occurred_at));
    if (on < r.since) continue;
    const contact = c.contact_id ? personById.get(String(c.contact_id)) : null;
    facts.comms.push({ on, method: String(c.method), contactId: c.contact_id ? String(c.contact_id) : null, contactName: contact?.name ? String(contact.name) : null, broker: contact?.outreach_role === "broker" });
  }
  for (const e of r.events) {
    const on = String(e.happened_on).slice(0, 10);
    if (on < r.since) continue;
    if (e.kind === "follow_up_done") facts.followUps.push({ on, onTime: e.on_time !== false, name: String(e.label ?? "") });
    else if (e.kind === "next_action_done") {
      const meta = (e.meta as Row | null) ?? {};
      const area: DoneArea = e.record_type === "projects" ? "Rosara" : e.record_type === "contacts" || e.record_type === "organizations" ? "Contacts" : itemArea(e.record_id, meta.kind);
      facts.actionsDone.push({ on, name: String(e.label ?? ""), label: String(meta.action ?? ""), area });
    }
    else if (e.kind === "focus_done") facts.focusDone.push({ on, text: String(e.label ?? "") });
  }
  for (const t of r.tasks ?? []) {
    if (!t.done_at) continue;
    const on = r.local(String(t.done_at));
    if (on < r.since) continue;
    const text = String(t.text ?? "").trim();
    const type = t.record_type ? String(t.record_type) : t.deal_id ? "pipeline_items" : null;
    if (!type) {
      facts.todosDone.push({ on, text });
      continue;
    }
    const recordId = String(t.record_id ?? t.deal_id ?? "");
    const area: DoneArea = type === "projects" ? "Rosara" : type === "contacts" || type === "organizations" ? "Contacts" : itemArea(recordId);
    const item = type === "pipeline_items" ? itemById.get(recordId) : undefined;
    const person = type === "contacts" ? personById.get(recordId) : undefined;
    const name = item ? nameOf(item) : person?.name ? String(person.name) : text;
    facts.actionsDone.push({ on, name, label: text, area });
  }
  return { facts, passes };
}
