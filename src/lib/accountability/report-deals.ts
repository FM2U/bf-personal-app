/**
 * The deals and job opportunities as the End of day report shows them (Push B edits, 2026-11-03), pure and tested in
 * src/lib/accountability/report-sections.test.ts: each open record with its stage, its status (what it waits on and
 * since when, from the deal's waiting fields), its next step with the date, and what happened in the report's
 * period (stage changes, emails and calls, notes, next actions done). src/lib/accountability/data.ts loads the rows.
 */
import { daysBetween } from "@/lib/calc/dates";
import { displayName } from "@/lib/work/names";
import type { ReportDeal } from "@/lib/accountability/report-sections";

type Row = Record<string, unknown>;

export type DealRows = {
  items: Row[];
  /** stage_history rows (item_id, stage_id, entered_at). */
  history: Row[];
  /** communications rows (occurred_at, method, direction, contact_id, pipeline_item_id, subject, call_minutes). */
  comms: Row[];
  /** notes on pipeline items (record_id, body, created_at). */
  notes: Row[];
  /** work_events rows (kind, record_id, happened_on, meta). */
  events: Row[];
  /** contacts rows (id, name). */
  people: Row[];
  stageById: Record<string, { name: string; outcome: string; position: number }>;
};

const lowerFirst = (s: string) => (/^[A-Z](?![A-Z])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "Transworld, Rachel Kim" or "Rachel Kim, Transworld" to the person's name; an organization alone stays as typed. */
export function brokerPerson(brokerName: string | null | undefined): string | null {
  const t = String(brokerName ?? "").trim();
  if (!t) return null;
  const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.find((x) => /^[A-Z][a-z]+ [A-Z]/.test(x) && !/(Advisors|Brokers|Business|Partners|Group|LLC|Inc)/.test(x)) ?? parts[0];
}

/**
 * The open records of one pipeline for the report, furthest along first (then the newest activity).
 * `period` is the report's period (the day, or the week on Friday); `local` turns a timestamp into the owner's date;
 * `fmt` writes a date as "Oct 23"; `weekday` as "Monday".
 */
export function reportDeals(r: DealRows & { pipelineId: string; period: { start: string; end: string }; today: string; local: (ts: string) => string; fmt: (d: string) => string; weekday: (d: string) => string }): ReportDeal[] {
  const person = new Map(r.people.map((p) => [String(p.id), String(p.name ?? "")]));
  const inPeriod = (d: string) => d >= r.period.start && d <= r.period.end;
  const open = r.items.filter((i) => String(i.pipeline_id) === r.pipelineId && i.status === "open" && i.screened !== false && i.stage_id && r.stageById[String(i.stage_id)]?.outcome === "open");
  const out: ReportDeal[] = open.map((i) => {
    const id = String(i.id);
    const stage = r.stageById[String(i.stage_id)];
    const hist = r.history.filter((h) => String(h.item_id) === id && h.stage_id).sort((a, b) => String(a.entered_at).localeCompare(String(b.entered_at)));
    const acts: { at: string; text: string }[] = [];
    let moved: { from: string; on: string } | null = null;
    hist.forEach((h, n) => {
      const s = r.stageById[String(h.stage_id)];
      const on = r.local(String(h.entered_at));
      if (!s || !inPeriod(on)) return;
      const prev = n ? r.stageById[String(hist[n - 1].stage_id)] : null;
      if (!prev) acts.push({ at: String(h.entered_at), text: s.name === "Interested" ? "screened in as Interested" : `added at ${s.name}` });
      else if (prev.name !== s.name) {
        acts.push({ at: String(h.entered_at), text: `moved to ${s.name}` });
        moved = { from: prev.name, on };
      }
    });
    for (const c of r.comms) {
      if (String(c.pipeline_item_id ?? "") !== id || c.awaiting_log) continue;
      const at = String(c.occurred_at);
      if (!inPeriod(r.local(at))) continue;
      const who = c.contact_id ? person.get(String(c.contact_id)) || "someone" : "someone";
      // "CIM received from Rachel Kim" does not repeat the name already at the front.
      const subject = String(c.subject ?? "").trim().replace(new RegExp(`\\s+(from|to|with)\\s+${who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "");
      const m = String(c.method ?? "");
      if (m === "email") acts.push({ at, text: c.direction === "incoming" ? `${who} emailed${subject ? `: ${subject}` : ""}` : `emailed ${who}${subject ? `: ${subject}` : ""}` });
      else if (m === "call" || m === "meeting" || m === "video") acts.push({ at, text: `${m === "meeting" ? "met" : m === "video" ? "video call with" : "call with"} ${who}${c.call_minutes ? `, ${c.call_minutes} min` : ""}` });
    }
    for (const n of r.notes) {
      if (String(n.record_id) !== id) continue;
      const at = String(n.created_at);
      if (!inPeriod(r.local(at))) continue;
      const first = String(n.body ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
      if (first) acts.push({ at, text: `note: ${first.length > 90 ? `${first.slice(0, 87).replace(/\s+\S*$/, "")}...` : first}` });
    }
    for (const e of r.events) {
      if (e.kind !== "next_action_done" || String(e.record_id ?? "") !== id) continue;
      const on = String(e.happened_on).slice(0, 10);
      if (!inPeriod(on)) continue;
      const action = String((e.meta as Row | null)?.action ?? "").trim();
      acts.push({ at: String(e.happened_at ?? `${on}T12:00:00Z`), text: action ? `done: ${lowerFirst(action)}` : "next action done" });
    }
    acts.sort((a, b) => a.at.localeCompare(b.at));
    const stamps = [...hist.map((h) => String(h.entered_at)), ...acts.map((a) => a.at), String(i.updated_at ?? "")].filter(Boolean).sort();
    const lastActivity = stamps[stamps.length - 1] ?? "";
    const what = String(i.waiting_on ?? "").trim();
    const who = (i.primary_contact_id ? person.get(String(i.primary_contact_id)) : null) || brokerPerson(i.broker_name as string | null);
    let status: string;
    if (what) {
      const since = i.waiting_since ? String(i.waiting_since).slice(0, 10) : null;
      const when = since ? `, since ${r.fmt(since)} (${days(Math.max(0, daysBetween(since, r.today)))})` : "";
      // "Jamal Whitaker" as what is waited on names the person: it is not repeated or lowered.
      const isName = /^[A-Z][a-z]+ [A-Z][a-z]/.test(what);
      const names = !!who && what.toLowerCase().includes(who.toLowerCase());
      status = who && !names ? `Waiting on ${who}: ${isName ? what : lowerFirst(what)}${when}` : `Waiting on ${isName || names ? what : lowerFirst(what)}${when}`;
    } else if (moved) {
      const m = moved as { from: string; on: string };
      status = `Moved from ${m.from} ${m.on === r.today ? "today" : `on ${r.weekday(m.on)}`}; nothing waiting`;
    } else {
      const entered = hist.filter((h) => String(h.stage_id) === String(i.stage_id)).pop();
      const since = entered ? r.local(String(entered.entered_at)) : null;
      status = since ? `In ${stage.name} since ${r.fmt(since)}; nothing waiting` : "Nothing waiting";
    }
    const action = String(i.next_action ?? "").trim();
    const due = i.next_action_due ? String(i.next_action_due).slice(0, 10) : null;
    const next = action ? `${action}${due ? `, ${due === r.today ? "today" : r.fmt(due)}` : ""}` : null;
    // A job opportunity reads "VP Operations, Harbor Home Health" (the role, then the company).
    const company = displayName({ name: String(i.name ?? ""), companyName: (i.company_name as string | null) ?? null });
    const role = String(i.role_title ?? "").trim();
    return { id, name: role && !company.includes(role) ? `${role}, ${company}` : company, stage: stage.name, position: stage.position, lastActivity, status, next, activity: acts.map((a) => a.text) };
  });
  return out.sort((a, b) => (a.position !== b.position ? b.position - a.position : a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
}
