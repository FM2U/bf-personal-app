"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { AI_SYSTEM_BASE, AIUnavailable, callClaude, parseJsonFromText, textOf } from "@/lib/ai/claude";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { money } from "@/lib/format";
import type { Row } from "@/lib/types";

function back(fd: FormData, notice: string): never {
  const path = String(fd.get("back") ?? "/proposals");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}notice=${encodeURIComponent(notice)}`);
}

/** Asks the AI for 3 ways to reduce an expense or recurring charge. Each becomes a proposal; approving one creates the reduction action. */
export async function requestReductionSuggestions(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const table = String(fd.get("table"));
  const id = String(fd.get("id"));
  if (!["transactions", "recurring_series"].includes(table)) return;
  const { data: rec } = await supabase.from(table).select("*").eq("id", id).single();
  if (!rec) return;
  const ctx = await loadCtx(supabase, ownerId);
  let category: string | null = null;
  if (rec.category_id) category = (await supabase.from("categories").select("name").eq("id", rec.category_id).maybeSingle()).data?.name ?? null;
  const subject =
    table === "recurring_series"
      ? `Recurring charge: ${rec.merchant_name}, ${rec.frequency}, typical amount ${money(rec.average_amount, true)}, monthly cost ${money(rec.monthly_cost, true)}, category ${category ?? "none"}.`
      : `Expense: ${rec.description} (${rec.merchant_name ?? ""}), ${money(Math.abs(Number(rec.amount)), true)} on ${rec.date}, category ${category ?? "none"}.`;
  let suggestions: { title: string; description: string; estimated_monthly_savings: number }[] | null = null;
  try {
    const msg = await callClaude({
      sb: supabase,
      ownerId,
      purpose: "reduction_suggestions",
      system: AI_SYSTEM_BASE,
      messages: [
        {
          role: "user",
          content: `${subject}\nGive exactly 3 specific, practical ways to reduce or remove this cost. Return only JSON: [{"title": "...", "description": "one or two sentences", "estimated_monthly_savings": number}]`,
        },
      ],
      maxTokens: 700,
    });
    suggestions = parseJsonFromText(textOf(msg));
  } catch (e) {
    back(fd, e instanceof AIUnavailable ? e.message : "The AI request failed.");
  }
  if (!Array.isArray(suggestions) || !suggestions.length) back(fd, "The AI reply could not be read. Try again.");
  const three = suggestions.slice(0, 3).map((s) => ({ title: String(s.title), description: String(s.description ?? ""), estimated_monthly_savings: Number(s.estimated_monthly_savings) || 0 }));
  const group = randomUUID();
  await supabase.from("ai_proposals").insert(
    three.map((s) => ({
      owner_id: ownerId,
      table_name: "reduction_actions",
      action: "create",
      payload: {
        title: s.title,
        chosen_suggestion: s.description,
        suggestions: three,
        projected_monthly_savings: s.estimated_monthly_savings,
        deadline: addDaysISO(ctx.today, 30),
        status: "chosen",
        transaction_id: table === "transactions" ? id : null,
        recurring_series_id: table === "recurring_series" ? id : null,
        category_id: rec.category_id ?? null,
      },
      summary: `Reduction action: ${s.title} (about ${money(s.estimated_monthly_savings)} per month)`,
      reason: s.description,
      group_id: group,
      source: "reduction_suggestion",
    })),
  );
  revalidatePath("/", "layout");
  back(fd, "3 suggestions are ready. Choose one, set the deadline, and approve it.");
}

/** Suggests categories for uncategorized transactions. Each suggestion is a proposal. */
export async function suggestCategories(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const [{ data: txns }, { data: cats }, { data: pending }] = await Promise.all([
    supabase.from("transactions").select("id,description,merchant_name,amount").is("category_id", null).eq("is_transfer", false).order("date", { ascending: false }).limit(60),
    supabase.from("categories").select("id,name,kind"),
    supabase.from("ai_proposals").select("record_id").eq("status", "pending").eq("source", "category_suggestion"),
  ]);
  const skip = new Set(((pending ?? []) as Row[]).map((p) => p.record_id));
  const list = ((txns ?? []) as Row[]).filter((t) => !skip.has(t.id));
  if (!list.length) back(fd, "No uncategorized transactions need suggestions.");
  const catList = (cats ?? []) as Row[];
  let mapping: { id: string; category: string }[] | null = null;
  try {
    const msg = await callClaude({
      sb: supabase,
      ownerId,
      purpose: "category_suggestions",
      system: AI_SYSTEM_BASE,
      messages: [
        {
          role: "user",
          content: `Categories: ${catList.map((c) => c.name).join(", ")}.\nAssign one category name to each transaction (negative amount = money out). Return only JSON: [{"id": "...", "category": "exact category name"}].\nTransactions: ${JSON.stringify(list.map((t) => ({ id: t.id, description: t.description, merchant: t.merchant_name, amount: Number(t.amount) })))}`,
        },
      ],
      maxTokens: 3000,
    });
    mapping = parseJsonFromText(textOf(msg));
  } catch (e) {
    back(fd, e instanceof AIUnavailable ? e.message : "The AI request failed.");
  }
  if (!Array.isArray(mapping)) back(fd, "The AI reply could not be read. Try again.");
  const byName = Object.fromEntries(catList.map((c) => [String(c.name).toLowerCase(), c]));
  const txById = Object.fromEntries(list.map((t) => [t.id, t]));
  const rows = mapping
    .filter((m) => txById[m.id] && byName[String(m.category).toLowerCase()])
    .map((m) => ({
      owner_id: ownerId,
      table_name: "transactions",
      action: "update",
      record_id: m.id,
      payload: { category_id: byName[String(m.category).toLowerCase()].id, category_source: "ai" },
      summary: `Category for "${txById[m.id].description}": ${byName[String(m.category).toLowerCase()].name}`,
      source: "category_suggestion",
    }));
  if (rows.length) await supabase.from("ai_proposals").insert(rows);
  revalidatePath("/", "layout");
  back(fd, `${rows.length} category suggestions are ready to approve.`);
}

export async function approveProposal(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id"));
  const overrides: Row = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("o_")) continue;
    const key = k.slice(2);
    const s = String(v);
    overrides[key] = s === "" ? null : /^-?\d+(\.\d+)?$/.test(s) && key !== "deadline" ? Number(s) : s;
  }
  const { error } = await supabase.rpc("apply_proposal", { p_id: id, p_overrides: overrides });
  if (error) {
    await supabase.from("ai_proposals").update({ error: error.message }).eq("id", id);
    back(fd, `The change could not be saved: ${error.message}`);
  }
  // A category correction approved from the AI also becomes a rule when asked
  if (fd.get("save_rule") === "on") {
    const { data: p } = await supabase.from("ai_proposals").select("*").eq("id", id).single();
    if (p?.table_name === "transactions" && p.payload?.category_id) {
      const { data: t } = await supabase.from("transactions").select("merchant_name").eq("id", p.record_id).single();
      if (t?.merchant_name) await supabase.from("categorization_rules").insert({ owner_id: ownerId, pattern: t.merchant_name, category_id: p.payload.category_id, created_from: "ai" });
    }
  }
  await evaluateConditions(await loadCtx(supabase, ownerId));
  revalidatePath("/", "layout");
  back(fd, "Approved and saved.");
}

export async function rejectProposal(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("ai_proposals").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", String(fd.get("id"))).eq("status", "pending");
  revalidatePath("/", "layout");
  back(fd, "Rejected. Nothing was changed.");
}

export async function approveAllCategories(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const { data } = await supabase.from("ai_proposals").select("id").eq("status", "pending").eq("source", "category_suggestion");
  let n = 0;
  for (const p of (data ?? []) as Row[]) {
    const { error } = await supabase.rpc("apply_proposal", { p_id: p.id, p_overrides: {} });
    if (!error) n++;
  }
  await evaluateConditions(await loadCtx(supabase, ownerId));
  revalidatePath("/", "layout");
  back(fd, `${n} categories approved and saved.`);
}
