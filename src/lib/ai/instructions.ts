/**
 * The AI instructions for every AI action on a deal or a listing (AI instructions, approved 2026-11-02; spec in
 * docs/2026-11-02-ai-instructions.md), pure and tested in src/lib/ai/instructions.test.ts. They are built fresh on
 * every click from three parts, and the AI sees only what applies to that click:
 *   1. the shared base: who the buyer is, the buy box (filled from Settings, Buy box) and that it is a preference, how
 *      to judge a business and that a clear path to growth is required, and the general rules (the writing rules are
 *      in the system prompt of every call, sent once per click);
 *   2. the stage line, chosen from the deal's state (screening, after the CIM, diligence), and from Model onward the
 *      deal's financing line (AI instructions revision 1; revision 2 added Partner presentation and Closed);
 *   3. the spot part: what this click writes (the Key finding, questions, tasks, the next action, an answer, a field).
 * The facts block (src/lib/work/deal-facts.ts) follows the instructions in every prompt. Records that are not deals
 * (a person, a project, an opportunity, a consulting item) and the other pages keep their own prompts and take
 * GENERAL_RULES_LINE.
 */

import { amountWords, excludedWords, orList, regionWords, type BuyBoxSettings } from "@/lib/work/buy-box";

/** The first paragraph of the shared base (verbatim from the approved spec). */
const BASE_BUYER =
  "The buyer is an independent searcher sourcing, screening and evaluating small business acquisitions. The goal is to buy one good business, own and run it, and grow it. Judge both whether this is a good business and whether it fits the buyer.";

/** How to judge a business, in order of weight (verbatim). */
const BASE_JUDGE =
  "Judge the business on, in this order of weight: how revenue repeats; customer concentration; owner dependence and whether the team runs it; margins and their trend; where growth comes from and whether it lasts; how customers are won and what that costs; competition and switching costs; market tailwinds and headwinds (demand trends, regulation, reimbursement, technology); capital needs; price versus earnings; fit with the buy box and its paths to growth.";

/**
 * Revision 2 (verbatim): the writing rules. They are in the system prompt of every AI call (src/lib/ai/claude.ts), so
 * every AI output follows them. Push D (fix): they are sent once per click, so the shared base and the general rules
 * line no longer repeat them in the prompt itself.
 */
export const WRITING_RULES =
  "Writing rules: No metaphors, no jargon, no colloquialisms. Use literal words that say exactly what is meant. Standard business terms are allowed (moat, runway, tailwind, headwind, churn, recurring revenue, add-backs, working capital, SDE, EBITDA, multiple, customer concentration, owner dependence) only when the specific fact is named next to the term. When judging something, say for whom it is good or bad (buyer or seller) and compared with what. Never call a price strong, cheap, fair or high unless the facts give a basis. No em-dashes.";

/** The general rules of the shared base (verbatim). Revision 2: the writing rules replace "Plain words, no hype." */
const BASE_RULES =
  "Use only the facts and listing text below. Do not count marketing claims as strengths without a figure behind them. Only say information is missing when it is absent from the facts and the listing text; name the field and who to ask.";

/** The rules records which are not deals take (facts only, no false gaps); the writing rules are in the system prompt. */
export const GENERAL_RULES_LINE = "Use only the facts on the page below. Only say information is missing when it is absent from the page; name the field and who to ask.";

/** Revision 1 (verbatim): the buy box is a preference. Follows the buy box line. */
export const BASE_BUY_BOX_PREFERENCE = "The buy box is a preference, not a hard rule; say plainly when a business outside it is still worth pursuing.";

/** Revision 1 (verbatim): a path to growth is required. Follows how to judge a business. */
const BASE_GROWTH = "A clear path to growth is required for a good fit; a deal with no credible path counts as a risk.";

/**
 * "Buy box: $1M to $2.5M EBITDA (or SDE when there is no EBITDA), stretch range $0.75M to $3.5M, B2B services (no
 * retail, direct to consumer, or franchises), Southeast or East Coast, owner-operator." Filled from the settings: the
 * excluded part only when something is excluded; "any industry" and "any US region" when none is set.
 */
export function buyBoxLine(b: BuyBoxSettings): string {
  const excluded = excludedWords(b);
  const regions = regionWords(b);
  const industries = b.industries.trim() || "any industry";
  const parts = [
    `${amountWords(b.coreMin)} to ${amountWords(b.coreMax)} EBITDA (or SDE when there is no EBITDA)`,
    `stretch range ${amountWords(b.stretchMin)} to ${amountWords(b.stretchMax)}`,
    excluded.length ? `${industries} (no ${orList(excluded)})` : industries,
    regions.length ? orList(regions) : "any US region",
    b.ownerOperator ? "owner-operator" : "not owner-operator (a hired manager runs it)",
  ];
  return `Buy box: ${parts.join(", ")}.`.replace(/\.\.$/, ".");
}

/** The shared base: who the buyer is; the buy box and that it is a preference; how to judge and that growth is required; the rules (the writing rules are in the system prompt, push D). */
function baseInstructions(b: BuyBoxSettings): string {
  return [BASE_BUYER, `${buyBoxLine(b)} ${BASE_BUY_BOX_PREFERENCE}`, `${BASE_JUDGE} ${BASE_GROWTH}`, BASE_RULES].join("\n\n");
}

// ---------- The stage line ----------

export type StageLine = "screening" | "after_cim" | "diligence";

const STAGE_LINES: Record<StageLine, string> = {
  screening: "Stage: screening. Give a quick view of business quality and any deal-breakers.",
  after_cim: "Stage: after the CIM. Test the main claims and the growth story.",
  diligence: "Stage: diligence. Focus on what still needs verifying.",
};

const AFTER_CIM = new Set(["CIM review", "Broker call", "Seller call", "Model", "Partner presentation"]);
const DILIGENCE = new Set(["IOI or LOI", "Diligence", "Closed"]);

/**
 * The stage line of a deal: a listing (not screened yet), Interested, and NDA signed get screening; CIM review through
 * Partner presentation get after the CIM; IOI or LOI and Diligence (and Closed) get diligence. A stage the app does not
 * know (Passed, Lost, a renamed stage) gets screening.
 */
export function stageLineFor(stage: string | null | undefined, screened: boolean): StageLine {
  if (!screened) return "screening";
  const s = String(stage ?? "").trim();
  if (AFTER_CIM.has(s)) return "after_cim";
  if (DILIGENCE.has(s)) return "diligence";
  return "screening";
}

// ---------- The financing line (AI instructions revision 1) ----------

/** How a deal is to be paid for (pipeline_items.financing, database update 0029): all equity (the default) or equity plus debt. */
export type DealFinancing = "equity" | "equity_plus_debt";

export const FINANCING_OPTIONS: readonly { value: DealFinancing; label: string }[] = [
  { value: "equity", label: "All equity" },
  { value: "equity_plus_debt", label: "Equity plus debt" },
];

export function isDealFinancing(v: unknown): v is DealFinancing {
  return v === "equity" || v === "equity_plus_debt";
}

export function financingLabel(v: DealFinancing): string {
  return FINANCING_OPTIONS.find((o) => o.value === v)?.label ?? "All equity";
}

const FINANCING_LINES: Record<DealFinancing, string> = {
  equity: "Financing: all equity.",
  equity_plus_debt: "Financing: equity plus debt; check whether earnings can comfortably carry a loan.",
};

/**
 * The stages where the AI is told how the deal is financed (revision 2: from Model onward, so Partner presentation and
 * Closed too). Earlier stages get nothing about financing.
 */
const FINANCING_STAGES: readonly string[] = ["Model", "Partner presentation", "IOI or LOI", "Diligence", "Closed"];

/** The financing line of a deal from Model onward (FINANCING_STAGES); null at every other stage and on a listing. */
export function financingLineFor(stage: string | null | undefined, screened: boolean, financing: DealFinancing | null | undefined): string | null {
  if (!screened || !FINANCING_STAGES.includes(String(stage ?? "").trim())) return null;
  return FINANCING_LINES[financing === "equity_plus_debt" ? "equity_plus_debt" : "equity"];
}

// ---------- The spot part ----------

/** What one AI click writes. */
export type AiSpot = "key_finding" | "questions" | "tasks" | "next_action" | "next_steps" | "ask" | "field";

/** The Key finding spot (verbatim). */
const KEY_FINDING_SPOT = [
  "Write:",
  "Strengths: up to 3, each naming the fact behind it and why it matters to the buyer.",
  "Risks: up to 3, each naming the fact behind it.",
  "Growth paths: up to 3 concrete ways to grow this business, each naming the fact behind it; put the main one first.",
  "Key finding: one sentence under 30 words that weighs the top strength against the top risk and says what decides the deal.",
  "Check with the broker: up to 3 questions for data gaps and mismatches. Never put a gap or mismatch in the Key finding.",
].join("\n");

/** The spot part of a click. A field draft names the field ("the Next action field"). */
export function spotInstructions(spot: AiSpot, fieldLabel?: string | null): string {
  switch (spot) {
    case "key_finding":
      return KEY_FINDING_SPOT;
    case "questions":
      return "Write open questions only: the questions that decide whether to keep going. No strengths, risks, or key finding.";
    case "tasks":
      return "Write tasks only: small concrete things to do on this deal besides its next action.";
    case "next_action":
      return "Write one next action and its due date only.";
    case "next_steps":
      return "Write next steps only: concrete actions that move this deal forward.";
    case "ask":
      return "Answer the question asked, and only that question.";
    case "field":
      return `Write only the text for the ${fieldLabel?.trim() || "field"} field.`;
  }
}

/** Where the instructions are used: one deal or listing (with its stage), or a list of them (Screen listings, Deals). */
export type BuyerScope = {
  buyBox: BuyBoxSettings;
  /** Null on a list of deals in several stages (no stage line). */
  stage: StageLine | null;
  /** The deal's financing line (financingLineFor): only from Model onward; null or absent otherwise. */
  financing?: string | null;
};

/** The instructions of one click: the shared base, the stage line (when one applies), the financing line (when one applies), and the spot part. */
export function buyerInstructions(scope: BuyerScope, spot: AiSpot, fieldLabel?: string | null): string {
  return [baseInstructions(scope.buyBox), scope.stage ? STAGE_LINES[scope.stage] : null, scope.financing || null, spotInstructions(spot, fieldLabel)].filter(Boolean).join("\n\n");
}
