/**
 * Open questions on a deal (Edit batch A, approved 2026-10-31), pure and tested in src/lib/work/questions.test.ts.
 * Three groups of lines, stored as JSON on pipeline_items.open_questions_json (database update 0021):
 * Ask the seller, Ask the broker, Find out myself. The AI fills them when a listing becomes Interested and on
 * "Suggest questions" (the prompt and the strict check of the reply are here; the call is in src/app/actions/work.ts).
 * "Email these questions" opens the email editor with the seller and broker groups as bullets (the draft is here too).
 */

import { buyerInstructions, financingLineFor, stageLineFor, type AiSpot } from "@/lib/ai/instructions";
import { defaultBuyBoxSettings, type BuyBoxSettings } from "@/lib/work/buy-box";
import { dealFactLines, listingTextBlock, NO_FALSE_GAPS_RULE, type DealFacts } from "@/lib/work/deal-facts";

export type QuestionGroupKey = "seller" | "broker" | "self";

export type QuestionGroups = Record<QuestionGroupKey, string[]>;

export const QUESTION_GROUPS: readonly { key: QuestionGroupKey; label: string }[] = [
  { key: "seller", label: "Ask the seller" },
  { key: "broker", label: "Ask the broker" },
  { key: "self", label: "Find out myself" },
];

export const QUESTION_MAX_PER_GROUP = 12;
const QUESTION_MAX_LENGTH = 240;

export function emptyQuestions(): QuestionGroups {
  return { seller: [], broker: [], self: [] };
}

const lineOf = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX_LENGTH) : "");

/** Trims every line, drops empty ones and repeats, keeps at most QUESTION_MAX_PER_GROUP per group. */
export function cleanQuestions(value: Partial<Record<QuestionGroupKey, unknown>> | null | undefined): QuestionGroups {
  const out = emptyQuestions();
  for (const g of QUESTION_GROUPS) {
    const raw = value?.[g.key];
    const seen = new Set<string>();
    for (const v of Array.isArray(raw) ? raw : []) {
      const line = lineOf(v);
      const key = line.toLowerCase();
      if (!line || seen.has(key)) continue;
      seen.add(key);
      out[g.key].push(line);
      if (out[g.key].length >= QUESTION_MAX_PER_GROUP) break;
    }
  }
  return out;
}

/**
 * The stored value as groups: the JSON column when it holds an object; otherwise the lines of the older plain-text
 * column (one per line) as "Ask the seller"; otherwise empty groups.
 */
export function parseOpenQuestions(json: unknown, legacyText?: string | null): QuestionGroups {
  let value: unknown = json;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return cleanQuestions(value as Record<string, unknown>);
  const lines = String(legacyText ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  return cleanQuestions({ seller: lines });
}

export function countQuestions(q: QuestionGroups): number {
  return q.seller.length + q.broker.length + q.self.length;
}

/** The new lines of `next` that are not in `current` (any letter case), added to the end of each group. */
export function mergeQuestions(current: QuestionGroups, next: QuestionGroups): { merged: QuestionGroups; added: number } {
  const merged = emptyQuestions();
  let added = 0;
  for (const g of QUESTION_GROUPS) {
    const seen = new Set(current[g.key].map((l) => l.toLowerCase()));
    merged[g.key] = [...current[g.key]];
    for (const line of next[g.key]) {
      if (seen.has(line.toLowerCase()) || merged[g.key].length >= QUESTION_MAX_PER_GROUP) continue;
      seen.add(line.toLowerCase());
      merged[g.key].push(line);
      added++;
    }
  }
  return { merged, added };
}

/**
 * What the AI reads about the deal before it suggests questions or to-dos: every fact and the original listing text
 * (the shared DealFacts of src/lib/work/deal-facts.ts, Fix 2026-11-02), the next action, the timeline, the document
 * names, and the questions already on the deal.
 */
export type DealContext = {
  facts: DealFacts;
  nextAction: string | null;
  /** Notes, emails, and calls, newest first: "Oct 27, call: Owner is 58, retiring." */
  timeline: string[];
  documentNames: string[];
  existing: QuestionGroups;
  /** The buy box the instructions name (Settings, Buy box; read on every click). The defaults when not given. */
  buyBox?: BuyBoxSettings | null;
};

/** The AI instructions of a click on this deal (src/lib/ai/instructions.ts): the buyer base, the deal's stage line, the spot part. */
function dealInstructions(c: DealContext, spot: AiSpot): string {
  return buyerInstructions({ buyBox: c.buyBox ?? defaultBuyBoxSettings(), stage: stageLineFor(c.facts.stage, c.facts.screened), financing: financingLineFor(c.facts.stage, c.facts.screened, c.facts.financing) }, spot);
}

const CONTEXT_MAX_LINES = 30;

function contextBlock(c: DealContext): string {
  // The questions are listed apart in each prompt ("Questions already on the deal"), so the facts leave them out.
  const facts = [...dealFactLines({ ...c.facts, openQuestions: null }), ...(c.nextAction ? [`next action: ${c.nextAction.replace(/\s+/g, " ").trim()}`] : [])].join("\n");
  const timeline = c.timeline.slice(0, CONTEXT_MAX_LINES).map((l) => `- ${l.slice(0, 300)}`).join("\n") || "- (nothing yet)";
  const docs = c.documentNames.slice(0, 20).join(", ") || "(none)";
  return `Deal: ${c.facts.name}\nDeal facts:\n${facts}\n${listingTextBlock(c.facts.listingText)}\nNotes, emails, and calls (newest first):\n${timeline}\nDocuments on file: ${docs}\n${NO_FALSE_GAPS_RULE}`;
}

/** The prompt for "Suggest questions" and for the automatic fill when a listing becomes Interested. */
export function questionsPrompt(c: DealContext): string {
  const existing = QUESTION_GROUPS.map((g) => `${g.label}: ${c.existing[g.key].length ? c.existing[g.key].map((l) => `"${l}"`).join("; ") : "(none)"}`).join("\n");
  return `TASK: open_questions
${dealInstructions(c, "questions")}

The signed-in user is buying a small business and this deal is at the stage below. Write the open questions that decide whether to keep going, in three groups:
- "seller": questions to ask the seller (the owner) on a call or by email.
- "broker": questions to ask the broker (documents, process, price, timing, other bidders).
- "self": things the user should find out without the seller or broker (market, competitors, rules, comparable sales).
Rules: 2 to 5 questions per group, each one line under 25 words, specific to this deal (name the number or fact it follows from when there is one), plain English, no question already in the list below, no question the facts or the original listing text already answer, no duplicates. Fewer questions when the facts are thin; an empty list for a group with nothing worth asking.
${contextBlock(c)}
Questions already on the deal (do not repeat):
${existing}
Return only JSON: {"seller": ["..."], "broker": ["..."], "self": ["..."]}`;
}

/**
 * A plain-text reply (the reader's {items}: its lines) as the three groups: a line that names a group ("Ask the
 * seller", "Broker:", "Find out myself") opens that group; the lines after it belong to it; lines before any
 * heading go to Ask the seller.
 */
export function questionsFromLines(lines: readonly string[]): QuestionGroups {
  const out = emptyQuestions();
  let group: QuestionGroupKey = "seller";
  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const head = line.replace(/[:.]+$/, "").toLowerCase();
    if (head.length <= 24 && /seller|owner/.test(head)) {
      group = "seller";
      continue;
    }
    if (head.length <= 24 && /broker/.test(head)) {
      group = "broker";
      continue;
    }
    if (head.length <= 24 && /myself|self|find out/.test(head)) {
      group = "self";
      continue;
    }
    out[group].push(line);
  }
  return cleanQuestions(out);
}

/**
 * The strict check of the AI reply for callForJson: an object with the three lists of short strings, at least one
 * question. A plain-text reply read as {items} (Edit batch B) is grouped by its headings (questionsFromLines).
 */
export function validateQuestionsReply(value: unknown): { ok: true; value: QuestionGroups } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "the reply is not a JSON object with seller, broker, and self lists" };
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.items) && v.seller === undefined && v.broker === undefined && v.self === undefined) {
    const grouped = questionsFromLines((v.items as unknown[]).map((x) => (typeof x === "string" ? x : "")));
    if (!countQuestions(grouped)) return { ok: false, error: "every list is empty; give at least one question" };
    return { ok: true, value: grouped };
  }
  const problems: string[] = [];
  for (const g of QUESTION_GROUPS) {
    const list = v[g.key];
    if (list === undefined) problems.push(`"${g.key}" is missing`);
    else if (!Array.isArray(list)) problems.push(`"${g.key}" is not a list`);
    else if (list.some((x) => typeof x !== "string")) problems.push(`"${g.key}" holds something that is not text`);
    else if (list.length > QUESTION_MAX_PER_GROUP) problems.push(`"${g.key}" has more than ${QUESTION_MAX_PER_GROUP} questions`);
  }
  if (problems.length) return { ok: false, error: problems.join(", ") };
  const cleaned = cleanQuestions(v as Partial<Record<QuestionGroupKey, unknown>>);
  if (!countQuestions(cleaned)) return { ok: false, error: "every list is empty; give at least one question" };
  return { ok: true, value: cleaned };
}

/** The prompt for "Suggest" on the Also to do checklist: up to 5 other things to do on this deal. */
export function todosPrompt(c: DealContext, existingTodos: string[]): string {
  const existing = existingTodos.length ? existingTodos.map((t) => `"${t}"`).join("; ") : "(none)";
  return `TASK: deal_todos
${dealInstructions(c, "tasks")}

The signed-in user is buying a small business. List up to 5 other things to do on this deal besides its next action: small concrete tasks (send, ask, read, check, book, compare), each one line under 15 words, specific to this deal, in the order to do them. Do not repeat the next action or the items already listed, and do not ask for a fact the facts or the original listing text already give. Fewer items when the facts are thin.
${contextBlock(c)}
Open questions on the deal: ${QUESTION_GROUPS.map((g) => c.existing[g.key].join("; ")).filter(Boolean).join(" | ") || "(none)"}
Items already listed (do not repeat): ${existing}
Return only JSON: {"items": ["..."]}`;
}

export const TODO_MAX_LENGTH = 200;

/** The strict check of the task reply: {"items": [up to 5 short lines]} (an older "todos" key or a bare list is read too); an empty list means nothing to add. */
export function validateTodosReply(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? ((value as Record<string, unknown>).items ?? (value as Record<string, unknown>).todos) : undefined;
  if (!Array.isArray(list)) return { ok: false, error: 'the reply needs an "items" list of short lines' };
  if (list.some((x) => typeof x !== "string")) return { ok: false, error: '"items" holds something that is not text' };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list as string[]) {
    const t = x.replace(/\s+/g, " ").trim().slice(0, TODO_MAX_LENGTH);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === 5) break;
  }
  return { ok: true, value: out };
}

/**
 * "Email these questions": subject "<Deal>, questions"; the message greets the person it goes to and lists the
 * Ask the seller and Ask the broker groups as bullets under those two headings (Find out myself stays on the deal).
 * The editor turns "**...**" into bold and "- " lines into a list.
 */
export function questionsEmailDraft(i: { dealName: string; toName: string | null; questions: QuestionGroups }): { subject: string; body: string } {
  const first = String(i.toName ?? "").trim().split(/\s+/)[0] || "there";
  const lines: string[] = [`Hi ${first},`, "", `A few questions on ${i.dealName} as I work through it.`, ""];
  for (const g of QUESTION_GROUPS.filter((x) => x.key !== "self")) {
    const list = i.questions[g.key];
    if (!list.length) continue;
    lines.push(`**${g.label}**`, ...list.map((q) => `- ${q}`), "");
  }
  lines.push("Thanks,", "Bram");
  return { subject: `${i.dealName}, questions`, body: lines.join("\n") };
}
