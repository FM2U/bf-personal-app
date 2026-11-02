"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { BUY_BOX_FINANCING_MAX, BUY_BOX_GROWTH_MAX, BUY_BOX_INPUT_KEYS, oneLine } from "@/lib/work/buy-box";
import type { Row } from "@/lib/types";

/**
 * Settings, Buy box (AI instructions, approved 2026-11-02): owner-operator (yes or no), financing (optional), and
 * growth goals (optional, one line), kept as inputs rows (category "Buy box"; database update 0028 adds them, and a
 * save adds any that is missing, so the page works before the update too). The AI instructions read them on every
 * click. Returns { ok: false, error } instead of throwing, so what was typed stays on the screen.
 */
export type BuyBoxInput = { ownerOperator: boolean; financing: string; growthGoals: string };

const ROWS = {
  ownerOperator: { key: BUY_BOX_INPUT_KEYS.ownerOperator, label: "Owner-operator (1 yes, 0 no)", unit: "boolean", sort: 95, description: "Whether the buyer runs the business himself. Read by the AI instructions on every deal and listing. Edited in Settings, Buy box." },
  financing: { key: BUY_BOX_INPUT_KEYS.financing, label: "Financing", unit: "text", sort: 96, description: "Optional, for example cash, SBA loan, seller note. Read by the AI instructions. Edited in Settings, Buy box." },
  growthGoals: { key: BUY_BOX_INPUT_KEYS.growthGoals, label: "Growth goals", unit: "text", sort: 97, description: "Optional, one line. Read by the AI instructions. Edited in Settings, Buy box." },
} as const;

export async function saveBuyBoxSettings(input: BuyBoxInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase: sb, ownerId } = await requireOwner();
  const values: Record<keyof typeof ROWS, { value_number: number | null; value_text: string | null }> = {
    ownerOperator: { value_number: input.ownerOperator === false ? 0 : 1, value_text: null },
    financing: { value_number: null, value_text: oneLine(input.financing, BUY_BOX_FINANCING_MAX) },
    growthGoals: { value_number: null, value_text: oneLine(input.growthGoals, BUY_BOX_GROWTH_MAX) },
  };
  const { data, error: readError } = await sb.from("inputs").select("id,key").eq("owner_id", ownerId).in("key", Object.values(BUY_BOX_INPUT_KEYS));
  if (readError) return { ok: false, error: `Not saved: ${readError.message}` };
  const ids = new Map(((data ?? []) as Row[]).map((r) => [String(r.key), String(r.id)]));
  for (const name of Object.keys(ROWS) as (keyof typeof ROWS)[]) {
    const row = ROWS[name];
    const id = ids.get(row.key);
    const { error } = id
      ? await sb.from("inputs").update(values[name]).eq("id", id)
      : await sb.from("inputs").insert({ owner_id: ownerId, key: row.key, label: row.label, category: "Buy box", unit: row.unit, description: row.description, sort_order: row.sort, ...values[name] });
    if (error) return { ok: false, error: `Not saved: ${error.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
