/**
 * The buy box (pure, tested in src/lib/work/buy-box.test.ts). AI instructions revision 1 (approved 2026-11-02): the
 * size range, industries, and regions are settings (Settings, Buy box; inputs rows, category "Buy box"), with a core
 * range and a stretch range. BUY_BOX_DEFAULTS holds the values used before anything is saved (the values that were
 * fixed here before the revision).
 *
 * The check on a listing (checkBuyBox) gives one of three results:
 * - Fits (green): EBITDA (or SDE when there is no EBITDA) inside the core range, no excluded type, and the region in the
 *   buy box or not known.
 * - Near fit (amber): exactly one soft miss: the earnings inside the stretch range but outside the core, or the region
 *   outside the buy box with everything else fitting.
 * - Outside: anything else (an excluded type, earnings outside the stretch range or not stated, or two soft misses).
 * The pill names what is off with the reason words: Franchise, Too small or Too big, Retail, Location (an Other excluded
 * type by its own word). It is a hint on the numbers, not a decision.
 */

/** The US regions offered on the Buy box page, with their states (two-letter codes, DC included). Every state is in at least one. */
export const US_REGIONS = [
  { key: "southeast", label: "Southeast", states: ["AL", "AR", "FL", "GA", "KY", "LA", "MS", "NC", "SC", "TN", "VA", "WV"] },
  { key: "east_coast", label: "East Coast", states: ["CT", "DC", "DE", "FL", "GA", "MA", "MD", "ME", "NC", "NH", "NJ", "NY", "PA", "RI", "SC", "VA", "VT"] },
  { key: "midwest", label: "Midwest", states: ["IA", "IL", "IN", "KS", "MI", "MN", "MO", "ND", "NE", "OH", "SD", "WI"] },
  { key: "southwest", label: "Southwest", states: ["AZ", "NM", "OK", "TX"] },
  { key: "west", label: "West", states: ["AK", "CA", "CO", "HI", "ID", "MT", "NV", "OR", "UT", "WA", "WY"] },
] as const;
export type RegionKey = (typeof US_REGIONS)[number]["key"];

/** The excluded types offered as checkboxes (an Other text box takes more). */
export const EXCLUDED_TYPES = [
  { key: "retail", label: "Retail", word: "retail" },
  { key: "direct_to_consumer", label: "Direct to consumer", word: "direct to consumer" },
  { key: "franchises", label: "Franchises", word: "franchises" },
] as const;
export type ExcludedKey = (typeof EXCLUDED_TYPES)[number]["key"];

/** The buy box as the Fits check and the AI instructions read it (Settings, Buy box). Money in dollars. */
export type BuyBoxSettings = {
  /** The core range of yearly EBITDA (or SDE when there is no EBITDA). */
  coreMin: number;
  coreMax: number;
  /** The stretch range around it (a listing inside it but outside the core is a near fit). */
  stretchMin: number;
  stretchMax: number;
  /** The industries included, as typed ("B2B services"); empty means any industry. */
  industries: string;
  excluded: ExcludedKey[];
  /** More excluded types, typed and separated by commas ("restaurants, trucking"); null when none. */
  excludedOther: string | null;
  regions: RegionKey[];
  /** More regions or places, typed and separated by commas ("Ohio, Ontario"); null when none. */
  regionsOther: string | null;
  ownerOperator: boolean;
};

/** The values used before anything is saved: the buy box that was fixed in the app before revision 1. */
export const BUY_BOX_DEFAULTS: Readonly<BuyBoxSettings> = {
  coreMin: 1_000_000,
  coreMax: 2_500_000,
  stretchMin: 750_000,
  stretchMax: 3_500_000,
  industries: "B2B services",
  excluded: ["retail", "direct_to_consumer", "franchises"],
  excludedOther: null,
  regions: ["southeast", "east_coast"],
  regionsOther: null,
  ownerOperator: true,
};

/** The inputs keys of the Buy box settings (database update 0029 adds the size, industry, and region rows; a save adds any that is missing). */
export const BUY_BOX_INPUT_KEYS = {
  ownerOperator: "buy_box_owner_operator",
  coreMin: "buy_box_core_min",
  coreMax: "buy_box_core_max",
  stretchMin: "buy_box_stretch_min",
  stretchMax: "buy_box_stretch_max",
  industries: "buy_box_industries",
  excluded: "buy_box_excluded",
  excludedOther: "buy_box_excluded_other",
  regions: "buy_box_regions",
  regionsOther: "buy_box_regions_other",
} as const;
export const BUY_BOX_TEXT_MAX = 200;

/** One line of plain text: spaces made single, cut at `max`; null when empty. */
export function oneLine(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
}

/** The terms of a typed list ("restaurants, trucking; car washes"): trimmed, empty ones dropped. */
function typedTerms(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/[,;\n]/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** "southeast,east_coast" as region keys (unknown words dropped, in the page's order). */
export function parseRegionKeys(v: unknown): RegionKey[] {
  const have = new Set(String(v ?? "").split(",").map((x) => x.trim()));
  return US_REGIONS.filter((r) => have.has(r.key)).map((r) => r.key);
}

/** "retail,franchises" as excluded keys (unknown words dropped, in the page's order). */
export function parseExcludedKeys(v: unknown): ExcludedKey[] {
  const have = new Set(String(v ?? "").split(",").map((x) => x.trim()));
  return EXCLUDED_TYPES.filter((e) => have.has(e.key)).map((e) => e.key);
}

type InputRow = { key: string; value_number?: unknown; value_text?: unknown };

/**
 * The buy box from the inputs rows (key, value_number, value_text). A missing row reads as its default; a text row that
 * is there but empty reads as empty (no industries typed means any industry; no region ticked and none typed means any
 * region; no type ticked means none excluded). An amount that is not a positive number reads as its default.
 */
export function buyBoxSettingsFromRows(rows: readonly InputRow[]): BuyBoxSettings {
  const by = new Map(rows.map((r) => [r.key, r]));
  const num = (key: string, fallback: number) => {
    const r = by.get(key);
    const n = r?.value_number === null || r?.value_number === undefined || r?.value_number === "" ? NaN : Number(r.value_number);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  /** Undefined when the row is missing; null when it is there and empty. */
  const text = (key: string): string | null | undefined => (by.has(key) ? oneLine(by.get(key)?.value_text, BUY_BOX_TEXT_MAX) : undefined);
  const owner = by.get(BUY_BOX_INPUT_KEYS.ownerOperator);
  const ownerNum = owner?.value_number === null || owner?.value_number === undefined || owner?.value_number === "" ? null : Number(owner.value_number);
  const d = BUY_BOX_DEFAULTS;
  const industries = text(BUY_BOX_INPUT_KEYS.industries);
  const excluded = text(BUY_BOX_INPUT_KEYS.excluded);
  const regions = text(BUY_BOX_INPUT_KEYS.regions);
  return {
    coreMin: num(BUY_BOX_INPUT_KEYS.coreMin, d.coreMin),
    coreMax: num(BUY_BOX_INPUT_KEYS.coreMax, d.coreMax),
    stretchMin: num(BUY_BOX_INPUT_KEYS.stretchMin, d.stretchMin),
    stretchMax: num(BUY_BOX_INPUT_KEYS.stretchMax, d.stretchMax),
    industries: industries === undefined ? d.industries : (industries ?? ""),
    excluded: excluded === undefined ? [...d.excluded] : parseExcludedKeys(excluded),
    excludedOther: text(BUY_BOX_INPUT_KEYS.excludedOther) ?? null,
    regions: regions === undefined ? [...d.regions] : parseRegionKeys(regions),
    regionsOther: text(BUY_BOX_INPUT_KEYS.regionsOther) ?? null,
    ownerOperator: ownerNum === null || !Number.isFinite(ownerNum) ? true : ownerNum !== 0,
  };
}

/** The buy box with every setting at its default. */
export function defaultBuyBoxSettings(): BuyBoxSettings {
  return { ...BUY_BOX_DEFAULTS, excluded: [...BUY_BOX_DEFAULTS.excluded], regions: [...BUY_BOX_DEFAULTS.regions] };
}

/**
 * The problem with the four amounts, or null when they make sense: each a positive number, the start not above the end,
 * and the stretch range around the core range (it starts at or below the core and ends at or above it).
 */
export function buyBoxRangeProblem(b: Pick<BuyBoxSettings, "coreMin" | "coreMax" | "stretchMin" | "stretchMax">): string | null {
  for (const [label, v] of [["Core range from", b.coreMin], ["Core range to", b.coreMax], ["Stretch range from", b.stretchMin], ["Stretch range to", b.stretchMax]] as const) {
    if (!Number.isFinite(v) || v <= 0) return `${label} needs an amount, for example $1M or $750K.`;
  }
  if (b.coreMin > b.coreMax) return "The core range starts above where it ends.";
  if (b.stretchMin > b.coreMin) return "The stretch range should start at or below the core range.";
  if (b.stretchMax < b.coreMax) return "The stretch range should end at or above the core range.";
  return null;
}

/** "$1M", "$2.5M", "$0.75M", "$50K": the buy box amounts as people say them (millions from $100K up). */
export function amountWords(n: number): string {
  if (!Number.isFinite(n)) return "Not stated";
  if (Math.abs(n) >= 100_000) return `$${String(Number((n / 1_000_000).toFixed(2)))}M`;
  return `$${Math.round(n / 1_000)}K`;
}

/** "a, b, or c"; "a or b"; "a". */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

/** The excluded words, in order: the ticked types, then the typed ones ("retail", "direct to consumer", "franchises"). */
export function excludedWords(b: Pick<BuyBoxSettings, "excluded" | "excludedOther">): string[] {
  return [...EXCLUDED_TYPES.filter((e) => b.excluded.includes(e.key)).map((e) => e.word), ...typedTerms(b.excludedOther)];
}

/** The region names, in order: the ticked regions, then the typed places ("Southeast", "East Coast"). */
export function regionWords(b: Pick<BuyBoxSettings, "regions" | "regionsOther">): string[] {
  return [...US_REGIONS.filter((r) => b.regions.includes(r.key)).map((r) => r.label), ...typedTerms(b.regionsOther)];
}

/** The hint on the To screen card: "$1M to $2.5M EBITDA · B2B services · Southeast or East Coast". */
export function buyBoxHint(b: BuyBoxSettings): string {
  const regions = regionWords(b);
  return [`${amountWords(b.coreMin)} to ${amountWords(b.coreMax)} EBITDA`, b.industries.trim() || "Any industry", regions.length ? orList(regions) : "Any region"].join(" · ");
}

/** Every US state and DC, to read a state from "Spokane, WA" or "Washington". */
export const ALL_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DC: "District of Columbia",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri",
  MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington",
  WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
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
  return /\bsde\b|seller'?s? discretionary|cash ?flow|owner'?s? benefit|discretionary earnings/i.test(String(text ?? ""));
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

/** Fits (green), Near fit (amber), or Outside (gray). */
export type BuyBoxTier = "fits" | "near" | "outside";

type BuyBoxResult = {
  tier: BuyBoxTier;
  /** True only for Fits. */
  fits: boolean;
  /** What is off, in order: Franchise, Too small or Too big, Retail, an Other excluded type, Location. Empty when it fits. */
  flags: string[];
  /** The pill text: "Fits", "Near fit · too small", "Outside · franchise · too small". */
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

const RETAIL_PATTERN = /\b(retail|e-?commerce)\b/i;
const DTC_PATTERN = /\b(direct[- ]to[- ]consumer|d2c|dtc)\b/i;
const FRANCHISE_PATTERN = /\bfranchis(e|es|ee|or|ed|ing)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The typed excluded term found in the name, what it does, or the industry (whole words, any letter case), or null. */
export function matchedOtherExcluded(i: BuyBoxInput, b: Pick<BuyBoxSettings, "excludedOther">): string | null {
  const text = `${i.name ?? ""} ${i.whatItDoes ?? ""} ${i.industry ?? ""}`;
  return typedTerms(b.excludedOther).find((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}([^a-z0-9]|$)`, "i").test(text)) ?? null;
}

/** True when the listing reads as retail or direct to consumer, for the types the buy box excludes. */
export function isRetailForBuyBox(i: BuyBoxInput, b: Pick<BuyBoxSettings, "excluded">): boolean {
  const text = `${i.industry ?? ""} ${i.whatItDoes ?? ""}`;
  return (b.excluded.includes("retail") && RETAIL_PATTERN.test(text)) || (b.excluded.includes("direct_to_consumer") && DTC_PATTERN.test(text));
}

/** True when the listing says franchise and the buy box excludes franchises. */
export function isFranchiseForBuyBox(i: BuyBoxInput, b: Pick<BuyBoxSettings, "excluded">): boolean {
  return b.excluded.includes("franchises") && FRANCHISE_PATTERN.test(`${i.name ?? ""} ${i.whatItDoes ?? ""} ${i.industry ?? ""}`);
}

/** Where the earnings sit: "core", "below" or "above" the core inside the stretch range, "too_small" or "too_big" outside it, or "none". */
export function sizePlace(amount: number | null, b: Pick<BuyBoxSettings, "coreMin" | "coreMax" | "stretchMin" | "stretchMax">): "core" | "below" | "above" | "too_small" | "too_big" | "none" {
  if (amount === null) return "none";
  if (amount < b.stretchMin) return "too_small";
  if (amount > b.stretchMax) return "too_big";
  if (amount < b.coreMin) return "below";
  if (amount > b.coreMax) return "above";
  return "core";
}

/**
 * The region check: "in" (the state is in a ticked region, or the location names a typed place), "out" (a state is
 * found and it is in none of them), or "unknown" (no state found and no typed place named). With no region ticked and
 * none typed, every location is "in".
 */
export function regionCheck(location: string | null | undefined, b: Pick<BuyBoxSettings, "regions" | "regionsOther">): { result: "in" | "out" | "unknown"; state: string | null; region: string | null } {
  const state = stateOf(location);
  const others = typedTerms(b.regionsOther);
  if (!b.regions.length && !others.length) return { result: "in", state, region: null };
  if (state) {
    const r = US_REGIONS.find((x) => b.regions.includes(x.key) && (x.states as readonly string[]).includes(state));
    if (r) return { result: "in", state, region: r.label };
  }
  const text = String(location ?? "").toLowerCase();
  const place = others.find((t) => {
    const lower = t.toLowerCase();
    if (text && new RegExp(`(^|[^a-z0-9])${escapeRe(lower)}([^a-z0-9]|$)`).test(text)) return true;
    // A typed state ("Ohio" or "OH") matches a location in that state.
    return !!state && (lower === state.toLowerCase() || lower === ALL_STATES[state]?.toLowerCase());
  });
  if (place) return { result: "in", state, region: place };
  return { result: state ? "out" : "unknown", state, region: null };
}

export function checkBuyBox(i: BuyBoxInput, b: BuyBoxSettings = BUY_BOX_DEFAULTS): BuyBoxResult {
  const flags: string[] = [];
  let hard = 0;
  let soft = 0;
  if (isFranchiseForBuyBox(i, b)) {
    flags.push("Franchise");
    hard++;
  }
  const { amount, label } = earningsOf(i.ebitda, i.sde);
  const size = sizePlace(amount, b);
  if (size === "none") {
    flags.push("No earnings figure");
    hard++;
  } else if (size !== "core") {
    flags.push(size === "too_small" || size === "below" ? "Too small" : "Too big");
    if (size === "too_small" || size === "too_big") hard++;
    else soft++;
  }
  if (isRetailForBuyBox(i, b)) {
    flags.push("Retail");
    hard++;
  }
  const other = matchedOtherExcluded(i, b);
  if (other) {
    flags.push(other.charAt(0).toUpperCase() + other.slice(1));
    hard++;
  }
  if (regionCheck(i.location, b).result === "out") {
    flags.push("Location");
    soft++;
  }
  const tier: BuyBoxTier = hard > 0 || soft > 1 ? "outside" : soft === 1 ? "near" : "fits";
  const words = flags.map((f) => f.charAt(0).toLowerCase() + f.slice(1)).join(" · ");
  return {
    tier,
    fits: tier === "fits",
    flags,
    label: tier === "fits" ? "Fits" : `${tier === "near" ? "Near fit" : "Outside"} · ${words}`,
    earnings: amount,
    earningsLabel: label,
  };
}

/** The pill color of a result: Fits green, Near fit amber, Outside gray. */
export function buyBoxTone(tier: BuyBoxTier): "green" | "amber" | "gray" {
  return tier === "fits" ? "green" : tier === "near" ? "amber" : "gray";
}

/** "3.5x": the asking price over EBITDA (or SDE); null when either is missing or zero. */
export function askingMultiple(asking: number | string | null | undefined, ebitda: number | string | null | undefined, sde: number | string | null | undefined): string | null {
  const a = asking === null || asking === undefined || asking === "" ? null : Number(asking);
  const { amount } = earningsOf(ebitda, sde);
  if (a === null || !Number.isFinite(a) || amount === null || amount === 0) return null;
  return `${(a / amount).toFixed(1)}x`;
}
