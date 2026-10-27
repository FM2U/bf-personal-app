import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isAIConfigured } from "@/lib/env";
import { fixDashes } from "@/lib/markdown";
import type { Row } from "@/lib/types";

export class AIUnavailable extends Error {
  constructor(public reason: "not_configured" | "cap_reached" | "error", message: string) {
    super(message);
  }
}

const AI_ROLE = `You are the AI teammate inside Bram's personal productivity and accountability app.
Roles: assistant (categorize, draft emails, reports, reviews, deal summaries), analyst (run scenarios, explain what changed and why),
advisor (recommendations with tradeoffs), and internal accountability partner (morning plan, evening daily close check, flag missed
commitments, slipping milestones, spending over budget, and daily targets missed).
Writing rules: plain literal English. No metaphors. No hype words. No em dashes or en dashes; use periods, commas, or parentheses.
Never use the words "wedge" or "shape" for a kind of thing. Say "accountability partner", never a person's name, when referring to partners.
Be specific: name the record and the number.`;

/**
 * Output format used by every AI feature that shows text in the app (chat, morning plan, review drafts,
 * reduction suggestions, partner report summaries, category suggestions).
 */
export const OUTPUT_FORMAT_RULE = `Output format (required):
- Answer first. The most important item goes in the first bullet.
- Write a parent-child bulleted outline using "- " markdown bullets. Nest a child bullet with 2 spaces before the "- ".
- Start every bullet with a **bold lead-in** of 1 to 4 words, then the point. Example: "- **Runway:** 7.2 months, under the 12-month target."
- One idea per bullet. Short lines: aim for under 15 words per bullet.
- No headings with "#". For sections, use a short bold label on its own line, for example "**Watch**".
- No em dashes or en dashes. No metaphors. No hype. Plain literal English.
- When the request asks for JSON, return only the JSON. Text values inside the JSON follow the same plain-language rules.`;

/** Format for email and message drafts: conversational, direct, professional, still easy to scan. */
export const MESSAGE_FORMAT_RULE = `Message format (required):
- Write in Bram's normal conversational voice: direct, warm, and professional. First person ("I").
- Short paragraphs. Use "- " bullets and short sections where they make the message easier to read.
- No em dashes or en dashes. No metaphors. No hype. No filler openers.
- Never claim the message was sent. Bram reviews and sends every message himself.`;

/** Short default length for chat replies. */
export const CHAT_LENGTH_RULE = `Chat replies: short by default. At most about 8 top-level bullets unless Bram asks for more.`;

export const AI_SYSTEM_BASE = `${AI_ROLE}\n\n${OUTPUT_FORMAT_RULE}`;
export const AI_SYSTEM_MESSAGE = `${AI_ROLE}\n\n${MESSAGE_FORMAT_RULE}`;

/**
 * LOCAL TESTING ONLY: ANTHROPIC_API_MOCK_URL points every Anthropic call at the stand-in in
 * dev-tools/mock-supabase.mjs. It is honored only for a localhost address, so it can never redirect production traffic.
 */
export function anthropicBaseUrl(): string {
  const raw = process.env.ANTHROPIC_API_MOCK_URL ?? "";
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(raw) ? raw.replace(/\/+$/, "") : "https://api.anthropic.com";
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Spending this calendar month and the effective cap (the lower of the server cap and the Settings cap). */
export async function aiBudget(sb: SupabaseClient, ownerId: string) {
  const [{ data: usage }, { data: capRow }] = await Promise.all([
    sb.from("ai_usage").select("cost_usd").eq("owner_id", ownerId).gte("created_at", monthStartIso()),
    sb.from("inputs").select("value_number").eq("owner_id", ownerId).eq("key", "ai_monthly_cap_usd").maybeSingle(),
  ]);
  const spent = ((usage ?? []) as Row[]).reduce((s, r) => s + Number(r.cost_usd), 0);
  const settingsCap = capRow?.value_number !== null && capRow?.value_number !== undefined ? Number(capRow.value_number) : env.aiMonthlyCapUsd;
  const cap = Math.min(env.aiMonthlyCapUsd, settingsCap);
  return { spent: Math.round(spent * 10000) / 10000, cap, remaining: Math.max(0, cap - spent), blocked: spent >= cap };
}

export function costOf(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return (input * env.aiInputPricePerMTok + usage.output_tokens * env.aiOutputPricePerMTok) / 1_000_000;
}

/**
 * One call to the Anthropic API. Refuses when no API key is set or when the monthly cap is reached.
 * Records tokens and cost for every call.
 */
export async function callClaude(params: {
  sb: SupabaseClient;
  ownerId: string;
  purpose: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}): Promise<Anthropic.Message> {
  if (!isAIConfigured()) throw new AIUnavailable("not_configured", "The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.");
  const budget = await aiBudget(params.sb, params.ownerId);
  if (budget.blocked) {
    throw new AIUnavailable("cap_reached", `The AI monthly cap of $${budget.cap.toFixed(2)} is reached. AI requests resume next month, or raise the cap in Settings.`);
  }
  const client = new Anthropic({ apiKey: env.anthropicKey, baseURL: anthropicBaseUrl() });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: env.anthropicModel,
      max_tokens: params.maxTokens ?? 1500,
      system: params.system,
      messages: params.messages,
      ...(params.tools?.length ? { tools: params.tools } : {}),
    });
  } catch (e) {
    throw new AIUnavailable("error", `The AI request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await params.sb.from("ai_usage").insert({
    owner_id: params.ownerId,
    purpose: params.purpose,
    model: env.anthropicModel,
    input_tokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
    output_tokens: msg.usage.output_tokens,
    cost_usd: costOf(msg.usage),
  });
  return msg;
}

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Replace em dashes and en dashes used as punctuation with a comma or period, per the writing rules. */
export function cleanText(s: string): string {
  return fixDashes(s).trim();
}

/** Ask for a draft; return null (not an error) when the AI is unavailable, so a template can be used instead. */
export async function tryDraft(params: { sb: SupabaseClient; ownerId: string; purpose: string; prompt: string; maxTokens?: number; system?: string }): Promise<string | null> {
  try {
    const msg = await callClaude({
      sb: params.sb,
      ownerId: params.ownerId,
      purpose: params.purpose,
      system: params.system ?? AI_SYSTEM_BASE,
      messages: [{ role: "user", content: params.prompt }],
      maxTokens: params.maxTokens ?? 1200,
    });
    const t = cleanText(textOf(msg));
    return t || null;
  } catch {
    return null;
  }
}

/** Extract the first JSON value from a model reply. */
export function parseJsonFromText<T>(s: string): T | null {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : s;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(body.slice(start)) as T;
  } catch {
    const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
    try {
      return JSON.parse(body.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/** The AI replied, but not with JSON that passes the check, even after one retry. */
export class AIInvalidReply extends Error {}

/**
 * Asks for strict JSON and checks it. When the reply is not valid JSON or fails the check, asks once more with the
 * problems listed; a second failure throws AIInvalidReply. Respects the monthly cap (callClaude).
 */
export async function callForJson<T>(params: {
  sb: SupabaseClient;
  ownerId: string;
  purpose: string;
  prompt: string;
  maxTokens?: number;
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; error: string };
}): Promise<T> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: params.prompt }];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await callClaude({ sb: params.sb, ownerId: params.ownerId, purpose: params.purpose, system: AI_SYSTEM_BASE, messages, maxTokens: params.maxTokens ?? 3000 });
    const raw = textOf(msg);
    const parsed = parseJsonFromText<unknown>(raw);
    const r = parsed === null ? ({ ok: false, error: "the reply was not valid JSON" } as const) : params.validate(parsed);
    if (r.ok) return r.value;
    lastError = r.error;
    messages.push({ role: "assistant", content: raw || "(empty reply)" }, { role: "user", content: `Your reply did not match the required JSON: ${r.error}. Return only the corrected JSON object, nothing else.` });
  }
  throw new AIInvalidReply(`The AI reply could not be used, even after one retry (${lastError}). Try again or reword the request.`);
}

/** cleanText on every string inside a value (AI JSON replies). */
export function cleanDeep<T>(v: T): T {
  if (typeof v === "string") return cleanText(v) as T;
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)])) as T;
  return v;
}
