/**
 * "Fill from text" on Add a listing: the pasted broker email or page text goes to the AI, which returns the fields as
 * JSON. This file is the pure part (tested in src/lib/work/listing-text.test.ts): the prompt, the strict check of the
 * reply (used by callForJson, which asks once more with the problems listed), and the clean-up of what comes back.
 * The call itself is in src/app/actions/work.ts (fillListingFromText). Since Edit batch A (2026-10-31) the reply
 * carries a listing name (a plain description, shown as "00 ..." until the company is named) and the company name
 * when the text names it, and "Cash Flow" on a listing is read as SDE.
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
};

export const EMPTY_LISTING_FIELDS: ListingFields = { name: "", company_name: "", source: "Broker newsletter", what_it_does: "", broker_name: "", revenue: "", earnings: "", asking_price: "", location: "", industry: "", listing_url: "" };

export const LISTING_TEXT_MAX = 12_000;

export function listingPrompt(text: string): string {
  return `TASK: listing_fields
Read this business-for-sale listing (a broker email or a web page) and return the fields as JSON. Use only what the text says; leave a field empty ("") when the text does not say. Money fields are short text like "$4.1M" or "$410K". "earnings" is the EBITDA, or the SDE with the word SDE after it ("$1.2M SDE") when only SDE is given; a figure called "Cash Flow", "Seller's Discretionary Earnings", "Owner Benefit", or "Discretionary Cash Flow" is SDE. "listing_name" is a plain description of the business in 2 to 6 words, as a broker would headline it ("Industrial Filtration Distributor", "Commercial HVAC Service Contractor, 11 technicians"); never a made-up company name, never ending in "Co" or "Company". "company_name" is the real company name only when the text names it; otherwise "". "what_it_does" is one line: the product or service and who buys it. "source" is one of: Broker newsletter, Broker outreach, Network, Other. "location" is "City, ST". "industry" is two or three words.
Return only JSON: {"listing_name": "", "company_name": "", "source": "", "what_it_does": "", "broker_name": "", "revenue": "", "earnings": "", "asking_price": "", "location": "", "industry": "", "listing_url": ""}
Listing text:
"""
${text.slice(0, LISTING_TEXT_MAX)}
"""`;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/**
 * The AI reply as listing fields; null when it is not an object with at least a name or a figure. A "listing_name" in
 * the reply becomes "00 <description>"; an older reply with only "name" is kept as the listing name as it is.
 */
export function readListingFields(value: unknown): ListingFields | null {
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
  };
  if (!out.name && !out.company_name && !out.revenue && !out.earnings && !out.asking_price) return null;
  return out;
}

/** The strict check for callForJson: says what is wrong so the AI can correct its reply once. */
export function validateListingReply(value: unknown): { ok: true; value: ListingFields } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "the reply is not a JSON object with the listing fields" };
  const v = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of ["listing_name", "what_it_does", "revenue", "earnings", "asking_price", "location"]) {
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
