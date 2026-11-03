/**
 * The listing popup on Screen listings (Edit batch C round 2, item 2; pure, tested in listing-popup.test.ts): what the
 * centered window shows when a listing's name is pressed. The name (the company name when known) with "Listed as" under
 * it, the buy box pill (Fits, Near fit, Outside; AI instructions revision 1) and the reasons behind it in plain lines, what the business does, the facts grid, and the link
 * to the original listing when there is one. Edit, Pass, and Interested are the window's buttons.
 */
import { BUY_BOX_DEFAULTS, amountWords, checkBuyBox, earningsOf, isFranchiseForBuyBox, isRetailForBuyBox, matchedOtherExcluded, moneyShort, regionCheck, regionWords, sizePlace, type BuyBoxInput, type BuyBoxSettings, type BuyBoxTier } from "@/lib/work/buy-box";
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

type PopupFact = { key: string; label: string; value: string; /** A quiet note after the value ("3.5x"). */ note: string | null };

type ListingPopupData = {
  title: string;
  /** "Listed as 00 Industrial Filtration Distributor" when the company is named; otherwise "Company not named yet". */
  under: string;
  fits: boolean;
  /** Fits, Near fit, or Outside (AI instructions revision 1). */
  tier: BuyBoxTier;
  pill: string;
  /** One plain line per check of the buy box: what fits and what is off. */
  reasons: string[];
  whatItDoes: string | null;
  facts: PopupFact[];
  /** The original listing, as a full address (https:// added when missing), or null. */
  link: string | null;
};

/**
 * The reasons behind the buy box pill, one plain line per check (size against the core and stretch ranges, franchise,
 * retail, a typed excluded type, region), read from the Buy box settings.
 */
export function buyBoxReasons(i: BuyBoxInput, b: BuyBoxSettings = BUY_BOX_DEFAULTS): string[] {
  const out: string[] = [];
  const { amount, label } = earningsOf(i.ebitda, i.sde);
  const core = `${amountWords(b.coreMin)} to ${amountWords(b.coreMax)}`;
  const stretch = `${amountWords(b.stretchMin)} to ${amountWords(b.stretchMax)}`;
  const place = sizePlace(amount, b);
  const figure = `${label} ${moneyShort(amount)}`;
  if (place === "none") out.push("No EBITDA or SDE figure is stated, so the size cannot be checked yet.");
  else if (place === "core") out.push(`Size fits: ${figure} is inside ${core}.`);
  else if (place === "below") out.push(`Near fit on size: ${figure} is under the core ${core} but inside the stretch range ${stretch}.`);
  else if (place === "above") out.push(`Near fit on size: ${figure} is over the core ${core} but inside the stretch range ${stretch}.`);
  else if (place === "too_small") out.push(`Too small: ${figure} is under ${amountWords(b.stretchMin)}, where the stretch range starts.`);
  else out.push(`Too big: ${figure} is over ${amountWords(b.stretchMax)}, where the stretch range ends.`);
  if (isFranchiseForBuyBox(i, b)) out.push("Franchise: the name or the description says franchise.");
  if (isRetailForBuyBox(i, b)) out.push("Retail: the industry or the description reads as retail or direct to consumer.");
  const other = matchedOtherExcluded(i, b);
  if (other) out.push(`${other.charAt(0).toUpperCase() + other.slice(1)}: the name or the description says ${other.toLowerCase()}, which the buy box leaves out.`);
  const r = regionCheck(i.location, b);
  if (r.result === "in") out.push(r.region ? `Location fits: ${r.state ?? i.location?.trim()} is in ${r.region === "Southeast" ? "the Southeast" : r.region === "East Coast" ? "the East Coast" : r.region}.` : "Location fits: the buy box takes any region.");
  else if (r.result === "out") out.push(`Location: ${r.state} is outside the buy box regions (${regionWords(b).join(", ")}).`);
  else out.push(i.location ? `No state found in "${i.location}", so the location is not checked.` : "No location stated, so the location is not checked.");
  return out;
}

export function listingPopup(l: PopupListing, b: BuyBoxSettings = BUY_BOX_DEFAULTS): ListingPopupData {
  const check = checkBuyBox({ name: l.listingName, whatItDoes: l.whatItDoes, industry: l.industry, location: l.location, ebitda: l.ebitda, sde: l.sde }, b);
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
    tier: check.tier,
    pill: check.label,
    reasons: buyBoxReasons({ name: l.listingName, whatItDoes: l.whatItDoes, industry: l.industry, location: l.location, ebitda: l.ebitda, sde: l.sde }, b),
    whatItDoes: l.whatItDoes?.trim() || null,
    facts,
    link: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
  };
}
