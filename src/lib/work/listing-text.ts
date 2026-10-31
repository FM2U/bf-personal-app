/**
 * "Fill from text" on Add a listing: the pasted broker email or page text goes to the AI, which returns the fields as
 * JSON. This file is the pure part (tested in src/lib/work/listing-text.test.ts): the prompt, the JSON check, and the
 * clean-up of what comes back. The call itself is in src/app/actions/work.ts (fillListingFromText).
 */
import { LISTING_SOURCES, mentionsSde, parseMoneyText } from "@/lib/work/buy-box";

export type ListingFields = {
  name: string;
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

export const EMPTY_LISTING_FIELDS: ListingFields = { name: "", source: "Broker newsletter", what_it_does: "", broker_name: "", revenue: "", earnings: "", asking_price: "", location: "", industry: "", listing_url: "" };

export const LISTING_TEXT_MAX = 12_000;

export function listingPrompt(text: string): string {
  return `TASK: listing_fields
Read this business-for-sale listing (a broker email or a web page) and return the fields as JSON. Use only what the text says; leave a field empty ("") when the text does not say. Money fields are short text like "$4.1M" or "$410K". "earnings" is the EBITDA, or the SDE with the word SDE after it ("$1.2M SDE") when only SDE is given. "what_it_does" is one line: the product or service and who buys it. "source" is one of: Broker newsletter, Broker outreach, Network, Other. "location" is "City, ST". "industry" is two or three words.
Return only JSON: {"name": "", "source": "", "what_it_does": "", "broker_name": "", "revenue": "", "earnings": "", "asking_price": "", "location": "", "industry": "", "listing_url": ""}
Listing text:
"""
${text.slice(0, LISTING_TEXT_MAX)}
"""`;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** The AI reply as listing fields; null when it is not an object with at least a name or a figure. */
export function readListingFields(value: unknown): ListingFields | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const source = str(v.source, 40);
  const out: ListingFields = {
    name: str(v.name, 200),
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
  if (!out.name && !out.revenue && !out.earnings && !out.asking_price) return null;
  return out;
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
