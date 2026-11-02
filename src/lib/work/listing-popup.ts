/**
 * The listing popup on Screen listings (Edit batch C round 2, item 2; pure, tested in listing-popup.test.ts): what the
 * centered window shows when a listing's name is pressed. The name (the company name when known) with "Listed as" under
 * it, the buy box pill and the reasons behind it in plain lines, what the business does, the facts grid, and the link
 * to the original listing when there is one. Edit, Pass, and Interested are the window's buttons.
 */
import { BUY_BOX, BUY_BOX_STATES, FRANCHISE_PATTERN, RETAIL_PATTERN, checkBuyBox, earningsOf, moneyShort, stateOf, type BuyBoxInput } from "@/lib/work/buy-box";
import { listedAs } from "@/lib/work/names";

export type PopupListing = {
  name: string;
  listingName: string;
  companyName: string | null;
  whatItDoes: string | null;
  location: string | null;
  industry: string | null;
  source: string | null;
  brokerName: string | null;
  whySelling: string | null;
  listingUrl: string | null;
  revenue: number | null;
  ebitda: number | null;
  sde: number | null;
  askingPrice: number | null;
  askingMultiple: string | null;
};

export type PopupFact = { key: string; label: string; value: string; /** A quiet note after the value ("3.5x"). */ note: string | null };

export type ListingPopupData = {
  title: string;
  /** "Listed as 00 Industrial Filtration Distributor" when the company is named; otherwise "Company not named yet". */
  under: string;
  fits: boolean;
  pill: string;
  /** One plain line per check of the buy box: what fits and what is off. */
  reasons: string[];
  whatItDoes: string | null;
  facts: PopupFact[];
  /** The original listing, as a full address (https:// added when missing), or null. */
  link: string | null;
};

/** "$1M", "$2.5M": the buy box amounts as people say them. */
function amountWords(n: number): string {
  return n % 1_000_000 === 0 ? `$${n / 1_000_000}M` : moneyShort(n);
}

/** The reasons behind the buy box pill, one plain line per check (size, franchise, retail, location). */
export function buyBoxReasons(i: BuyBoxInput): string[] {
  const out: string[] = [];
  const { amount, label } = earningsOf(i.ebitda, i.sde);
  const range = `${amountWords(BUY_BOX.minEarnings)} to ${amountWords(BUY_BOX.maxEarnings)}`;
  if (amount === null) out.push("No EBITDA or SDE figure is stated, so the size cannot be checked yet.");
  else if (amount < BUY_BOX.minEarnings) out.push(`Too small: ${label} ${moneyShort(amount)} is under ${amountWords(BUY_BOX.minEarnings)}.`);
  else if (amount > BUY_BOX.maxEarnings) out.push(`Too big: ${label} ${moneyShort(amount)} is over ${amountWords(BUY_BOX.maxEarnings)}.`);
  else out.push(`Size fits: ${label} ${moneyShort(amount)} is inside ${range}.`);
  if (FRANCHISE_PATTERN.test(`${i.name ?? ""} ${i.whatItDoes ?? ""} ${i.industry ?? ""}`)) out.push("Franchise: the name or the description says franchise.");
  if (RETAIL_PATTERN.test(`${i.industry ?? ""} ${i.whatItDoes ?? ""}`)) out.push("Retail: the industry or the description reads as retail or direct to consumer.");
  const state = stateOf(i.location);
  if (!state) out.push(i.location ? `No state found in "${i.location}", so the location is not checked.` : "No location stated, so the location is not checked.");
  else if (BUY_BOX_STATES[state]) out.push(`Location fits: ${state} is in the Southeast or on the East Coast.`);
  else out.push(`Location: ${state} is outside the Southeast and the East Coast.`);
  return out;
}

export function listingPopup(l: PopupListing): ListingPopupData {
  const check = checkBuyBox({ name: l.listingName, whatItDoes: l.whatItDoes, industry: l.industry, location: l.location, ebitda: l.ebitda, sde: l.sde });
  const listed = listedAs({ name: l.listingName, companyName: l.companyName });
  const earnings = earningsOf(l.ebitda, l.sde);
  const url = String(l.listingUrl ?? "").trim();
  const facts: PopupFact[] = [
    { key: "revenue", label: "Revenue", value: moneyShort(l.revenue), note: null },
    { key: "earnings", label: earnings.label ?? "EBITDA or SDE", value: moneyShort(earnings.amount), note: null },
    { key: "asking", label: "Asking", value: moneyShort(l.askingPrice), note: l.askingPrice !== null && l.askingMultiple ? l.askingMultiple : null },
    { key: "location", label: "Location", value: l.location?.trim() || "Not set", note: null },
    { key: "industry", label: "Industry", value: l.industry?.trim() || "Not set", note: null },
    { key: "source", label: "Source", value: l.source?.trim() || "Not set", note: null },
    { key: "broker", label: "Broker", value: l.brokerName?.trim() || "Not set", note: null },
    { key: "why", label: "Why selling", value: l.whySelling?.trim() || "Not known", note: null },
  ];
  return {
    title: l.name,
    under: listed ? `Listed as ${listed}` : "Company not named yet",
    fits: check.fits,
    pill: check.label,
    reasons: buyBoxReasons({ name: l.listingName, whatItDoes: l.whatItDoes, industry: l.industry, location: l.location, ebitda: l.ebitda, sde: l.sde }),
    whatItDoes: l.whatItDoes?.trim() || null,
    facts,
    link: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
  };
}
