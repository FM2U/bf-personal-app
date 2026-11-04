import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { loadComposeSetup, loadGmailSetup, type ComposeSetup, type GmailSetup } from "@/lib/compose-email";
import { organizationRecipients } from "@/lib/calc/compose-email";
import type { Ctx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { orgKindLabel, parseOrgKind, type OrgKind } from "@/lib/work/people";
import { CONTACT_COLUMNS, toPersonRow, type PersonRow } from "@/lib/work/outreach-data";
import { daysWaiting, waitLevel, type WaitLevel } from "@/lib/work/stages";
import { commKind, commTitle, type TimelineEvent } from "@/lib/work/timeline";
import { RECORD_TASK_COLUMNS, sortTodos, toDealTodo, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * Organizations (push B, 2026-11-03): the firms Bram works with (brokers, lenders, employers, clients, investors).
 * People belong to an organization through contacts.organization_id. A deal's company stays on the deal; the
 * organization page lists the deals that come from the firm (the deal's organization is the firm, or its main
 * contact works there). Nothing here writes; the actions are in src/app/actions/organizations.ts.
 */

export type OrgRow = {
  id: string;
  name: string;
  kind: OrgKind;
  kindLabel: string;
  region: string | null;
  website: string | null;
  phone: string | null;
  /** The first line of the notes: what the firm is ("business brokers, lower middle market"). */
  note: string | null;
  notes: string | null;
  dealSize: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  peopleNames: string[];
  peopleCount: number;
  openDeals: number;
  /** The newest last contact of anyone at the firm (owner's date) and its kind. */
  lastContactOn: string | null;
  lastContactKind: string | null;
};

function toOrgRow(o: Row, people: Row[], openDeals: number, tz: string): OrgRow {
  const mine = people.filter((p) => String(p.organization_id ?? "") === String(o.id) && !p.archived_at);
  const last = mine.filter((p) => p.last_contact_at).sort((a, b) => String(b.last_contact_at).localeCompare(String(a.last_contact_at)))[0] ?? null;
  const note = String(o.notes ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? null;
  return {
    id: String(o.id),
    name: String(o.name ?? ""),
    kind: parseOrgKind(o.kind),
    kindLabel: orgKindLabel(o.kind),
    region: o.region ? String(o.region) : null,
    website: o.website ? String(o.website) : null,
    phone: o.phone ? String(o.phone) : null,
    note,
    notes: o.notes ? String(o.notes) : null,
    dealSize: o.deal_size ? String(o.deal_size) : null,
    nextAction: o.next_action ? String(o.next_action) : null,
    nextActionDue: o.next_action_due ? String(o.next_action_due).slice(0, 10) : null,
    archived: !!o.archived_at,
    archivedAt: o.archived_at ? String(o.archived_at) : null,
    createdAt: String(o.created_at ?? ""),
    peopleNames: mine.map((p) => String(p.name)).sort((a, b) => a.localeCompare(b)),
    peopleCount: mine.length,
    openDeals,
    lastContactOn: last ? todayInTz(tz, new Date(String(last.last_contact_at))) : null,
    lastContactKind: last ? String(last.last_contact_kind ?? "") || null : null,
  };
}

/** The deals from a firm: its own (organization_id) and those whose main contact works there. */
function itemsOf(orgId: string, items: Row[], peopleIds: Set<string>): Row[] {
  return items.filter((i) => String(i.organization_id ?? "") === orgId || (i.primary_contact_id && peopleIds.has(String(i.primary_contact_id))));
}

export type OrganizationsData = { orgs: OrgRow[]; archived: OrgRow[]; composes: Record<string, ComposeSetup> };

/** The email setup for "Email" on an organization row: anyone at the firm with an address. */
function composeForOrg(gmail: GmailSetup, o: OrgRow, people: Row[]): ComposeSetup {
  const mine = people.filter((p) => String(p.organization_id ?? "") === o.id && !p.archived_at && p.email);
  const { recipients, defaultTo } = organizationRecipients(mine.map((p) => ({ id: String(p.id), name: String(p.name), email: String(p.email) })));
  return { ...gmail, title: `Email someone at ${o.name}`, recipients, defaultTo: defaultTo?.email ?? "", contactId: null, pipelineItemId: null, organizationId: o.id, toNote: recipients.length ? null : "No one at this organization has an email address saved. Type an address." };
}

/** People, Organizations: every organization A to Z with its people, open deals, and last contact. */
export async function loadOrganizations(sb: SupabaseClient, ctx: Ctx): Promise<OrganizationsData> {
  const [{ data: orgs, error }, { data: people }, { data: items }, gmail] = await Promise.all([
    sb.from("organizations").select("*").eq("owner_id", ctx.ownerId).order("name").limit(2000),
    sb.from("contacts").select("id,name,email,organization_id,archived_at,last_contact_at,last_contact_kind").eq("owner_id", ctx.ownerId).limit(5000),
    sb.from("pipeline_items").select("id,organization_id,primary_contact_id,status,screened").eq("owner_id", ctx.ownerId).eq("status", "open").limit(5000),
    loadGmailSetup(sb, ctx.ownerId),
  ]);
  if (error) throw new Error(error.message);
  const ppl = (people ?? []) as Row[];
  const open = ((items ?? []) as Row[]).filter((i) => i.screened !== false);
  const all = ((orgs ?? []) as Row[]).map((o) => {
    const ids = new Set(ppl.filter((p) => String(p.organization_id ?? "") === String(o.id)).map((p) => String(p.id)));
    return toOrgRow(o, ppl, itemsOf(String(o.id), open, ids).length, ctx.tz);
  });
  const live = all.filter((o) => !o.archived).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { orgs: live, archived: all.filter((o) => o.archived), composes: Object.fromEntries(live.map((o) => [o.id, composeForOrg(gmail, o, ppl)])) };
}

/** A deal from the firm on its page (the Deals card). */
export type OrgDeal = { id: string; name: string; href: string; lane: "Deals" | "Job search" | "Consulting"; stageName: string | null; status: string; nextAction: string | null; waitingOn: string | null; waitDays: number; waitLevel: WaitLevel; contactName: string | null; passReason: string | null };

export type OrgPageData = {
  today: string;
  tz: string;
  org: OrgRow | null;
  people: PersonRow[];
  /** Everyone not at this firm (the "+ Add a person" picker). */
  others: { id: string; name: string; organization: string | null }[];
  deals: OrgDeal[];
  passed: OrgDeal[];
  tasks: DealTodo[];
  timeline: TimelineEvent[];
  compose: ComposeSetup | null;
};

const PASS_WORDS: Record<string, string> = { too_small: "too small", too_big: "too big", location: "location", franchise: "franchise", retail_dtc: "retail", no_growth_path: "no growth path" };

/** The organization page: the firm, its people, the deals from it, its tasks, and the timeline of everyone there. */
export async function loadOrgPage(sb: SupabaseClient, ctx: Ctx, id: string): Promise<OrgPageData> {
  const base: OrgPageData = { today: ctx.today, tz: ctx.tz, org: null, people: [], others: [], deals: [], passed: [], tasks: [], timeline: [], compose: null };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return base;
  const { data: row } = await sb.from("organizations").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  const o = row as Row | null;
  if (!o) return base;
  const [{ data: people }, { data: allPeople }, { data: orgNames }, { data: taskRows }, { data: notes }, { data: pipes }] = await Promise.all([
    sb.from("contacts").select(CONTACT_COLUMNS).eq("owner_id", ctx.ownerId).eq("organization_id", id).order("name").limit(500),
    sb.from("contacts").select("id,name,organization_id,archived_at").eq("owner_id", ctx.ownerId).order("name").limit(5000),
    sb.from("organizations").select("id,name").eq("owner_id", ctx.ownerId).limit(5000),
    sb.from("deal_todos").select(RECORD_TASK_COLUMNS).eq("owner_id", ctx.ownerId).eq("record_type", "organizations").eq("record_id", id).limit(500),
    sb.from("notes").select("id,body,created_at").eq("record_type", "organizations").eq("record_id", id).order("created_at", { ascending: false }).limit(50),
    sb.from("pipelines").select("id,kind").eq("owner_id", ctx.ownerId),
  ]);
  const ppl = (people ?? []) as Row[];
  const peopleIds = ppl.map((p) => String(p.id));
  const idSet = new Set(peopleIds);
  const orItems = [`organization_id.eq.${id}`, ...(peopleIds.length ? [`primary_contact_id.in.(${peopleIds.join(",")})`] : [])].join(",");
  const [{ data: items }, { data: comms }, { data: stages }, compose] = await Promise.all([
    sb.from("pipeline_items").select("id,name,company_name,pipeline_id,status,stage_id,screened,next_action,waiting_on,waiting_since,primary_contact_id,organization_id,pass_reason").eq("owner_id", ctx.ownerId).or(orItems).limit(500),
    sb.from("communications").select("id,occurred_at,method,direction,subject,summary,call_minutes,call_outcome,awaiting_log,contact_id,partner_report_id").eq("owner_id", ctx.ownerId).or([`organization_id.eq.${id}`, ...(peopleIds.length ? [`contact_id.in.(${peopleIds.join(",")})`] : [])].join(",")).order("occurred_at", { ascending: false }).limit(80),
    sb.from("pipeline_stages").select("id,name,outcome").eq("owner_id", ctx.ownerId).limit(500),
    loadComposeSetup(sb, ctx.ownerId, "organizations", o).catch(() => null),
  ]);
  const orgRow = toOrgRow(o, ppl, 0, ctx.tz);
  const kindOf = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [String(p.id), String(p.kind)]));
  const stageOf = Object.fromEntries(((stages ?? []) as Row[]).map((s) => [String(s.id), s]));
  const nameOf = Object.fromEntries(ppl.map((p) => [String(p.id), String(p.name)]));
  const toDeal = (i: Row): OrgDeal => {
    const kind = kindOf[String(i.pipeline_id)] ?? "acquisition";
    const days = daysWaiting((i.waiting_since as string | null) ?? null, ctx.today);
    return {
      id: String(i.id),
      name: String(i.company_name || i.name),
      href: kind === "job" ? `/work/jobs/${i.id}` : kind === "consulting" ? `/work/consulting/${i.id}` : `/work/deals/${i.id}`,
      lane: kind === "job" ? "Job search" : kind === "consulting" ? "Consulting" : "Deals",
      stageName: i.stage_id ? String(stageOf[String(i.stage_id)]?.name ?? "") || null : i.screened === false ? "Listing" : null,
      status: String(i.status ?? "open"),
      nextAction: i.next_action ? String(i.next_action) : null,
      waitingOn: i.waiting_on ? String(i.waiting_on) : null,
      waitDays: days,
      waitLevel: waitLevel((i.waiting_on as string | null) ?? null, days),
      contactName: i.primary_contact_id ? nameOf[String(i.primary_contact_id)] ?? null : null,
      passReason: i.pass_reason ? PASS_WORDS[String(i.pass_reason)] ?? String(i.pass_reason).replace(/_/g, " ") : null,
    };
  };
  const all = ((items ?? []) as Row[]).filter((i) => String(i.organization_id ?? "") === id || (i.primary_contact_id && idSet.has(String(i.primary_contact_id))));
  const deals = all.filter((i) => i.status === "open").map(toDeal);
  const passed = all.filter((i) => i.status !== "open").map(toDeal);
  orgRow.openDeals = deals.length;
  const orgName = String(o.name);
  const nameOrg = Object.fromEntries(((orgNames ?? []) as Row[]).map((x) => [String(x.id), String(x.name)]));
  const timeline: TimelineEvent[] = [
    ...((notes ?? []) as Row[]).map((n) => ({ id: `note:${n.id}`, kind: "note" as const, when: String(n.created_at), date: fmtDate(String(n.created_at), "MMM d"), title: "Note", detail: String(n.body ?? "").slice(0, 400) || null, href: null })),
    ...((comms ?? []) as Row[])
      .filter((m) => !m.awaiting_log)
      .map((m) => ({
        id: `comm:${m.id}`,
        kind: commKind(m.method),
        when: String(m.occurred_at),
        date: fmtDate(String(m.occurred_at), "MMM d"),
        title: `${commTitle(m)}${m.contact_id && nameOf[String(m.contact_id)] ? ` · ${nameOf[String(m.contact_id)]}` : ""}`,
        detail: [m.summary ? String(m.summary).slice(0, 240) : null, m.call_outcome ? `Next: ${String(m.call_outcome).slice(0, 160)}` : null].filter(Boolean).join(" ") || null,
        href: null,
      })),
  ].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  return {
    ...base,
    org: orgRow,
    people: ppl.map((c) => toPersonRow(c, orgName, ctx.tz)),
    others: ((allPeople ?? []) as Row[]).filter((p) => !p.archived_at && String(p.organization_id ?? "") !== id).map((p) => ({ id: String(p.id), name: String(p.name), organization: p.organization_id ? nameOrg[String(p.organization_id)] ?? null : null })),
    deals,
    passed,
    tasks: sortTodos(((taskRows ?? []) as Row[]).map(toDealTodo)),
    timeline,
    compose: compose ? { ...compose } : null,
  };
}
