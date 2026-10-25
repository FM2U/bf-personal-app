import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isAIConfigured } from "@/lib/env";
import type { Row } from "@/lib/types";

export class AIUnavailable extends Error {
  constructor(public reason: "not_configured" | "cap_reached" | "error", message: string) {
    super(message);
  }
}

export const AI_SYSTEM_BASE = `You are the AI teammate inside Bram's personal productivity and accountability app.
Roles: assistant (categorize, draft emails, reports, reviews, deal summaries), analyst (run scenarios, explain what changed and why),
advisor (recommendations with tradeoffs), and internal accountability partner (morning plan, evening daily close check, flag missed
commitments, slipping milestones, and spending over budget).
Writing rules: plain literal English. Short sentences. No metaphors. No hype words. Never use em dashes; use periods, commas, or parentheses.
Never use the words "wedge" or "shape" for a kind of thing. Say "accountability partner", never a person's name, when referring to partners.
Be specific: name the record and the number. Lead with the most important item. Use short bullet lists.`;

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
  const client = new Anthropic({ apiKey: env.anthropicKey });
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

/** Remove em dashes and en dashes from AI text, per the writing rules. */
export function cleanText(s: string): string {
  return s.replace(/\s*—\s*/g, ". ").replace(/–/g, "-");
}

/** Ask for a draft; return null (not an error) when the AI is unavailable, so a template can be used instead. */
export async function tryDraft(params: { sb: SupabaseClient; ownerId: string; purpose: string; prompt: string; maxTokens?: number }): Promise<string | null> {
  try {
    const msg = await callClaude({
      sb: params.sb,
      ownerId: params.ownerId,
      purpose: params.purpose,
      system: AI_SYSTEM_BASE,
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
