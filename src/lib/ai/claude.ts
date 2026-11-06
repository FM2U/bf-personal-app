import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isAIConfigured } from "@/lib/env";
import { fixDashes } from "@/lib/markdown";
import type { Row } from "@/lib/types";
import { AI_REPLY_CUT_OFF, isCutOff, readAiReply, type ReplyShape } from "@/lib/ai/reply";

export { AI_REPLY_CUT_OFF, isCutOff, parseJsonFromText, readAiReply, replyLines, replySnippet, type ReplyShape } from "@/lib/ai/reply";

export class AIUnavailable extends Error {
  constructor(public reason: "not_configured" | "cap_reached" | "error", message: string) {
    super(message);
  }
}

import { AI_ROLE, AI_SYSTEM_BASE, MESSAGE_FORMAT_RULE } from "@/lib/ai/rules";

export { AI_APP_DESCRIPTION, AI_AUDIENCE_RULE, AI_KNOWLEDGE_RULE, AI_NEXT_ACTION_RULE, AI_ROLE } from "@/lib/ai/rules";


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

function costOf(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
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
  // The stop reason stays on the message (msg.stop_reason) for the caller; a reply cut off by the limit is logged.
  if (msg.stop_reason === "max_tokens") console.warn(`AI reply cut off by max_tokens (${params.purpose}, limit ${params.maxTokens ?? 1500})`);
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

/**
 * The AI replied, but not with JSON that passes the check, even after one retry. `reply` is the text of the last
 * reply. `cutOff`: the reply was cut off by the length limit, even after one retry with double the limit (then the
 * screen shows AI_REPLY_CUT_OFF and not the fragment).
 */
export class AIInvalidReply extends Error {
  constructor(
    message: string,
    public reply = "",
    public cutOff = false,
  ) {
    super(message);
  }
}

/** The message every AI feature shows when the reply could not be used; the reply's first 300 characters follow it with Try again. */
export const AI_REPLY_UNUSABLE = "The AI answered, but not in a form the app can use.";

/**
 * Asks for JSON and checks it (readAiReply: JSON, a bare string, or plain text as the shape asks). When the reply
 * was cut off by the length limit (stop reason max_tokens, or text that starts with { or [ and does not parse),
 * asks once more from the start with double the limit and a note to keep it short; a second cut-off throws
 * AIInvalidReply with cutOff set. When the value fails the check, asks once more with the problems listed and only
 * JSON accepted; a second failure throws AIInvalidReply with the reply text. Respects the monthly cap (callClaude).
 */
export async function callForJson<T>(params: {
  sb: SupabaseClient;
  ownerId: string;
  purpose: string;
  prompt: string;
  maxTokens?: number;
  /** How a plain-text reply is read before the check (default: only JSON). */
  shape?: ReplyShape;
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; error: string };
}): Promise<T> {
  const limit = params.maxTokens ?? 3000;
  let maxTokens = limit;
  let messages: Anthropic.MessageParam[] = [{ role: "user", content: params.prompt }];
  let lastError = "";
  let lastReply = "";
  let cutOffRetried = false;
  let invalidRetried = false;
  for (;;) {
    const msg = await callClaude({ sb: params.sb, ownerId: params.ownerId, purpose: params.purpose, system: AI_SYSTEM_BASE, messages, maxTokens });
    const raw = textOf(msg);
    lastReply = raw;
    if (isCutOff(raw, msg.stop_reason)) {
      if (cutOffRetried) throw new AIInvalidReply(AI_REPLY_CUT_OFF, raw, true);
      cutOffRetried = true;
      maxTokens = limit * 2;
      messages = [{ role: "user", content: `${params.prompt}\n\nKeep it short: the last reply was cut off by the length limit. Return the complete JSON.` }];
      continue;
    }
    const value = readAiReply(raw, params.shape ?? "none");
    const r = value === null ? ({ ok: false, error: "the reply was not valid JSON" } as const) : params.validate(value);
    if (r.ok) return r.value;
    lastError = r.error;
    if (invalidRetried) break;
    invalidRetried = true;
    messages = [...messages, { role: "assistant", content: raw || "(empty reply)" }, { role: "user", content: `Your reply did not match the required JSON: ${r.error}. Return only the corrected JSON object, nothing else.` }];
  }
  throw new AIInvalidReply(`${AI_REPLY_UNUSABLE} (${lastError}). Try again or reword the request.`, lastReply);
}

/** cleanText on every string inside a value (AI JSON replies). */
export function cleanDeep<T>(v: T): T {
  if (typeof v === "string") return cleanText(v) as T;
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)])) as T;
  return v;
}
