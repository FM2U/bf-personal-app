/**
 * The AI instructions for every AI action on a deal or a listing (AI instructions, approved 2026-11-02; spec in
 * docs/2026-11-02-ai-instructions.md), pure and tested in src/lib/ai/instructions.test.ts. They are built fresh on
 * every click from three parts, and the AI sees only what applies to that click:
 *   1. the shared base: who the buyer is, the buy box (filled from Settings, Buy box), how to judge a business, and
 *      the general rules;
 *   2. the stage line, chosen from the deal's state (screening, after the CIM, diligence);
 *   3. the spot part: what this click writes (the Key finding, questions, tasks, the next action, an answer, a field).
 * The facts block (src/lib/work/deal-facts.ts) follows the instructions in every prompt. Records that are not deals
 * (a person, a project, an opportunity, a consulting item) and the other pages keep their own prompts and take
 * GENERAL_RULES_LINE.
 */

import type { BuyBoxSettings } from "@/lib/work/buy-box";

/** The first paragraph of the shared base (verbatim from the approved spec). */
export const BASE_BUYER =
  "The buyer is an independent searcher sourcing, screening and evaluating small business acquisitions. The goal is to buy one good business, own and run it, and grow it. Judge both whether this is a good business and whether it fits the buyer.";

/** How to judge a business, in order of weight (verbatim). */
export const BASE_JUDGE =
  "Judge the business on, in this order of weight: how revenue repeats; customer concentration; owner dependence and whether the team runs it; margins and their trend; where growth comes from and whether it lasts; how customers are won and what that costs; competition and switching costs; market tailwinds and headwinds (demand trends, regulation, reimbursement, technology); capital needs; price versus earnings; fit with the buy box and growth goals.";

/** The general rules of the shared base (verbatim). */
export const BASE_RULES =
  "Use only the facts and listing text below. Do not count marketing claims as strengths without a figure behind them. Only say information is missing when it is absent from the facts and the listing text; name the field and who to ask. Plain words, no hype.";

/** The one line that records which are not deals take (plain words, facts only, no false gaps). */
export const GENERAL_RULES_LINE = "Plain words, no hype. Use only the facts on the page below. Only say information is missing when it is absent from the page; name the field and who to ask.";

/** "Buy box: <size range>, <industries>, <regions>, owner-operator, financing: <...>, growth goals: <...>." (the last two only when set). */
export function buyBoxLine(b: BuyBoxSettings): string {
  const parts = [b.sizeRange, b.industries, b.regions, b.ownerOperator ? "owner-operator" : "not owner-operator (a hired manager runs it)"];
  if (b.financing?.trim()) parts.push(`financing: ${b.financing.trim()}`);
  if (b.growthGoals?.trim()) parts.push(`growth goals: ${b.growthGoals.trim()}`);
  return `Buy box: ${parts.join(", ")}.`.replace(/\.\.$/, ".");
}

/** The shared base: who the buyer is, the buy box, how to judge, the rules (four paragraphs). */
export function baseInstructions(b: BuyBoxSettings): string {
  return [BASE_BUYER, buyBoxLine(b), BASE_JUDGE, BASE_RULES].join("\n\n");
}

// ---------- The stage line ----------

export type StageLine = "screening" | "after_cim" | "diligence";

export const STAGE_LINES: Record<StageLine, string> = {
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

// ---------- The spot part ----------

/** What one AI click writes. */
export type AiSpot = "key_finding" | "questions" | "tasks" | "next_action" | "next_steps" | "ask" | "field";

/** The Key finding spot (verbatim). */
export const KEY_FINDING_SPOT = [
  "Write:",
  "Strengths: up to 3, each naming the fact behind it and why it matters to the buyer.",
  "Risks: up to 3, each naming the fact behind it.",
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
export type BuyerScope = { buyBox: BuyBoxSettings; /** Null on a list of deals in several stages (no stage line). */ stage: StageLine | null };

/** The instructions of one click: the shared base, the stage line (when one applies), and the spot part. */
export function buyerInstructions(scope: BuyerScope, spot: AiSpot, fieldLabel?: string | null): string {
  return [baseInstructions(scope.buyBox), scope.stage ? STAGE_LINES[scope.stage] : null, spotInstructions(spot, fieldLabel)].filter(Boolean).join("\n\n");
}
