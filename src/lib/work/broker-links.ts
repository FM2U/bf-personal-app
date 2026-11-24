/**
 * Broker links (push K, Bram 2026-11-24; claude/2026-11-24-broker-links-build-plan.md), pure and tested in
 * src/lib/work/broker-links.test.ts. A deal's broker is a person on Contacts (pipeline_items.primary_contact_id), with
 * an optional associate (a second person at the brokerage) and a brokerage (an organization), in place of the typed
 * "Firm, person" text. This file holds the rules that need no database:
 *  - reading the typed text into a person and a firm, and matching each to what is on file (the "Brokers to link" list);
 *  - the role a person gets when picked as a deal's broker or associate;
 *  - who counts as a broker (Role or Also).
 */

/** A pick in a Broker, Associate or Brokerage box: a record on file, a new name to add, or nothing. */
export type BrokerPick = { id: string | null; name: string } | null;

/** What the Facts form sends for a deal: its three picks. */
export type DealBrokerLinks = { broker: BrokerPick; associate: BrokerPick; brokerage: BrokerPick };
/** A deal's links as its page shows them; `ready` is false before the database update (the typed text shows). */
export type DealBrokerView = { ready: boolean; broker: { id: string; name: string } | null; associate: { id: string; name: string } | null; brokerage: { id: string; name: string } | null };
export const NO_BROKER_VIEW: DealBrokerView = { ready: false, broker: null, associate: null, brokerage: null };

export type BrokerChoicePerson = { id: string; name: string; role: string | null; organizationId: string | null; organization: string | null };
export type BrokerChoiceOrg = { id: string; name: string; kind: string | null };
export type BrokerChoices = { people: BrokerChoicePerson[]; organizations: BrokerChoiceOrg[] };

const FIRM_WORDS = /\b(advisors?|advisory|brokers?|brokerage|business|partners?|group|llc|inc|corp|company|capital|associates|consulting|holdings|m&a|mergers|acquisitions|sunbelt|transworld|bizbuysell|firm|team|network|services)\b/i;
const PERSON = /^[A-Z][A-Za-z'’.-]*\.? [A-Z]/;

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "").trim();
const key = (s: string) => tidy(s).toLowerCase();

/** A part of the typed text reads as a person's name ("Mark Reed", "Rita C.") and not as a firm. */
export function looksLikePerson(part: string): boolean {
  const t = tidy(part);
  return PERSON.test(t) && !FIRM_WORDS.test(t) && t.split(" ").length <= 4;
}

/**
 * The typed broker text ("Transworld, Mark Reed", "Mark Reed (Sunbelt)", "Mark Reed at Sunbelt", "Sunbelt") as a
 * person and a firm. `known` settles a part that is already on file whatever it looks like.
 */
export function parseBrokerText(text: string | null | undefined, known: { people?: readonly string[]; organizations?: readonly string[] } = {}): { person: string | null; firm: string | null } {
  const raw = String(text ?? "").trim();
  if (!raw) return { person: null, firm: null };
  const parts = raw
    .replace(/\(([^)]+)\)/g, ", $1")
    .split(/,|;|\/|\s[-–—]\s|\s+(?:at|of|with|from)\s+|\s@\s/i)
    .map(tidy)
    .filter(Boolean);
  const people = new Set((known.people ?? []).map(key));
  const orgs = new Set((known.organizations ?? []).map(key));
  let person: string | null = null;
  let firm: string | null = null;
  const rest: string[] = [];
  for (const p of parts) {
    if (!person && people.has(key(p))) person = p;
    else if (!firm && orgs.has(key(p))) firm = p;
    else rest.push(p);
  }
  for (const p of rest) {
    if (!person && looksLikePerson(p)) person = p;
    else if (!firm) firm = p;
  }
  return { person, firm };
}

export type BrokerMatch = { id: string | null; name: string; /** Not on file: confirming adds it. */ isNew: boolean; /** A likely match, not an exact one ("Rita C." for Rita Caldwell): shown with a question mark. */ guess: boolean };

/** The record on file for a typed name: the same name in any letter case, else the one likely match, else a new record. */
export function matchName(typed: string | null, list: readonly { id: string; name: string }[], kind: "person" | "organization"): BrokerMatch | null {
  const t = tidy(String(typed ?? ""));
  if (!t) return null;
  const exact = list.find((x) => key(x.name) === key(t));
  if (exact) return { id: exact.id, name: exact.name, isNew: false, guess: false };
  const k = key(t).replace(/\.$/, "");
  let likely: { id: string; name: string }[] = [];
  if (kind === "person") {
    // "Rita C." or "Rita C" for Rita Caldwell; "R. Caldwell" for Rita Caldwell.
    const [a, b] = k.split(" ");
    if (a && b) {
      likely = list.filter((x) => {
        const [fa, ...more] = key(x.name).split(" ");
        const last = more[more.length - 1] ?? "";
        const b0 = b.replace(/\.$/, "");
        const a0 = a.replace(/\.$/, "");
        return (fa === a0 && b0.length <= 2 && last.startsWith(b0)) || (a0.length <= 2 && fa.startsWith(a0) && last === b0);
      });
    }
  } else {
    // "Sunbelt" for "Sunbelt Business Brokers" and the other way round.
    likely = list.filter((x) => key(x.name).startsWith(`${k} `) || k.startsWith(`${key(x.name)} `));
  }
  if (likely.length === 1) return { id: likely[0].id, name: likely[0].name, isNew: false, guess: true };
  return { id: null, name: t, isNew: true, guess: false };
}

export type BrokerProposal = { dealId: string; deal: string; typed: string; broker: BrokerMatch | null; brokerage: BrokerMatch | null };

/** One row of "Brokers to link": the deal's typed text and what the app proposes for it. */
export function proposeLink(deal: { id: string; name: string; brokerName: string | null }, choices: BrokerChoices): BrokerProposal | null {
  const typed = tidy(String(deal.brokerName ?? ""));
  if (!typed) return null;
  const parsed = parseBrokerText(typed, { people: choices.people.map((p) => p.name), organizations: choices.organizations.map((o) => o.name) });
  const broker = matchName(parsed.person, choices.people, "person");
  let brokerage = matchName(parsed.firm, choices.organizations, "organization");
  // No firm typed: the broker's own organization when they are on file with one.
  if (!brokerage && broker?.id) {
    const p = choices.people.find((x) => x.id === broker.id);
    if (p?.organizationId && p.organization) brokerage = { id: p.organizationId, name: p.organization, isNew: false, guess: false };
  }
  return { dealId: deal.id, deal: deal.name, typed, broker, brokerage };
}

/**
 * The roles of a person picked as a deal's broker or associate: Broker becomes their Role when they have none (or
 * Other), else their second role ("Also") when that is free. A person who already has two other roles keeps them.
 */
export function rolesWithBroker(role: string | null | undefined, second: string | null | undefined): { role: string | null; second: string | null; changed: boolean } {
  const r = role || null;
  const s = second || null;
  if (r === "broker" || s === "broker") return { role: r, second: s, changed: false };
  if (!r || r === "other") return { role: "broker", second: s, changed: true };
  if (!s) return { role: r, second: "broker", changed: true };
  return { role: r, second: s, changed: false };
}

/** A person counts as a broker when Role or Also is Broker. */
export function isBrokerPerson(c: { outreach_role?: unknown; second_role?: unknown } | null | undefined): boolean {
  return c?.outreach_role === "broker" || c?.second_role === "broker";
}

/** The typed text a deal keeps beside its links ("Transworld, Mark Reed"), so lists that read the text stay right. */
export function brokerText(broker: string | null, brokerage: string | null): string | null {
  return [brokerage, broker].map((x) => tidy(String(x ?? ""))).filter(Boolean).join(", ") || null;
}
