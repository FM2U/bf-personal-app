import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectRecurring, seriesStatus } from "@/lib/calc/recurring";
import { addDaysISO } from "@/lib/calc/dates";
import { fetchAll } from "@/lib/data";
import type { Row } from "@/lib/types";

export function ruleMatches(rule: Row, text: string): boolean {
  const t = text.toLowerCase();
  const p = String(rule.pattern ?? "").toLowerCase().trim();
  if (!p) return false;
  if (rule.match_type === "equals") return t === p;
  if (rule.match_type === "starts_with") return t.startsWith(p);
  return t.includes(p);
}

/** Applies category rules to transactions that have no category. Returns the number categorized. */
export async function applyCategoryRules(sb: SupabaseClient, ownerId: string, onlyIds?: string[]): Promise<number> {
  const { data: rules } = await sb.from("categorization_rules").select("*").eq("owner_id", ownerId).order("priority");
  if (!rules?.length) return 0;
  let q = sb.from("transactions").select("id,description,merchant_name").eq("owner_id", ownerId).is("category_id", null).limit(1000);
  if (onlyIds?.length) q = q.in("id", onlyIds.slice(0, 500));
  const { data: txns } = await q;
  let n = 0;
  for (const t of (txns ?? []) as Row[]) {
    const rule = (rules as Row[]).find((r) => ruleMatches(r, `${t.merchant_name ?? ""} ${t.description ?? ""}`));
    if (!rule) continue;
    await sb.from("transactions").update({ category_id: rule.category_id, category_source: "rule" }).eq("id", t.id);
    n++;
  }
  return n;
}

/** Finds repeating charges in the last 15 months and saves them. Software charges are marked for review. */
export async function detectAndSaveRecurring(sb: SupabaseClient, ownerId: string, today: string): Promise<{ series: number }> {
  const txns = await fetchAll((from, to) =>
    sb
      .from("transactions")
      .select("id,date,amount,description,merchant_name,category_id,account_id,is_transfer")
      .eq("owner_id", ownerId)
      .lt("amount", 0)
      .eq("is_transfer", false)
      .gte("date", addDaysISO(today, -460))
      .order("date")
      .range(from, to),
  );
  const { data: cats } = await sb.from("categories").select("id,is_software").eq("owner_id", ownerId);
  const software = new Set(((cats ?? []) as Row[]).filter((c) => c.is_software).map((c) => c.id));
  const byId = Object.fromEntries(txns.map((t) => [t.id, t]));
  const detected = detectRecurring(txns.map((t) => ({ id: t.id, date: t.date, amount: Number(t.amount), description: t.description, merchant_name: t.merchant_name })));
  const { data: existingRows } = await sb.from("recurring_series").select("*").eq("owner_id", ownerId);
  const existing = (existingRows ?? []) as Row[];
  for (const s of detected) {
    const sample = byId[s.transactionIds[s.transactionIds.length - 1]];
    const categoryId = sample?.category_id ?? null;
    const isSoftware = categoryId ? software.has(categoryId) : false;
    const status = seriesStatus(s.nextExpectedDate, s.frequency, today);
    const found = existing.find((e) => e.normalized_name === s.normalizedName && e.frequency === s.frequency);
    const fields = {
      merchant_name: s.merchantName,
      average_amount: s.averageAmount,
      monthly_cost: s.monthlyCost,
      last_date: s.lastDate,
      next_expected_date: s.nextExpectedDate,
      occurrences: s.occurrences,
      account_id: sample?.account_id ?? null,
      category_id: found?.category_id ?? categoryId,
    };
    let id = found?.id as string | undefined;
    if (found) {
      await sb.from("recurring_series").update({ ...fields, status: found.status === "cancelled" ? "cancelled" : status }).eq("id", found.id);
    } else {
      const { data } = await sb
        .from("recurring_series")
        .insert({ owner_id: ownerId, normalized_name: s.normalizedName, frequency: s.frequency, status, review_flag: isSoftware, ...fields })
        .select("id")
        .single();
      id = data?.id;
    }
    if (found && isSoftware && found.review_status === "unreviewed" && !found.review_flag) {
      await sb.from("recurring_series").update({ review_flag: true }).eq("id", found.id);
    }
    if (id) await sb.from("transactions").update({ recurring_series_id: id }).in("id", s.transactionIds);
  }
  return { series: detected.length };
}
