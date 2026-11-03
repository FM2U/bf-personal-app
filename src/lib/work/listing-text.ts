/**
 * "Fill from text" on Add a listing: the pasted broker email or page text goes to the AI, which returns the fields as
 * JSON. This file is the pure part (tested in src/lib/work/listing-text.test.ts): the prompt, the strict check of the
 * reply (used by callForJson, which asks once more with the problems listed), and the clean-up of what comes back.
 * The call itself is in src/app/actions/work.ts (fillListingFromText). Since Edit batch A (2026-10-31) the reply
 * carries a listing name (a plain description, shown as "00 ..." until the company is named) and the company name
 * when the text names it, and "Cash Flow" on a listing is read as SDE. Edit batch C round 3: the link field takes the
 * first web address (http or https) in the pasted text; the prompt asks for it and firstUrl() fills it when the AI
 * leaves it empty. Fix 2026-11-02: the reply also carries why selling, year established, and employees when the text
 * states them, and the pasted text itself is saved on the record (createListing; the Original listing text card).
 */
import { LISTING_SOURCES, mentionsSde, parseMoneyText } from "@/lib/work/buy-box";
import { buildListingName } from "@/lib/work/names";

export type ListingFields = {
  /** The listing name: "00 " plus a plain description until the company is named. */
  name: string;
  /** The company name, when known (empty otherwise). */
  company_name: string;
  source: string;
  what_it_does: string;
  broker_name: string;
  revenue: string;
  earnings: string;
  asking_price: string;
  location: string;
  industry: string;
  listing_url: string;
  /** Fix 2026-11-02: read when the text states them ("" otherwise). */
  why_selling: string;
  /** A four-digit year ("2010"), or "". */
  year_established: string;
  /** As the text states it ("20+ coaches", "14 full-time"), or "". */
  employees: string;
};

export const EMPTY_LISTING_FIELDS: ListingFields = { name: "", company_name: "", source: "Broker newsletter", what_it_does: "", broker_name: "", revenue: "", earnings: "", asking_price: "", location: "", industry: "", listing_url: "", why_selling: "", year_established: "", employees: "" };

export const LISTING_TEXT_MAX = 12_000;

export function listingPrompt(text: string): string {
  return `TASK: listing_fields
Read this business-for-sale listing (a broker email or a web page) and return the fields as JSON. Use only what the text says; leave a field empty ("") when the text does not say. Money fields are short text like "$4.1M" or "$410K". "earnings" is the EBITDA, or the SDE with the word SDE after it ("$1.2M SDE") when only SDE is given; a figure called "Cash Flow", "Seller's Discretionary Earnings", "Owner Benefit", or "Discretionary Cash Flow" is SDE. "listing_name" is a plain description of the business in 2 to 6 words, as a broker would headline it ("Industrial Filtration Distributor", "Commercial HVAC Service Contractor, 11 technicians"); never a made-up company name, never ending in "Co" or "Company". "company_name" is the real company name only when the text names it; otherwise "". "what_it_does" is one line: the product or service and who buys it. "source" is one of: Broker newsletter, Broker outreach, Network, Other. "location" is "City, ST". "industry" is two or three words. "listing_url" is the first web address in the text that starts with http:// or https://, exactly as written; "" when there is none. "why_selling" is the owner's reason for selling in a few words, only when the text states it ("Retiring, no successor"). "year_established" is the four-digit year the business was founded or established, only when stated ("2010"). "employees" is the head count as the text states it, in a few words ("14 full-time", "20+ associate coaches"); "" when not stated.
Return only JSON: {"listing_name": "", "company_name": "", "source": "", "what_it_does": "", "broker_name": "", "revenue": "", "earnings": "", "asking_price": "", "location": "", "industry": "", "listing_url": "", "why_selling": "", "year_established": "", "employees": ""}
Listing text:
"""
${text.slice(0, LISTING_TEXT_MAX)}
"""`;
}

/** Characters that end a web address in running text (a closing bracket, a quote, an angle bracket, a space). */
const URL_PATTERN = /https?:\/\/[^\s<>"'`()[\]{}]+/gi;

/**
 * The first web address (http or https) in a text, without the punctuation that ends the sentence around it
 * ("See https://bizbuysell.com/x." gives "https://bizbuysell.com/x"); null when the text has none.
 */
export function firstUrl(text: string | null | undefined): string | null {
  for (const m of String(text ?? "").matchAll(URL_PATTERN)) {
    const url = m[0].replace(/[.,;:!?*_]+$/, "");
    // A real address has a host with a dot ("bizbuysell.com"); "http://" alone or "https://intranet" is skipped.
    if (/^https?:\/\/[^/\s.]+(\.[^/\s.]+)+/i.test(url)) return url.slice(0, 500);
  }
  return null;
}

/** The fields with the link filled from the text when the AI left it empty (the regular-expression fallback). */
export function withListingUrl(fields: ListingFields, text: string): ListingFields {
  if (fields.listing_url.trim()) return fields;
  const url = firstUrl(text);
  return url ? { ...fields, listing_url: url } : fields;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** A four-digit year from 1700 to 2200 in a reply value ("2010", 2010, "Est. 2010"); "" otherwise. */
export function yearOf(v: unknown): string {
  const m = String(typeof v === "number" || typeof v === "string" ? v : "").match(/\b(1[7-9]\d\d|2[01]\d\d|2200)\b/);
  return m ? m[1] : "";
}

/**
 * The AI reply as listing fields; null when it is not an object with at least a name or a figure. A "listing_name" in
 * the reply becomes "00 <description>"; an older reply with only "name" is kept as the listing name as it is.
 */
function readListingFields(value: unknown): ListingFields | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const source = str(v.source, 40);
  const description = str(v.listing_name, 200);
  const out: ListingFields = {
    name: description ? buildListingName(description) : str(v.name, 200),
    company_name: str(v.company_name, 200),
    source: (LISTING_SOURCES as readonly string[]).includes(source) ? source : "Broker newsletter",
    what_it_does: str(v.what_it_does, 300),
    broker_name: str(v.broker_name ?? v.broker, 200),
    revenue: str(v.revenue, 40),
    earnings: str(v.earnings ?? v.ebitda ?? v.sde, 40),
    asking_price: str(v.asking_price ?? v.asking, 40),
    location: str(v.location, 120),
    industry: str(v.industry, 120),
    listing_url: str(v.listing_url ?? v.link ?? v.url, 500),
    why_selling: str(v.why_selling ?? v.reason_for_selling, 300),
    year_established: yearOf(v.year_established ?? v.established ?? v.founded),
    employees: str(v.employees ?? v.employee_count ?? v.headcount, 120),
  };
  if (!out.name && !out.company_name && !out.revenue && !out.earnings && !out.asking_price) return null;
  return out;
}

/** The strict check for callForJson: says what is wrong so the AI can correct its reply once. */
export function validateListingReply(value: unknown): { ok: true; value: ListingFields } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "the reply is not a JSON object with the listing fields" };
  const v = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of ["listing_name", "what_it_does", "revenue", "earnings", "asking_price", "location", "why_selling", "year_established", "employees"]) {
    if (v[k] !== undefined && typeof v[k] !== "string" && typeof v[k] !== "number") problems.push(`"${k}" is not text`);
  }
  if (!str(v.listing_name, 200) && !str(v.name, 200) && !str(v.company_name, 200)) problems.push('"listing_name" is empty (describe the business in 2 to 6 words)');
  if (problems.length) return { ok: false, error: problems.join(", ") };
  const fields = readListingFields(value);
  if (!fields) return { ok: false, error: "no name and no figure could be read" };
  return { ok: true, value: fields };
}

/** The numbers a typed listing form holds, read from its text fields. */
export function listingNumbers(f: Pick<ListingFields, "revenue" | "earnings" | "asking_price">): { revenue: number | null; ebitda: number | null; sde: number | null; asking_price: number | null } {
  const earnings = parseMoneyText(f.earnings);
  const sde = mentionsSde(f.earnings);
  return {
    revenue: parseMoneyText(f.revenue),
    ebitda: sde ? null : earnings,
    sde: sde ? earnings : null,
    asking_price: parseMoneyText(f.asking_price),
  };
}

/**
 * The listing text as it is kept on the record (Fix 2026-11-02): line ends made plain, the ends trimmed, cut at
 * LISTING_TEXT_MAX characters; paragraphs and wording stay as pasted. Null for an empty text. `min` is the length a
 * text needs before Save on the Original listing text card takes it (20 characters, as Fill from text).
 */
export function listingTextToSave(raw: unknown, min = 0): string | null {
  const t = String(raw ?? "").replace(/\r\n?/g, "\n").trim().slice(0, LISTING_TEXT_MAX);
  return t && t.length >= min ? t : null;
}
