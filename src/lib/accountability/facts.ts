/**
 * The facts every target, the End of day strip, Reports, and the Outreach counter count from, built from the rows
 * the app reads (pure; src/lib/accountability/data.ts loads the rows and calls it, and the sample's week figures are
 * checked through the same function in src/lib/work/sample.test.ts, Edit batch C item 6). Stage history by item, in
 * order: the first stage is the screening (Passed or Interested on a deal); every later working stage is a move.
 * Outgoing emails and calls are the contacts; work events give the follow-ups, next actions done, and the focus done.
 */
import { passReasonLabel } from "@/lib/work/buy-box";
import { displayName } from "@/lib/work/names";
import { EMPTY_FACTS, type Facts } from "@/lib/accountability/targets";

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
  const facts: Facts = { ...EMPTY_FACTS, screened: [], moves: [], comms: [], followUps: [], actionsDone: [], focusDone: [] };
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
    else if (e.kind === "next_action_done") facts.actionsDone.push({ on, name: String(e.label ?? ""), label: String((e.meta as Row | null)?.action ?? "") });
    else if (e.kind === "focus_done") facts.focusDone.push({ on, text: String(e.label ?? "") });
  }
  return { facts, passes };
}
