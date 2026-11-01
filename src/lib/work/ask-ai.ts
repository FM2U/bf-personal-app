/**
 * The Ask AI panel (batch B2, approved 2026-10-31, decisions on v2 and v3), pure and tested in
 * src/lib/work/ask-ai.test.ts. Three levels: the page pill (the panel with the page as context), the purple star in
 * a card header (that card as context), and the star inside a field (that field; "Use this" fills it). The panel's
 * sections: Suggested next steps on record pages (up to three, one reason each, Set as next action) and Ask about
 * this page (a question box, three suggested questions per page, an answer in short bullets, Make this the next
 * action and Open in email where they apply). The prompts, the strict checks of the replies, the suggested
 * questions, and the cost estimate are here; the calls are in src/app/actions/ask-ai.ts.
 */

/** The pages the panel knows. A record page carries the record's id. */
export type AskPage = "home" | "listings" | "deals" | "deal" | "outreach" | "person" | "rosara" | "project" | "jobs" | "opportunity" | "consulting" | "consulting_item" | "todos";

/** The fields a star can fill. */
export type AskFieldKey = "key_finding" | "next_action" | "email_subject" | "email_body" | "project_note" | "task_text" | "weekly_focus" | "find_out";

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

export const RECORD_PAGES: readonly AskPage[] = ["deal", "person", "project", "opportunity", "consulting_item"];

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
};

/** What the AI reads about a page: a title and plain lines (names, stages, next actions, waits, recent timeline). */
export type PageContext = { title: string; lines: string[] };

export const CONTEXT_MAX_LINES = 80;
export const CONTEXT_MAX_LINE_LENGTH = 240;

/** Keeps the context small: at most CONTEXT_MAX_LINES lines, each cut at CONTEXT_MAX_LINE_LENGTH characters. */
export function trimContext(c: PageContext): PageContext {
  return { title: c.title.slice(0, 160), lines: c.lines.filter((l) => String(l ?? "").trim()).slice(0, CONTEXT_MAX_LINES).map((l) => String(l).replace(/\s+/g, " ").trim().slice(0, CONTEXT_MAX_LINE_LENGTH)) };
}

function contextBlock(c: PageContext): string {
  const t = trimContext(c);
  return [`Page: ${t.title}`, "What is on the page (one record or line each):", ...t.lines.map((l) => `- ${l}`)].join("\n");
}

export const NEXT_STEPS_MAX = 3;
export const STEP_MAX_LENGTH = 160;
export const REASON_MAX_LENGTH = 160;

/** Suggested next steps on a record page: up to three, each with a one-line reason. */
export function nextStepsPrompt(c: PageContext): string {
  return [
    "TASK: next_steps",
    "Suggest the next steps Bram should take on this record: at most 3, the most useful first.",
    "Each step is one concrete action he can do today or this week (call, email, read, write, ask, book). Each reason is one short line that names the fact on the page that makes it matter.",
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

export const ANSWER_MAX_BULLETS = 6;
export const BULLET_MAX_LENGTH = 240;

/** Ask about this page: the question, the page's records, and the strict JSON (bullets, an optional next action, an optional email). */
export function answerPrompt(c: PageContext, question: string, canEmail: boolean): string {
  return [
    "TASK: ask_page",
    `Bram asks about this page: "${question.replace(/"/g, "'").slice(0, 400)}"`,
    "Answer from what is on the page only. Short bullets, the most important first, at most 6, each at most 25 words, plain English, name the record and the number.",
    "When the answer points to one thing Bram should do next, put it in next_action as one line (at most 20 words); otherwise null.",
    canEmail ? "When the answer is a message Bram should send (a follow-up, a thank-you, a check-in), also give email: {subject, body} in his direct, friendly voice (first person, short paragraphs); otherwise null." : "Set email to null.",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"bullets": ["..."], "next_action": "<one line>" | null, "email": {"subject": "...", "body": "..."} | null}',
  ].join("\n");
}

export type Answer = { bullets: string[]; nextAction: string | null; email: { subject: string; body: string } | null };

export function validateAnswerReply(value: unknown): { ok: true; value: Answer } | { ok: false; error: string } {
  const v = value as { bullets?: unknown; items?: unknown; text?: unknown; next_action?: unknown; nextAction?: unknown; email?: unknown } | null;
  if (!v || typeof v !== "object") return { ok: false, error: "the reply is not an object" };
  // A plain-text reply read as {items} (Edit batch B): its lines are the bullets.
  const raw = Array.isArray(v.bullets) ? v.bullets : typeof v.bullets === "string" ? [v.bullets] : Array.isArray(v.items) ? v.items : typeof v.text === "string" ? [v.text] : [];
  // A list mark at the start goes ("- ", "* ", "• "); a bold lead-in ("**First:**") stays for the panel to render in bold.
  const bullets = raw.map((b) => str(b, BULLET_MAX_LENGTH).replace(/^(?:[-•]|\*(?!\*))\s*/, "")).filter(Boolean).slice(0, ANSWER_MAX_BULLETS);
  if (!bullets.length) return { ok: false, error: 'the reply needs a "bullets" array with at least one line' };
  const next = str(v.next_action ?? v.nextAction, STEP_MAX_LENGTH) || null;
  const e = v.email as { subject?: unknown; body?: unknown } | null;
  const subject = e && typeof e === "object" ? str(e.subject, 200) : "";
  const body = e && typeof e === "object" && typeof e.body === "string" ? e.body.replace(/\r\n/g, "\n").trim().slice(0, 4000) : "";
  return { ok: true, value: { bullets, nextAction: next, email: body ? { subject, body } : null } };
}

/** A field star: the AI writes the field's text from the page (improving what is there when the field holds text). */
export function fieldPrompt(c: PageContext, field: AskField): string {
  const what: Record<AskFieldKey, string> = {
    key_finding: "the key finding of this deal: the one line that decides it (at most 30 words)",
    next_action: "the next action on this record: one concrete step Bram can do, starting with a verb (at most 20 words)",
    email_subject: "the subject line of the email (at most 12 words)",
    email_body: "the email message in Bram's direct, friendly voice: first person, short paragraphs, a clear ask, no sign-off beyond 'Thanks,\\nBram'",
    project_note: "a short note for this project's timeline: what was learned or decided, from what is on the page (at most 40 words)",
    task_text: "one task for this record: a concrete thing to do, starting with a verb (at most 15 words)",
    weekly_focus: "the one thing Rosara should get this week, as one sentence starting with 'This week:' (at most 25 words)",
    find_out: "one question to find out before the next conversation about this opportunity (at most 20 words)",
  };
  return [
    "TASK: field_draft",
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

/** About how much a call costs, in cents, from the prompt length and the expected reply length (4 characters per token). */
export function estimateCents(promptChars: number, outputTokens: number, inputPricePerMTok: number, outputPricePerMTok: number): number {
  const inputTokens = Math.ceil(promptChars / 4) + 400;
  return ((inputTokens * inputPricePerMTok + outputTokens * outputPricePerMTok) / 1_000_000) * 100;
}

/** "about 1 cent", "about 3 cents", "under 1 cent"; null when the app has no price figures. */
export function estimateLabel(cents: number | null): string | null {
  if (cents === null || !Number.isFinite(cents) || cents < 0) return null;
  if (cents < 0.5) return "under 1 cent";
  const n = Math.round(cents);
  return `about ${n} ${n === 1 ? "cent" : "cents"}`;
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
export type PanelSuggest = { kind: "next_steps" | "tasks" | "questions"; heading: string; button: string; use: string };

/**
 * What the Ask AI panel shows for a context (Edit batch B, item 3; pure, tested): opened from a card-header star or a
 * field star the whole panel is about that card or field (its title, three questions about it, its own suggestions,
 * the draft for a field); the page-level set shows only from the page pill.
 */
export type PanelSpec = { title: string; sub: string; questions: string[]; suggest: PanelSuggest | null; askHeading: string };

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
      case "What to find out":
        return { ...base, questions: ["What should I find out first?", "What is still unknown about this opportunity?", "Which question matters most before the next call?"], suggest: nextSteps };
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
    `Suggest tasks for this ${noun}: at most 3 small concrete things to do besides its next action (send, ask, read, check, book, compare), the most useful first.`,
    "Each task is one line under 15 words, starting with a verb. Each reason is one short line that names the fact on the page that makes it matter. Do not repeat a task already on the page.",
    "",
    contextBlock(c),
    "",
    'Return only JSON: {"steps": [{"text": "<the task, at most 15 words>", "reason": "<one line, at most 20 words>"}, ...]}',
  ].join("\n");
}
