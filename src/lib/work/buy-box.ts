/**
 * The buy box check on Screen listings (pure, tested in src/lib/work/buy-box.test.ts). The thresholds and the
 * state list live here only; edit them here when the buy box changes.
 *
 * A listing "Fits" when its EBITDA (or SDE when there is no EBITDA) is between the two amounts, its industry is not
 * retail or direct to consumer, and its location is in the Southeast or on the East Coast. Otherwise the amber pill
 * names what is off: Too small, Too big, Retail, Location, Franchise (when the name or text says franchise).
 * It is a hint on the numbers, not a decision.
 */

export const BUY_BOX = {
  /** Lowest yearly EBITDA or SDE that fits. */
  minEarnings: 1_000_000,
  /** Highest yearly EBITDA or SDE that fits. */
  maxEarnings: 2_500_000,
  /** Shown as the hint on the To screen card. */
  label: "$1M to $2.5M EBITDA · B2B services · Southeast or East Coast",
};

/** Two-letter codes of the states that fit (the Southeast and the East Coast), with DC. */
export const BUY_BOX_STATES: Record<string, string> = {
  AL: "Alabama", AR: "Arkansas", CT: "Connecticut", DC: "District of Columbia", DE: "Delaware", FL: "Florida", GA: "Georgia",
  KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MS: "Mississippi", NC: "North Carolina",
  NH: "New Hampshire", NJ: "New Jersey", NY: "New York", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  TN: "Tennessee", VA: "Virginia", VT: "Vermont", WV: "West Virginia",
};

/** Every US state and DC, to read a state from "Spokane, WA" or "Washington". */
const ALL_STATES: Record<string, string> = {
  ...BUY_BOX_STATES,
  AK: "Alaska", AZ: "Arizona", CA: "California", CO: "Colorado", HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  KS: "Kansas", MI: "Michigan", MN: "Minnesota", MO: "Missouri", MT: "Montana", ND: "North Dakota", NE: "Nebraska", NM: "New Mexico",
  NV: "Nevada", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", SD: "South Dakota", TX: "Texas", UT: "Utah", WA: "Washington", WI: "Wisconsin", WY: "Wyoming",
};

export type PassReason = "franchise" | "too_small" | "too_big" | "location" | "retail_dtc" | "no_growth_path" | "other";

/** The seven pass reasons, in menu order, with their labels. */
export const PASS_REASONS: { value: PassReason; label: string }[] = [
  { value: "franchise", label: "Franchise" },
  { value: "too_small", label: "Too small" },
  { value: "too_big", label: "Too big" },
  { value: "location", label: "Location" },
  { value: "retail_dtc", label: "Retail or direct to consumer" },
  { value: "no_growth_path", label: "No growth path" },
  { value: "other", label: "Other" },
];

export function passReasonLabel(value: string | null | undefined): string {
  return PASS_REASONS.find((r) => r.value === value)?.label ?? "Passed";
}

export function isPassReason(v: unknown): v is PassReason {
  return PASS_REASONS.some((r) => r.value === v);
}

/** Where a listing came from (stored as text in pipeline_items.source). */
export const LISTING_SOURCES = ["Broker newsletter", "Broker outreach", "Network", "Other"] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

/** The deal source type (proprietary or brokered) that a listing source implies. */
export function dealSourceTypeFor(source: string | null | undefined): "proprietary" | "brokered" {
  return source === "Network" ? "proprietary" : "brokered";
}

/**
 * Reads an amount from typed text: "$1.2M", "1.2m", "$410K", "1,200,000", "2.4 million", "900k". Returns null when
 * there is no number. Only the first number counts ("$1.2M SDE" is 1,200,000).
 */
export function parseMoneyText(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  const m = String(text).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(million|thousand|mm|m|k|b)?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "thousand") return Math.round(n * 1_000);
  if (unit === "m" || unit === "mm" || unit === "million") return Math.round(n * 1_000_000);
  if (unit === "b") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

/** True when the typed earnings figure says SDE ("$1.2M SDE", "SDE 410K"). */
export function mentionsSde(text: string | null | undefined): boolean {
  return /\bsde\b|seller'?s? discretionary/i.test(String(text ?? ""));
}

/** "$1.4M", "$410K", "$22M", "$900K"; "Not stated" for nothing. */
export function moneyShort(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "Not stated";
  const v = Number(n);
  if (!Number.isFinite(v)) return "Not stated";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, ".0")}M`;
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** The two-letter state in a location ("Macon, GA", "Greenville SC", "Spokane, Washington"), or null. */
export function stateOf(location: string | null | undefined): string | null {
  const text = String(location ?? "").trim();
  if (!text) return null;
  const code = text.match(/(?:^|[\s,])([A-Z]{2})(?:\s*,?\s*(?:USA?|United States))?\s*$/);
  if (code && ALL_STATES[code[1]]) return code[1];
  const lower = text.toLowerCase();
  for (const [abbr, name] of Object.entries(ALL_STATES)) {
    if (new RegExp(`(^|[\\s,])${name.toLowerCase()}(\\s*,?\\s*(usa?|united states))?\\s*$`).test(lower)) return abbr;
  }
  return null;
}

export type BuyBoxInput = {
  name?: string | null;
  whatItDoes?: string | null;
  industry?: string | null;
  location?: string | null;
  ebitda?: number | string | null;
  sde?: number | string | null;
};

export type BuyBoxResult = {
  fits: boolean;
  /** What is off, in order: Franchise, Too small or Too big, Retail, Location. Empty when it fits. */
  flags: string[];
  /** The pill text: "Fits", or the flags joined ("Franchise · too small"). */
  label: string;
  /** The amount the size check used (EBITDA first, then SDE), or null when there is none. */
  earnings: number | null;
  earningsLabel: "EBITDA" | "SDE" | null;
};

/** EBITDA first, then SDE. */
export function earningsOf(ebitda: number | string | null | undefined, sde: number | string | null | undefined): { amount: number | null; label: "EBITDA" | "SDE" | null } {
  const e = ebitda === null || ebitda === undefined || ebitda === "" ? null : Number(ebitda);
  if (e !== null && Number.isFinite(e)) return { amount: e, label: "EBITDA" };
  const s = sde === null || sde === undefined || sde === "" ? null : Number(sde);
  if (s !== null && Number.isFinite(s)) return { amount: s, label: "SDE" };
  return { amount: null, label: null };
}

export const RETAIL_PATTERN = /\b(retail|direct[- ]to[- ]consumer|d2c|dtc|e-?commerce)\b/i;
export const FRANCHISE_PATTERN = /\bfranchis(e|es|ee|or|ed|ing)\b/i;

export function checkBuyBox(i: BuyBoxInput): BuyBoxResult {
  const flags: string[] = [];
  const text = `${i.name ?? ""} ${i.whatItDoes ?? ""} ${i.industry ?? ""}`;
  if (FRANCHISE_PATTERN.test(text)) flags.push("Franchise");
  const { amount, label } = earningsOf(i.ebitda, i.sde);
  if (amount === null) flags.push("No earnings figure");
  else if (amount < BUY_BOX.minEarnings) flags.push("Too small");
  else if (amount > BUY_BOX.maxEarnings) flags.push("Too big");
  if (RETAIL_PATTERN.test(`${i.industry ?? ""} ${i.whatItDoes ?? ""}`)) flags.push("Retail");
  const state = stateOf(i.location);
  if (state && !BUY_BOX_STATES[state]) flags.push("Location");
  const fits = flags.length === 0;
  return {
    fits,
    flags,
    label: fits ? "Fits" : flags.map((f, n) => (n === 0 ? f : f.charAt(0).toLowerCase() + f.slice(1))).join(" · "),
    earnings: amount,
    earningsLabel: label,
  };
}

/** "3.5x": the asking price over EBITDA (or SDE); null when either is missing or zero. */
export function askingMultiple(asking: number | string | null | undefined, ebitda: number | string | null | undefined, sde: number | string | null | undefined): string | null {
  const a = asking === null || asking === undefined || asking === "" ? null : Number(asking);
  const { amount } = earningsOf(ebitda, sde);
  if (a === null || !Number.isFinite(a) || amount === null || amount === 0) return null;
  return `${(a / amount).toFixed(1)}x`;
}
