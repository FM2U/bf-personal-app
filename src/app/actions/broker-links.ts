"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import type { Row } from "@/lib/types";
import { loadWorkPipeline } from "@/lib/work/data";
import { proposeLink, type BrokerChoices, type BrokerPick, type BrokerProposal } from "@/lib/work/broker-links";
import { attachPersonlessCalls, DB_UPDATE_NOTICE_PUSH_K, hasPushK, loadBrokerChoices, saveDealBrokerLinks } from "@/lib/work/broker-links-data";

/**
 * Broker links (push K, Bram 2026-11-24; claude/2026-11-24-broker-links-build-plan.md): what the Broker, Associate and
 * Brokerage boxes offer, and the "Brokers to link" list (open deals whose broker is still typed text: what the app
 * proposes for each, and Confirm). Every action returns { ok: false, error } instead of throwing.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The people and organizations the boxes offer (read when a box opens, so pages load no slower). */
export async function brokerChoices(): Promise<{ ok: true; choices: BrokerChoices } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  return { ok: true, choices: await loadBrokerChoices(supabase, ownerId) };
}

/** The open deals whose broker is typed text with no person and no brokerage linked. */
async function unlinkedDeals(sb: Awaited<ReturnType<typeof requireOwner>>["supabase"], ownerId: string): Promise<{ ready: boolean; rows: Row[] }> {
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ready: true, rows: [] };
  const { data, error } = await sb.from("pipeline_items").select("id,name,company_name,broker_name,stage_id,status,screened,primary_contact_id,broker_organization_id").eq("owner_id", ownerId).eq("pipeline_id", pipe.id).eq("screened", true).is("primary_contact_id", null).is("broker_organization_id", null).not("broker_name", "is", null).limit(500);
  if (error) return { ready: false, rows: [] };
  const open = ((data ?? []) as Row[]).filter((i) => {
    const stage = i.stage_id ? pipe.byId[String(i.stage_id)] : null;
    return String(i.broker_name ?? "").trim() && (!stage || stage.outcome === "open");
  });
  return { ready: true, rows: open };
}

/** How many deals wait on the "Brokers to link" list (the line at the top of Deals). 0 before the database update. */
export async function brokersToLinkCount(): Promise<number> {
  const { supabase, ownerId } = await requireOwner();
  return (await unlinkedDeals(supabase, ownerId)).rows.length;
}

export async function brokersToLink(): Promise<{ ok: true; rows: BrokerProposal[]; choices: BrokerChoices } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const [list, choices] = await Promise.all([unlinkedDeals(supabase, ownerId), loadBrokerChoices(supabase, ownerId)]);
  if (!list.ready) return fail(DB_UPDATE_NOTICE_PUSH_K);
  const rows = list.rows
    .map((i) => proposeLink({ id: String(i.id), name: String(i.company_name || i.name || "").replace(/^00 /, ""), brokerName: i.broker_name as string | null }, choices))
    .filter((r): r is BrokerProposal => !!r)
    .sort((a, b) => a.deal.localeCompare(b.deal));
  return { ok: true, rows, choices };
}

export type ConfirmLink = { dealId: string; broker: BrokerPick; brokerage: BrokerPick };

/**
 * Confirm on "Brokers to link": each deal is linked to its broker and brokerage (new ones are added), and the deal's
 * calls and meetings logged with no person are attached to the broker. Rows are saved one after another, so a new
 * broker or brokerage named on two rows is added once. Stops at the first row that fails and says which.
 */
export async function confirmBrokerLinks(rows: ConfirmLink[]): Promise<{ ok: true; linked: number; attached: number } | (Fail & { linked: number })> {
  const { supabase, ownerId } = await requireOwner();
  let linked = 0;
  let attached = 0;
  for (const r of rows.slice(0, 200)) {
    if (!UUID.test(String(r.dealId))) return { ...fail("A deal on the list was not found."), linked };
    if (!r.broker && !r.brokerage) continue;
    const { data: item } = await supabase.from("pipeline_items").select("*").eq("owner_id", ownerId).eq("id", r.dealId).maybeSingle();
    if (!item) return { ...fail("A deal on the list was not found. It may have been deleted."), linked };
    if (!hasPushK(item as Row)) return { ...fail(DB_UPDATE_NOTICE_PUSH_K), linked };
    const saved = await saveDealBrokerLinks(supabase, ownerId, item as Row, { broker: r.broker, associate: null, brokerage: r.brokerage });
    if (!saved.ok) return { ...fail(`${String((item as Row).company_name || (item as Row).name)}: ${saved.error}`), linked };
    if (saved.value.brokerId) attached += await attachPersonlessCalls(supabase, ownerId, String(r.dealId), saved.value.brokerId);
    linked++;
  }
  revalidatePath("/", "layout");
  return { ok: true, linked, attached };
}
