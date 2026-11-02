/**
 * What every AI action on a deal or a listing reads about it (Fix, approved 2026-11-02), pure and tested in
 * src/lib/work/deal-facts.test.ts. One function gives the fact lines (name, company or listed-as, stage or "listing",
 * what it does, revenue, EBITDA, SDE, asking price with the multiple, location, industry, source, broker, why selling,
 * year established, employees, link, key finding, open questions); the original listing text goes with them, trimmed
 * to LISTING_TEXT_AI_MAX characters with its paragraphs kept. Used by the Ask AI panel (page, card, and field stars,
 * the next action star, suggested tasks; src/lib/work/ask-ai-context.ts) and by Suggest questions, the automatic
 * questions at Interested, and Suggest tasks on the Tasks card (src/lib/work/questions.ts through
 * src/app/actions/work.ts). The rule NO_FALSE_GAPS_RULE goes after the facts and the text in every such prompt.
 */
import { askingMultiple, earningsOf } from "@/lib/work/buy-box";
import { isDealFinancing, type DealFinancing } from "@/lib/ai/instructions";
import type { DealRow } from "@/lib/work/data";
// questions.ts imports this file too; both use the other's exports only inside functions, so the cycle is safe.
import { QUESTION_GROUPS, type QuestionGroups } from "@/lib/work/questions";

/** Every fact of a deal or a listing the AI reads. Money is in dollars (null when not known). */
export type DealFacts = {
  /** The name the screens show (the company name when set, otherwise the listing name). */
  name: string;
  listingName: string | null;
  companyName: string | null;
  /** The stage name; null for a listing still to screen. */
  stage: string | null;
  /** False for a listing still to screen. */
  screened: boolean;
  whatItDoes: string | null;
  revenue: number | null;
  ebitda: number | null;
  sde: number | null;
  askingPrice: number | null;
  location: string | null;
  industry: string | null;
  source: string | null;
  brokerName: string | null;
  whySelling: string | null;
  yearEstablished: number | null;
  employees: string | null;
  listingUrl: string | null;
  keyFinding: string | null;
  /** The Findings card's Strengths and Risks (database update 0028; up to 3 each, empty before it). */
  strengths?: readonly string[];
  risks?: readonly string[];
  /** The Findings card's Growth paths (database update 0029; up to 3, the first is the main one; empty before it). */
  growthPaths?: readonly string[];
  /**
   * How the deal is financed (database update 0029; "equity" before it). Not a fact line: the instructions add the
   * financing line only at Model, IOI or LOI, and Diligence (src/lib/ai/instructions.ts, financingLineFor).
   */
  financing?: DealFinancing | null;
  openQuestions: QuestionGroups | null;
  /** The original listing text as pasted (the full text; trimmed for the AI by listingTextForAi). */
  listingText: string | null;
};

/** The original listing text sent to the AI is cut at about this many characters (at a paragraph or sentence end when one is near). */
export const LISTING_TEXT_AI_MAX = 8_000;

/** The rule every deal or listing prompt carries after the facts and the listing text. */
export const NO_FALSE_GAPS_RULE = "Only say information is missing when it is absent from the facts and the listing text above; name the exact field and who to ask.";

/** "$2,534,975": the exact figure, so the AI never reads a rounded one as a different number. */
export function moneyExact(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  return s || null;
};

/**
 * The listing text for the AI: line ends made plain, runs of blank lines made one, trailing spaces gone, and cut at
 * LISTING_TEXT_AI_MAX characters (at the last paragraph or sentence end in the final 15% when there is one, then
 * "[...]"). Null when there is no text.
 */
export function listingTextForAi(raw: string | null | undefined, max = LISTING_TEXT_AI_MAX): string | null {
  const t = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const floor = Math.floor(max * 0.85);
  const para = cut.lastIndexOf("\n\n");
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  const end = para >= floor ? para : sentence >= floor ? sentence + 1 : max;
  return `${cut.slice(0, end).trimEnd()}\n[...]`;
}

/**
 * The fact lines of a deal or a listing, one fact a line ("revenue: $3,400,000"), the known ones only, plus the stage
 * (or "listing, not screened yet"), the key finding, the strengths and risks ("strength: ...", "risk: ...", AI
 * instructions 2026-11-02), the growth paths ("growth path (main): ...", then "growth path: ...", revision 1), and the
 * open questions ("question (Ask the seller): ...").
 */
export function dealFactLines(f: DealFacts): string[] {
  const lines: string[] = [];
  const add = (label: string, v: unknown) => {
    const s = text(v);
    if (s) lines.push(`${label}: ${s}`);
  };
  add("name", f.name);
  if (f.companyName && f.listingName && f.listingName !== f.companyName) add("listed as", f.listingName);
  else if (!f.companyName) add("company name", "not known yet");
  add("stage", f.screened ? (f.stage ?? "none") : "listing (not screened yet)");
  add("what it does", f.whatItDoes);
  add("revenue", moneyExact(f.revenue));
  add("EBITDA", moneyExact(f.ebitda));
  add("SDE", moneyExact(f.sde));
  const multiple = askingMultiple(f.askingPrice, f.ebitda, f.sde);
  const { label } = earningsOf(f.ebitda, f.sde);
  add("asking price", f.askingPrice === null ? null : `${moneyExact(f.askingPrice)}${multiple ? ` (${multiple} ${label ?? "earnings"})` : ""}`);
  add("location", f.location);
  add("industry", f.industry);
  add("source", f.source);
  add("broker", f.brokerName);
  add("why selling", f.whySelling);
  add("year established", f.yearEstablished);
  add("employees", f.employees);
  add("link", f.listingUrl);
  add("key finding", f.keyFinding);
  for (const x of f.strengths ?? []) add("strength", x);
  for (const x of f.risks ?? []) add("risk", x);
  (f.growthPaths ?? []).forEach((x, n) => add(n === 0 ? "growth path (main)" : "growth path", x));
  if (f.openQuestions) for (const g of QUESTION_GROUPS) for (const q of f.openQuestions[g.key]) add(`question (${g.label})`, q);
  return lines;
}

/** The block that follows the fact lines in a prompt: the original listing text between triple quotes, or a line saying there is none. */
export function listingTextBlock(raw: string | null | undefined): string {
  const t = listingTextForAi(raw);
  return t ? `Original listing text (as pasted):\n"""\n${t}\n"""` : "Original listing text: none saved.";
}

/** Strengths, risks, and growth paths: at most this many each (the Findings card and the Key finding star). */
export const FINDING_LIST_MAX = 3;
export const FINDING_LINE_MAX = 240;

/**
 * A stored strengths, risks, or growth paths value (jsonb array, or a JSON string of one) as clean lines: trimmed, empty and repeated
 * lines dropped, at most FINDING_LIST_MAX, each cut at FINDING_LINE_MAX characters. Anything else reads as none.
 */
export function parseFindingList(v: unknown): string[] {
  let value = v;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of value) {
    const line = typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, FINDING_LINE_MAX) : "";
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
    if (out.length >= FINDING_LIST_MAX) break;
  }
  return out;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

/**
 * The facts from the database rows: a pipeline_items row (select "*", so listing_text, year_established, and employees
 * come with it once database update 0027 has run, and read as unknown before), its deal_financials row, the stage
 * name, and the open questions.
 */
export function dealFactsFromRow(item: Record<string, unknown>, fin: Record<string, unknown> | null | undefined, stageName: string | null, openQuestions: QuestionGroups | null): DealFacts {
  const listingName = strOrNull(item.name);
  const companyName = strOrNull(item.company_name);
  return {
    name: companyName ?? listingName ?? "this deal",
    listingName,
    companyName,
    stage: stageName,
    screened: item.screened !== false,
    whatItDoes: strOrNull(item.what_it_does),
    revenue: numOrNull(fin?.revenue),
    ebitda: numOrNull(fin?.ebitda),
    sde: numOrNull(fin?.sde),
    askingPrice: numOrNull(fin?.asking_price),
    location: strOrNull(item.location),
    industry: strOrNull(item.industry),
    source: strOrNull(item.source),
    brokerName: strOrNull(item.broker_name),
    whySelling: strOrNull(item.why_selling),
    yearEstablished: numOrNull(item.year_established),
    employees: strOrNull(item.employees),
    listingUrl: strOrNull(item.listing_url),
    keyFinding: strOrNull(item.key_finding),
    strengths: parseFindingList(item.strengths),
    risks: parseFindingList(item.risks),
    growthPaths: parseFindingList(item.growth_paths),
    financing: isDealFinancing(item.financing) ? item.financing : "equity",
    openQuestions,
    listingText: typeof item.listing_text === "string" && item.listing_text.trim() ? item.listing_text : null,
  };
}

/** The shared facts of a deal or a listing (src/lib/work/deal-facts.ts) from the deal page's row and its listing text. */
export function dealFactsOf(d: DealRow, listingText: string | null): DealFacts {
  return {
    name: d.name,
    listingName: d.listingName,
    companyName: d.companyName,
    stage: d.stageName,
    screened: d.screened,
    whatItDoes: d.whatItDoes,
    revenue: d.revenue,
    ebitda: d.ebitda,
    sde: d.sde,
    askingPrice: d.askingPrice,
    location: d.location,
    industry: d.industry,
    source: d.source,
    brokerName: d.brokerName ?? d.contactName,
    whySelling: d.whySelling,
    yearEstablished: d.yearEstablished,
    employees: d.employees,
    listingUrl: d.listingUrl,
    keyFinding: d.keyFinding,
    strengths: d.strengths,
    risks: d.risks,
    growthPaths: d.growthPaths,
    financing: d.financing ?? "equity",
    openQuestions: d.openQuestions,
    listingText,
  };
}

