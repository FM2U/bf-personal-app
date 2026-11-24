import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "@/lib/types";
import { brokerText, rolesWithBroker, type BrokerChoices, type BrokerPick, type DealBrokerLinks } from "@/lib/work/broker-links";
import { roleLabel } from "@/lib/work/outreach";

/**
 * Broker links, the database side (push K, Bram 2026-11-24; claude/2026-11-24-broker-links-build-plan.md): the people
 * and organizations the Broker, Associate and Brokerage boxes offer, and the one save that links a deal to them. A new
 * name is added to Contacts (role Broker) or to Organizations (kind Broker); anyone picked as Broker or Associate gets
 * the role Broker (as Role, or as Also when they already have a role). Used by the deal's Facts, Add listing, and the
 * one-time "Brokers to link" list.
 */

export const DB_UPDATE_NOTICE_PUSH_K = "Database update needed: paste supabase/UPDATE_PREVIEW_PUSH_K.sql into the Supabase SQL Editor and run it.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const err = (error: string) => ({ ok: false as const, error });

/** A deal row read with "*" has the push K columns once the update has run. */
export function hasPushK(item: Row | null | undefined): boolean {
  return !!item && Object.prototype.hasOwnProperty.call(item, "broker_organization_id");
}

export async function loadBrokerChoices(sb: SupabaseClient, ownerId: string): Promise<BrokerChoices> {
  const [{ data: people }, { data: orgs }] = await Promise.all([
    sb.from("contacts").select("id,name,outreach_role,organization_id,archived_at").eq("owner_id", ownerId).is("archived_at", null).limit(5000),
    sb.from("organizations").select("id,name,kind,archived_at").eq("owner_id", ownerId).is("archived_at", null).limit(5000),
  ]);
  const orgName = new Map(((orgs ?? []) as Row[]).map((o) => [String(o.id), String(o.name ?? "")]));
  return {
    people: ((people ?? []) as Row[])
      .filter((p) => String(p.name ?? "").trim() && p.outreach_role !== "accountability_partner")
      .map((p) => ({ id: String(p.id), name: String(p.name), role: roleLabel(p.outreach_role as string | null), organizationId: p.organization_id ? String(p.organization_id) : null, organization: p.organization_id ? orgName.get(String(p.organization_id)) ?? null : null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    organizations: ((orgs ?? []) as Row[])
      .filter((o) => String(o.name ?? "").trim())
      .map((o) => ({ id: String(o.id), name: String(o.name), kind: o.kind ? String(o.kind) : null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The organization picked: the one on file, the one of that name (any letter case), or a new brokerage. */
async function organizationFor(sb: SupabaseClient, ownerId: string, pick: BrokerPick): Promise<Result<Row | null>> {
  if (!pick) return { ok: true, value: null };
  if (pick.id) {
    if (!UUID.test(pick.id)) return err("This brokerage was not found.");
    const { data } = await sb.from("organizations").select("id,name").eq("owner_id", ownerId).eq("id", pick.id).maybeSingle();
    return data ? { ok: true, value: data as Row } : err("This brokerage was not found. It may have been deleted.");
  }
  const name = clean(pick.name, 200);
  if (!name) return { ok: true, value: null };
  const { data: hit } = await sb.from("organizations").select("id,name").eq("owner_id", ownerId).ilike("name", name).limit(1);
  if (((hit ?? []) as Row[])[0]) return { ok: true, value: ((hit ?? []) as Row[])[0] };
  const { data: made, error } = await sb.from("organizations").insert({ owner_id: ownerId, name, kind: "broker" }).select("id,name").single();
  if (error) return err(`The brokerage was not added: ${error.message}`);
  return { ok: true, value: made as Row };
}

/** The person picked: the one on file, the one of that name, or a new person; they get the role Broker either way. */
async function personFor(sb: SupabaseClient, ownerId: string, pick: BrokerPick, orgId: string | null, what: "broker" | "associate"): Promise<Result<Row | null>> {
  if (!pick) return { ok: true, value: null };
  let person: Row | null = null;
  if (pick.id) {
    if (!UUID.test(pick.id)) return err(`This ${what} was not found.`);
    const { data } = await sb.from("contacts").select("*").eq("owner_id", ownerId).eq("id", pick.id).maybeSingle();
    person = (data as Row | null) ?? null;
    if (!person) return err(`This ${what} was not found on Contacts. They may have been deleted.`);
  } else {
    const name = clean(pick.name, 200);
    if (!name) return { ok: true, value: null };
    const { data: hit } = await sb.from("contacts").select("*").eq("owner_id", ownerId).ilike("name", name).is("archived_at", null).limit(1);
    person = ((hit ?? []) as Row[])[0] ?? null;
    if (!person) {
      const { data: made, error } = await sb.from("contacts").insert({ owner_id: ownerId, name, outreach_role: "broker", organization_id: orgId }).select("*").single();
      if (error) return err(`The ${what} was not added to Contacts: ${error.message}`);
      return { ok: true, value: made as Row };
    }
  }
  const update: Row = {};
  const hasSecond = Object.prototype.hasOwnProperty.call(person, "second_role");
  const roles = rolesWithBroker(person.outreach_role as string | null, hasSecond ? (person.second_role as string | null) : "taken");
  if (roles.changed) {
    if (roles.role !== (person.outreach_role ?? null)) update.outreach_role = roles.role;
    if (hasSecond && roles.second !== (person.second_role ?? null)) update.second_role = roles.second;
  }
  // A person with no organization joins the deal's brokerage.
  if (orgId && !person.organization_id) update.organization_id = orgId;
  if (Object.keys(update).length) {
    const { error } = await sb.from("contacts").update(update).eq("id", person.id);
    if (error) return err(`The ${what} was not updated on Contacts: ${error.message}`);
    person = { ...person, ...update };
  }
  return { ok: true, value: person };
}

export type SavedBrokerLinks = { brokerId: string | null; broker: string | null; associateId: string | null; associate: string | null; brokerageId: string | null; brokerage: string | null };

/**
 * Links a deal to its broker, associate and brokerage (each a record on file, a new name, or nothing), and keeps the
 * deal's typed text in step ("Transworld, Mark Reed"). With no brokerage picked, the broker's own organization is used.
 */
export async function saveDealBrokerLinks(sb: SupabaseClient, ownerId: string, item: Row, links: DealBrokerLinks): Promise<Result<SavedBrokerLinks>> {
  if (!hasPushK(item)) return err(DB_UPDATE_NOTICE_PUSH_K);
  if (links.broker && links.associate && ((links.broker.id && links.broker.id === links.associate.id) || (!links.broker.id && !links.associate.id && clean(links.broker.name, 200)?.toLowerCase() === clean(links.associate.name, 200)?.toLowerCase()))) return err("The associate is the same person as the broker. Pick someone else, or leave Associate empty.");
  const org = await organizationFor(sb, ownerId, links.brokerage);
  if (!org.ok) return org;
  const broker = await personFor(sb, ownerId, links.broker, org.value ? String(org.value.id) : null, "broker");
  if (!broker.ok) return broker;
  // No brokerage picked: the broker's own organization.
  let brokerage = org.value;
  if (!brokerage && broker.value?.organization_id) {
    const { data } = await sb.from("organizations").select("id,name").eq("owner_id", ownerId).eq("id", broker.value.organization_id).maybeSingle();
    brokerage = (data as Row | null) ?? null;
  }
  const associate = await personFor(sb, ownerId, links.associate, brokerage ? String(brokerage.id) : null, "associate");
  if (!associate.ok) return associate;
  if (broker.value && associate.value && String(broker.value.id) === String(associate.value.id)) return err("The associate is the same person as the broker. Pick someone else, or leave Associate empty.");
  const saved: SavedBrokerLinks = {
    brokerId: broker.value ? String(broker.value.id) : null,
    broker: broker.value ? String(broker.value.name) : null,
    associateId: associate.value ? String(associate.value.id) : null,
    associate: associate.value ? String(associate.value.name) : null,
    brokerageId: brokerage ? String(brokerage.id) : null,
    brokerage: brokerage ? String(brokerage.name) : null,
  };
  const { error } = await sb
    .from("pipeline_items")
    .update({ primary_contact_id: saved.brokerId, broker_associate_contact_id: saved.associateId, broker_organization_id: saved.brokerageId, broker_name: brokerText(saved.broker, saved.brokerage) })
    .eq("id", item.id);
  if (error) return err(`The broker was not saved: ${error.message}`);
  return { ok: true, value: saved };
}

/**
 * The deal's calls and meetings logged with no person are attached to its broker (the "Brokers to link" list), so the
 * counts of the days they were logged on catch up. Returns how many were attached.
 */
export async function attachPersonlessCalls(sb: SupabaseClient, ownerId: string, dealId: string, contactId: string): Promise<number> {
  const { data } = await sb.from("communications").update({ contact_id: contactId, is_outreach: true }).eq("owner_id", ownerId).eq("pipeline_item_id", dealId).is("contact_id", null).in("method", ["call", "meeting", "video"]).select("id");
  return ((data ?? []) as Row[]).length;
}
