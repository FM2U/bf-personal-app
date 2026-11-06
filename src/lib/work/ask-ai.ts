/**
 * The Ask AI panel (batch B2, approved 2026-10-31, decisions on v2 and v3), pure and tested in
 * src/lib/work/ask-ai.test.ts. Three levels: the page pill (the panel with the page as context), the purple star in
 * a card header (that card as context), and the star inside a field (that field; "Use this" fills it). The panel's
 * sections: Suggested next steps on record pages (up to three, one reason each, Set as next action) and Ask about
 * this page (a question box, three suggested questions per page, an answer in short bullets, Make this the next
 * action and Open in email where they apply). The prompts, the strict checks of the replies, the suggested
 * questions, and the cost estimate are here; the calls are in src/app/actions/ask-ai.ts.
 */

import { buyerInstructions, GENERAL_RULES_LINE, type AiSpot, type BuyerScope } from "@/lib/ai/instructions";
import { FINDING_LINE_MAX, FINDING_LIST_MAX, listingTextBlock, NO_FALSE_GAPS_RULE } from "@/lib/work/deal-facts";

/** The pages the panel knows. A record page carries the record's id. */
type AskPage = "home" | "listings" | "deals" | "deal" | "outreach" | "person" | "rosara" | "project" | "jobs" | "opportunity" | "consulting" | "consulting_item" | "todos" | "targets" | "end_of_day" | "reports";

/** The fields a star can fill. */
type AskFieldKey = "key_finding" | "next_action" | "email_subject" | "email_body" | "project_note" | "task_text" | "weekly_focus" | "find_out" | "tomorrow_line" | "eod_reason" | "weekly_review";

export type AskField = { key: AskFieldKey; label: string; /** What is in the field now (the AI improves it when set). */ current?: string | null; /** Extra lines the field's owner adds (the email's recipient, the record's name). */ extra?: string | null };

/** What a star or pill opens the panel with. Only this page's records go to the AI. */
export type AskContext = {
  page: AskPage;
  recordId?: string | null;
  /** The card the star sits on ("Next actions", "Tasks", "Open questions", "Weekly focus", "What to find out"). */
  card?: string | null;
  field?: AskField | null;
  /** What the panel shows under its title ("Context: Next actions on Home"). */
  label: string;
};

const RECORD_PAGES: readonly AskPage[] = ["deal", "person", "project", "opportunity", "consulting_item"];

/** The context of a deal page (the page pill, the card stars, the field stars). */
export function dealAsk(deal: { id: string; name: string }): AskContext {
  return { page: "deal", recordId: deal.id, label: deal.name };
}

/** The context of a person page. */
export function personAsk(person: { id: string; name: string; organization?: string | null }): AskContext {
  return { page: "person", recordId: person.id, label: `${person.name}${person.organization ? `, ${person.organization}` : ""}` };
}

/** The context of a project page. */
export function projectAsk(project: { id: string; name: string }): AskContext {
  return { page: "project", recordId: project.id, label: project.name };
}

/** The context of an opportunity page (kind job) or a consulting page (kind consulting). */
export function itemAsk(item: { id: string; name: string; kind: "job" | "consulting" }): AskContext {
  return { page: item.kind === "job" ? "opportunity" : "consulting_item", recordId: item.id, label: item.name };
}

export function isRecordPage(page: AskPage): boolean {
  return RECORD_PAGES.includes(page);
}

/** Three suggested questions per page (the pills under the question box). */
export const SUGGESTED_QUESTIONS: Record<AskPage, readonly string[]> = {
  home: ["What should I do first today?", "Which brokers have gone quiet?", "What can wait until tomorrow?"],
  listings: ["Which listing fits the buy box best?", "What should I ask before saying Interested?", "Which listings can I pass on now?"],
  deals: ["Which deal needs attention first?", "Who has been quiet the longest?", "What is the next step on each deal?"],
  deal: ["What should I do next on this deal?", "What is the biggest risk here?", "Draft a follow-up to the broker"],
  outreach: ["Who should I contact first this week?", "Who have I not talked to in a month?", "Draft a check-in to someone due today"],
  person: ["What should I do next with this person?", "Draft a follow-up email", "What did we last talk about?"],
  rosara: ["Which project needs attention first?", "What should the weekly focus be?", "Which projects have no next action?"],
  project: ["What should I do next on this project?", "What is still unknown here?", "Which task should come first?"],
  jobs: ["Which opportunity should I push first?", "Who is waiting on me?", "What should I prepare this week?"],
  opportunity: ["What should I find out before the next call?", "Draft a thank-you note to the contact", "How does this compare with buying a business?"],
  consulting: ["Which lead needs a proposal?", "What is due this week?", "Who should I ask for a referral?"],
  consulting_item: ["What should I do next on this engagement?", "Draft a note to the client", "What is missing before the invoice?"],
  todos: ["What should I do first?", "Which to-dos can wait?", "What can I finish in 15 minutes?"],
  // Batch C (approved 2026-10-31).
  targets: ["Which target am I missing most often?", "Is 5 listings a weekday the right number?", "What would make next week 6 of 6?"],
  end_of_day: ["Draft the reasons for the missed commitments", "Write tomorrow's line", "Make the report shorter"],
  reports: ["What changed versus last week?", "Which broker waits the longest?", "What did my partner ask about?"],
};

/**
 * What the AI reads about a page: a title and plain lines (names, stages, next actions, waits, recent timeline). On a
 * deal or a listing (Fix 2026-11-02) `deal` is true, the lines carry every fact (src/lib/work/deal-facts.ts), and
 * `listingText` is the original listing text (kept with its paragraphs, cut at LISTING_TEXT_AI_MAX characters).
 */
export type PageContext = {
  title: string;
  lines: string[];
  deal?: boolean;
  listingText?: string | null;
  /**
   * AI instructions (2026-11-02): on a deal or a listing (and on the Screen listings and Deals lists) the buy box and the
   * stage line the instructions are built from (src/lib/ai/instructions.ts). Absent on every other page, whose prompts
   * take GENERAL_RULES_LINE.
   */
  buyer?: BuyerScope | null;
};

/**
 * The instructions of one click (AI instructions, 2026-11-02): on a deal or a listing the shared buyer base, the stage
 * line, and the spot part; on every other page the general rules line.
 */
function instructionsFor(c: PageContext, spot: AiSpot, fieldLabel?: string | null): string {
  return c.buyer ? buyerInstructions(c.buyer, spot, fieldLabel) : GENERAL_RULES_LINE;
}

const CONTEXT_MAX_LINES = 80;
const CONTEXT_MAX_LINE_LENGTH = 240;

/** Keeps the context small: at most CONTEXT_MAX_LINES lines, each cut at CONTEXT_MAX_LINE_LENGTH characters. */
export function trimContext(c: PageContext): PageContext {
  const out: PageContext = { title: c.title.slice(0, 160), lines: c.lines.filter((l) => String(l ?? "").trim()).slice(0, CONTEXT_MAX_LINES).map((l) => String(l).replace(/\s+/g, " ").trim().slice(0, CONTEXT_MAX_LINE_LENGTH)) };
  if (c.deal) out.deal = true;
  // The text is cut for the AI where it goes into the prompt (listingTextBlock), at LISTING_TEXT_AI_MAX characters.
  if (c.deal || c.listingText) out.listingText = c.listingText ?? null;
  if (c.buyer) out.buyer = c.buyer;
  return out;
}

/**
 * The page block of every Ask AI prompt. On a deal or a listing the original listing text follows the lines (or a line
 * saying none is saved), then NO_FALSE_GAPS_RULE, so the AI never calls a fact missing that the page or the text holds.
 */
function contextBlock(c: PageContext): string {
  const t = trimContext(c);
  const base = [`Page: ${t.title}`, "What is on the page (one record or line each):", ...t.lines.map((l) => `- ${l}`)];
  if (!t.deal && !t.listingText) return base.join("\n");
  return [...base, listingTextBlock(t.listingText), NO_FALSE_GAPS_RULE].join("\n");
}

const NEXT_STEPS_MAX = 3;
const STEP_MAX_LENGTH = 160;
const REASON_MAX_LENGTH = 160;

/** Suggested next steps on a record page: up to three, each with a one-line reason. */
export function nextStepsPrompt(c: PageContext): string {
  return [
    "TASK: next_steps",
    instructionsFor(c, "next_steps"),
    "",
    "Suggest the next steps the signed-in user should take on this record: at most 3, the most useful first.",
    "Each step is one concrete action the user can do today or this week (call, email, read, write, ask, book). Each reason is one short line that names the fact on the page that makes it matter.",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"steps": [{"text": "<the step, at most 20 words>", "reason": "<one line, at most 20 words>"}, ...]}',
  ].join("\n");
}

export type NextStep = { text: string; reason: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** "Call the broker: he has been quiet 6 days" or "Call the broker (quiet 6 days)" as {text, reason}; anything else as text alone. */
export function splitStepLine(line: unknown): { text: string; reason: string } {
  const s = typeof line === "string" ? line.trim() : "";
  const paren = s.match(/^(.*?)\s*\(([^()]{3,})\)\s*$/);
  if (paren) return { text: paren[1].trim(), reason: paren[2].trim() };
  const colon = s.match(/^([^:]{8,}?):\s+(.{3,})$/);
  if (colon && !/^(https?|mailto)$/i.test(colon[1])) return { text: colon[1].trim(), reason: colon[2].trim() };
  return { text: s, reason: "" };
}

export function validateNextStepsReply(value: unknown): { ok: true; value: NextStep[] } | { ok: false; error: string } {
  const v = value as { steps?: unknown; items?: unknown } | null;
  // A plain-text reply read as {items} (Edit batch B): each line a step; "step: reason" or "step (reason)" splits.
  const raw = Array.isArray(v) ? v : Array.isArray(v?.steps) ? v!.steps : Array.isArray(v?.items) ? v!.items.map(splitStepLine) : null;
  if (!raw) return { ok: false, error: 'the reply needs a "steps" array of {text, reason}' };
  const steps: NextStep[] = [];
  const seen = new Set<string>();
  for (const item of raw as unknown[]) {
    const text = str((item as { text?: unknown })?.text ?? item, STEP_MAX_LENGTH);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    steps.push({ text, reason: str((item as { reason?: unknown })?.reason, REASON_MAX_LENGTH) });
    if (steps.length >= NEXT_STEPS_MAX) break;
  }
  if (!steps.length) return { ok: false, error: "no step with text came back" };
  return { ok: true, value: steps };
}

const ANSWER_MAX_BULLETS = 6;
const BULLET_MAX_LENGTH = 240;

/** Ask about this page: the question, the page's records, and the strict JSON (bullets, an optional next action, an optional email). */
export function answerPrompt(c: PageContext, question: string, canEmail: boolean): string {
  return [
    "TASK: ask_page",
    instructionsFor(c, "ask"),
    "",
    `The signed-in user asks about this page: "${question.replace(/"/g, "'").slice(0, 400)}"`,
    "Answer from what is on the page only. Short bullets, the most important first, at most 6, each at most 25 words, plain English, name the record and the number.",
    "Fill next_action only when the page supports one clear step the user should do next: one line starting with a verb (at most 20 words), and when the answer names a date for it, that date in next_action_due as YYYY-MM-DD. Otherwise set both to null. Never put two actions in next_action.",
    "When next_action is null, end the bullets with 2 or 3 follow-up questions the user could ask next, each starting with **Ask:** and tied to something on the page (at most 6 bullets in total).",
    canEmail ? "When the answer is a message the user should send (a follow-up, a thank-you, a check-in), also give email: {subject, body} in the user's direct, friendly voice (first person, short paragraphs); otherwise null." : "Set email to null.",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"bullets": ["..."], "next_action": "<one line>" | null, "next_action_due": "YYYY-MM-DD" | null, "email": {"subject": "...", "body": "..."} | null}',
  ].join("\n");
}

export type Answer = {
  bullets: string[];
  /** One clear action (Set next action: <action>), or null when the answer points to none. */
  nextAction: string | null;
  /** The date the answer gives for the action (YYYY-MM-DD), or null (the action is then due tomorrow). */
  nextActionDue: string | null;
  email: { subject: string; body: string } | null;
};

/** A next_action value that says there is none ("null", "none", "N/A", "-"). */
const NO_ACTION = /^(?:null|none|n\/?a|nothing|no action|-+)\.?$/i;

/** The answer's next action as one clean line, or null (none given, or a word that means none). */
export function answerNextAction(v: unknown): string | null {
  const line = str(v, STEP_MAX_LENGTH).replace(/^[-•*]\s*/, "").trim();
  return line && !NO_ACTION.test(line) ? line : null;
}

/** The answer's date for the action: a real YYYY-MM-DD date, otherwise null. */
export function answerNextActionDue(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s ? s : null;
}

/** The button under an answer (AI instructions, 2026-11-02): "Set next action: <action>", only when the answer has one. */
export function setNextActionLabel(a: Pick<Answer, "nextAction"> | null | undefined): string | null {
  return a?.nextAction ? `Set next action: ${a.nextAction}` : null;
}

/**
 * The due date of a next action set from an answer: the answer's date when it gives one (today or later; an earlier
 * date becomes today), otherwise tomorrow.
 */
export function answerDueDate(due: string | null | undefined, today: string): string {
  const d = answerNextActionDue(due);
  if (!d) return plusDays(today, 1);
  return d < today ? today : d;
}

/** The line after "Set next action": on a record "Next action set" (a person: "Next follow-up set"); elsewhere "Added to To-dos for today". */
export function setNextActionNote(where: "record" | "person" | "todo"): string {
  return where === "todo" ? "Added to To-dos for today" : where === "person" ? "Next follow-up set" : "Next action set";
}

export function validateAnswerReply(value: unknown): { ok: true; value: Answer } | { ok: false; error: string } {
  const v = value as { bullets?: unknown; items?: unknown; text?: unknown; next_action?: unknown; nextAction?: unknown; next_action_due?: unknown; nextActionDue?: unknown; email?: unknown } | null;
  if (!v || typeof v !== "object") return { ok: false, error: "the reply is not an object" };
  // A plain-text reply read as {items} (Edit batch B): its lines are the bullets.
  const raw = Array.isArray(v.bullets) ? v.bullets : typeof v.bullets === "string" ? [v.bullets] : Array.isArray(v.items) ? v.items : typeof v.text === "string" ? [v.text] : [];
  // A list mark at the start goes ("- ", "* ", "• "); a bold lead-in ("**First:**") stays for the panel to render in bold.
  const bullets = raw.map((b) => str(b, BULLET_MAX_LENGTH).replace(/^(?:[-•]|\*(?!\*))\s*/, "")).filter(Boolean).slice(0, ANSWER_MAX_BULLETS);
  if (!bullets.length) return { ok: false, error: 'the reply needs a "bullets" array with at least one line' };
  const next = answerNextAction(v.next_action ?? v.nextAction);
  const nextDue = next ? answerNextActionDue(v.next_action_due ?? v.nextActionDue) : null;
  const e = v.email as { subject?: unknown; body?: unknown } | null;
  const subject = e && typeof e === "object" ? str(e.subject, 200) : "";
  const body = e && typeof e === "object" && typeof e.body === "string" ? e.body.replace(/\r\n/g, "\n").trim().slice(0, 4000) : "";
  return { ok: true, value: { bullets, nextAction: next, nextActionDue: nextDue, email: body ? { subject, body } : null } };
}

/** A field star: the AI writes the field's text from the page (improving what is there when the field holds text). */
export function fieldPrompt(c: PageContext, field: AskField): string {
  const what: Record<AskFieldKey, string> = {
    key_finding: "the key finding of this deal: the one line that decides it (at most 30 words)",
    next_action: "the next action on this record: one concrete step the signed-in user can do, starting with a verb (at most 20 words)",
    email_subject: "the subject line of the email (at most 12 words)",
    email_body: "the email message in the signed-in user's direct, friendly voice: first person, short paragraphs, a clear ask, no sign-off beyond 'Thanks,\\nBram'",
    project_note: "a short note for this project's timeline: what was learned or decided, from what is on the page (at most 40 words)",
    task_text: "one task for this record: a concrete thing to do, starting with a verb (at most 15 words)",
    weekly_focus: "the one thing Rosara should get this week, as one sentence starting with 'This week:' (at most 25 words)",
    find_out: "one question to find out before the next conversation about this opportunity (at most 20 words)",
    tomorrow_line: "the one line about the next working day for the end-of-day report: what matters most first, from the next actions due and the open waits, in the signed-in user's own voice (at most 30 words, no greeting)",
    eod_reason: "the one-line reason a missed commitment gets in the end-of-day report: what took the time, from what the day shows, and what carries to the next working day (at most 25 words, first person, no apology)",
    weekly_review: "the answer to one question of the Friday weekly review (the field label names the question) for the report to the accountability partners: from the week's figures, targets, and deals on the page, first person, one or two plain sentences (at most 35 words)",
  };
  return [
    "TASK: field_draft",
    instructionsFor(c, "field", field.label),
    `Write ${what[field.key]}.`,
    field.current?.trim() ? `The field holds this now; improve it, keep its meaning: "${field.current.replace(/"/g, "'").slice(0, 600)}"` : "The field is empty.",
    field.extra ? `Also: ${field.extra.slice(0, 400)}` : "",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"text": "<the text for the field>"}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function validateFieldReply(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = value as { text?: unknown } | null;
  const text = typeof v === "string" ? v : typeof v?.text === "string" ? v.text : "";
  const clean = text.replace(/\r\n/g, "\n").trim().slice(0, 4000);
  if (!clean) return { ok: false, error: 'the reply needs a "text" string' };
  return { ok: true, value: clean };
}

/** The panel's one-line context label: "Context: Next actions on Home", "Context: the Weekly focus field". */
export function contextLabel(c: Pick<AskContext, "label" | "card" | "field">): string {
  if (c.field) return `Context: the ${c.field.label} field, ${c.label}`;
  if (c.card) return `Context: ${c.card}, ${c.label}`;
  return `Context: ${c.label}`;
}

/** "deal", "person", "project", "opportunity", "engagement", or "page": the noun the panel uses for the record. */
export function recordNoun(page: AskPage): string {
  return page === "deal" ? "deal" : page === "person" ? "person" : page === "project" ? "project" : page === "opportunity" ? "opportunity" : page === "consulting_item" ? "engagement" : "page";
}

/**
 * What the panel offers besides the question box: Suggested next steps (Set as next action), Suggested tasks (Add as
 * a task), or Suggested questions (added to the deal's open questions).
 */
type PanelSuggest = { kind: "next_steps" | "tasks" | "questions" | "next_action"; heading: string; button: string; use: string };

/**
 * What the Ask AI panel shows for a context (Edit batch B, item 3; pure, tested): opened from a card-header star or a
 * field star the whole panel is about that card or field (its title, three questions about it, its own suggestions,
 * the draft for a field); the page-level set shows only from the page pill.
 */
type PanelSpec = { title: string; sub: string; questions: string[]; suggest: PanelSuggest | null; askHeading: string };

export function panelSpec(c: AskContext): PanelSpec {
  const noun = recordNoun(c.page);
  const record = isRecordPage(c.page) && !!c.recordId;
  const nextSteps: PanelSuggest = { kind: "next_steps", heading: "Suggested next steps", button: "Suggest next steps", use: "Set as next action" };
  if (c.field) {
    const f = c.field.label;
    return {
      title: `Ask AI about the ${f} field`,
      sub: contextLabel(c),
      questions: [`What should the ${f} say?`, `What is missing before the ${f} can be written?`, `Write the ${f} in half the words`],
      suggest: null,
      askHeading: `Ask about the ${f}`,
    };
  }
  if (c.card) {
    const base = { title: `Ask AI about ${c.card}`, sub: contextLabel(c), askHeading: `Ask about ${c.card}` };
    switch (c.card) {
      case "Tasks":
        return { ...base, questions: ["Which task should I do first?", `Which task is missing on this ${noun}?`, "Which tasks can wait?"], suggest: { kind: "tasks", heading: "Suggested tasks", button: `Suggest tasks for this ${noun}`, use: "Add as a task" } };
      case "Open questions":
        return { ...base, questions: ["Which open question matters most?", "What should I ask the broker first?", "Which questions can I answer myself?"], suggest: { kind: "questions", heading: "Suggested questions", button: "Suggest questions", use: "" } };
      case "Next actions":
        return { ...base, questions: ["Which of these should I do first?", "Which can wait until tomorrow?", "Which has been overdue the longest?"], suggest: nextSteps };
      // Edit batch C round 2 (item 3): the star in a Next action card (deal, project, opportunity, consulting) or the
      // person's Next follow-up card suggests one next action and its due date; "Use this" fills the card's fields.
      case "Next action":
        return { ...base, questions: [`What is the best next step on this ${noun}?`, "What is a realistic due date?", "What is blocking progress?"], suggest: { kind: "next_action", heading: "Suggested next action", button: "Suggest again", use: "Use this" } };
      case "Next follow-up":
        return { ...base, questions: ["When should I follow up next?", "What should the follow-up be for?", "What did we last talk about?"], suggest: { kind: "next_action", heading: "Suggested next follow-up", button: "Suggest again", use: "Use this" } };
      case "What to find out":
        return { ...base, questions: ["What should I find out first?", "What is still unknown about this opportunity?", "Which question matters most before the next call?"], suggest: nextSteps };
      // Batch C: the End of day cards. The drafts are the panel's own sections (reasons, the tomorrow line, the short report).
      case "Reasons":
        return { ...base, questions: ["Draft the reasons for the missed commitments", "Which miss matters most?", "What would have met the commitment?"], suggest: null };
      case "What matters tomorrow":
        return { ...base, questions: ["Write tomorrow's line", "What is due first tomorrow?", "Which wait should I chase tomorrow?"], suggest: null };
      case "Report":
        return { ...base, questions: ["Make the report shorter", "What will my partner notice first?", "Is anything missing from the report?"], suggest: null };
      default:
        return { ...base, questions: [`What matters most in ${c.card}?`, `What should I do next about ${c.card}?`, `What is missing from ${c.card}?`], suggest: record ? nextSteps : null };
    }
  }
  return { title: "Ask AI", sub: contextLabel(c), questions: [...(SUGGESTED_QUESTIONS[c.page] ?? SUGGESTED_QUESTIONS.home)], suggest: record ? nextSteps : null, askHeading: "Ask about this page" };
}

/** Suggested tasks for a record (the Tasks card star): up to three short tasks, each with a one-line reason. */
export function tasksPrompt(c: PageContext, noun: string): string {
  return [
    "TASK: next_steps",
    instructionsFor(c, "tasks"),
    "",
    `Suggest tasks for this ${noun}: at most 3 small concrete things to do besides its next action (send, ask, read, check, book, compare), the most useful first.`,
    "Each task is one line under 15 words, starting with a verb. Each reason is one short line that names the fact on the page that makes it matter. Do not repeat a task already on the page.",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"steps": [{"text": "<the task, at most 15 words>", "reason": "<one line, at most 20 words>"}, ...]}',
  ].join("\n");
}

// ---------- The next action star (Edit batch C round 2, item 3) ----------

/** One suggested next action: the action (or, for a person, what the follow-up is for), its due date, minutes, and why. */
export type NextActionSuggestion = { action: string; due: string; minutes: number | null; reason: string };

const NEXT_ACTION_MAX_LENGTH = 160;
/** A due date further out than this is pulled back to it (the suggestion is about the next step, not next quarter). */
export const NEXT_ACTION_MAX_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

/**
 * The next action star: one next action and its due date (and minutes when it is a block of work) from the stage, the
 * stage's default next action, the recent timeline, and the open tasks. For a person: what the next follow-up is for
 * and its date (no minutes).
 */
export function nextActionPrompt(c: PageContext, today: string, kind: "action" | "follow_up", noun: string): string {
  const person = kind === "follow_up";
  return [
    "TASK: next_action",
    instructionsFor(c, "next_action"),
    "",
    person
      ? "Suggest the signed-in user's next follow-up with this person: what it is for (one line, starting with a verb) and the date to do it."
      : `Suggest the one next action the signed-in user should take on this ${noun} and when it is due.`,
    `Today is ${weekdayOf(today)}, ${today}.`,
    "Read the stage, the stage's default next action, the recent timeline (newest first), and the open tasks. Pick the step that moves this forward soonest; do not repeat something the timeline shows as done.",
    `The ${person ? "line" : "action"} is one concrete step, starting with a verb, at most 20 words. The due date is a weekday on or after today, as YYYY-MM-DD.`,
    person ? "Set minutes to null." : "Minutes: about how long the step takes (5 to 240), or null when it is not a block of work (a reply to wait for, a call someone else books).",
    "The reason is one short line that names the fact on the page behind the choice.",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"action": "<the step>", "due": "YYYY-MM-DD", "minutes": <number or null>, "reason": "<one line>"}',
  ].join("\n");
}

/**
 * Checks the AI's reply to the next action star: the action (also read from "what_for", "text", "next_action"), the due
 * date (also "due_date", "date", or "due_in_days"; a date before today becomes today, one more than 60 days out becomes
 * 60 days out, a weekend date moves to the Monday after), the minutes (5 to 480, rounded; otherwise none; never for a
 * person), and the reason. Fails without an action or a readable date.
 */
export function validateNextActionReply(value: unknown, today: string, kind: "action" | "follow_up" = "action"): { ok: true; value: NextActionSuggestion } | { ok: false; error: string } {
  const v = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return { ok: false, error: "the reply is not an object" };
  const rawAction = v.action ?? v.what_for ?? v.whatFor ?? v.next_action ?? v.text;
  const action = str(typeof rawAction === "string" ? rawAction.trim().replace(/^[-•*]\s*/, "") : rawAction, NEXT_ACTION_MAX_LENGTH);
  if (!action) return { ok: false, error: 'the reply needs an "action" line' };
  let due: string | null = null;
  const rawDue = v.due ?? v.due_date ?? v.dueDate ?? v.date;
  if (typeof rawDue === "string" && ISO_DATE.test(rawDue.trim().slice(0, 10)) && !Number.isNaN(Date.parse(`${rawDue.trim().slice(0, 10)}T12:00:00Z`))) due = rawDue.trim().slice(0, 10);
  else {
    const n = Number(v.due_in_days ?? v.dueInDays);
    if (Number.isFinite(n) && n >= 0) due = plusDays(today, Math.round(n));
  }
  if (!due) return { ok: false, error: 'the reply needs a "due" date as YYYY-MM-DD' };
  if (due < today) due = today;
  const latest = plusDays(today, NEXT_ACTION_MAX_DAYS);
  if (due > latest) due = latest;
  const dow = new Date(`${due}T12:00:00Z`).getUTCDay();
  if (dow === 6) due = plusDays(due, 2);
  else if (dow === 0) due = plusDays(due, 1);
  const m = Number(v.minutes ?? v.block_minutes);
  const minutes = kind === "action" && v.minutes !== null && Number.isFinite(m) && m >= 5 && m <= 480 ? Math.round(m) : null;
  return { ok: true, value: { action, due, minutes, reason: str(v.reason ?? v.why, REASON_MAX_LENGTH) } };
}

// ---------- The Key finding star (AI instructions, approved 2026-11-02) ----------

/** What the Key finding star writes: Strengths, Risks, Growth paths (revision 1; the first is the main one), the Key finding, and Check with the broker. */
export type KeyFindingDraft = { strengths: string[]; risks: string[]; growthPaths: string[]; keyFinding: string; brokerQuestions: string[] };

/** The Key finding is one sentence under this many words. */
const KEY_FINDING_MAX_WORDS = 30;

/** The Key finding star: the buyer instructions with the Key finding spot, the facts, and the strict JSON. */
export function keyFindingPrompt(c: PageContext): string {
  return [
    "TASK: key_finding",
    instructionsFor(c, "key_finding"),
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"strengths": ["<the strength, the fact behind it, why it matters>"], "risks": ["<the risk and the fact behind it>"], "growth_paths": ["<a concrete path to growth and the fact behind it; the main one first>"], "key_finding": "<one sentence under 30 words>", "broker_questions": ["<a question for the broker>"]}',
  ].join("\n");
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Revision 2 safety net: an em-dash or en-dash with spaces around it (U+2014, U+2013) becomes ", " in every Key finding line.
 * The reply is already cleaned by cleanDeep (fixDashes); this keeps the Key finding free of dashes even without it.
 */
export function stripDashes(s: string): string {
  return s.replace(/ +[\u2014\u2013] +/g, ", ");
}

/** A list from the reply: strings only, trimmed, list marks gone, repeats dropped, at most FINDING_LIST_MAX. */
function findingLines(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") v = [v];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") return null;
    const line = stripDashes(x.replace(/\s+/g, " ")).replace(/^(?:[-•]|\*(?!\*)|\d+[.)])\s*/, "").trim().slice(0, FINDING_LINE_MAX);
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
    if (out.length >= FINDING_LIST_MAX) break;
  }
  return out;
}

/**
 * The strict check of the Key finding reply: strengths, risks, growth_paths, and broker_questions are lists of text (up
 * to 3 kept each, in the order given, so the main growth path stays first; a missing growth_paths reads as none;
 * "check_with_the_broker" and camelCase keys are read too); key_finding is one sentence under 30 words. A problem goes
 * back to the AI once (callForJson).
 */
export function validateKeyFindingReply(value: unknown): { ok: true; value: KeyFindingDraft } | { ok: false; error: string } {
  const v = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return { ok: false, error: "the reply is not a JSON object with strengths, risks, growth_paths, key_finding, and broker_questions" };
  const problems: string[] = [];
  const strengths = findingLines(v.strengths);
  const risks = findingLines(v.risks);
  const growthPaths = findingLines(v.growth_paths ?? v.growthPaths);
  const brokerQuestions = findingLines(v.broker_questions ?? v.brokerQuestions ?? v.check_with_the_broker ?? v.checkWithTheBroker);
  if (!strengths) problems.push('"strengths" must be a list of text');
  if (!risks) problems.push('"risks" must be a list of text');
  if (!growthPaths) problems.push('"growth_paths" must be a list of text');
  if (!brokerQuestions) problems.push('"broker_questions" must be a list of text');
  const rawKey = v.key_finding ?? v.keyFinding;
  const keyFinding = typeof rawKey === "string" ? stripDashes(rawKey.replace(/\s+/g, " ")).trim() : "";
  if (!keyFinding) problems.push('"key_finding" is missing');
  else if (wordCount(keyFinding) >= KEY_FINDING_MAX_WORDS) problems.push(`"key_finding" has ${wordCount(keyFinding)} words; write one sentence under ${KEY_FINDING_MAX_WORDS} words`);
  if (problems.length) return { ok: false, error: problems.join(", ") };
  return { ok: true, value: { strengths: strengths!, risks: risks!, growthPaths: growthPaths!, keyFinding, brokerQuestions: brokerQuestions! } };
}

/**
 * "Use this" on the Key finding draft: the Key finding and the Strengths, Risks, and Growth paths lists take the draft's
 * lines, and the broker questions are added under Ask the broker after the ones there (a question already there, in any
 * letter case, is skipped; at most QUESTION_MAX_PER_GROUP lines). Revision 1: the Findings card saves the result at once
 * and offers Undo.
 */
export function applyKeyFindingDraft(
  current: { broker: readonly string[] },
  draft: KeyFindingDraft,
  maxPerGroup = 12,
): { keyFinding: string; strengths: string[]; risks: string[]; growthPaths: string[]; broker: string[]; added: number } {
  const broker = current.broker.filter((l) => l.trim()).map((l) => l);
  const seen = new Set(broker.map((l) => l.trim().toLowerCase()));
  let added = 0;
  for (const q of draft.brokerQuestions) {
    const key = q.trim().toLowerCase();
    if (!key || seen.has(key) || broker.length >= maxPerGroup) continue;
    seen.add(key);
    broker.push(q.trim());
    added++;
  }
  return { keyFinding: draft.keyFinding, strengths: [...draft.strengths], risks: [...draft.risks], growthPaths: [...(draft.growthPaths ?? [])], broker, added };
}
