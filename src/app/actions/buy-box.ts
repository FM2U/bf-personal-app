"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { BUY_BOX_INPUT_KEYS, BUY_BOX_TEXT_MAX, buyBoxRangeProblem, oneLine, parseExcludedKeys, parseMoneyText, parseRegionKeys, type BuyBoxSettings, type ExcludedKey, type RegionKey } from "@/lib/work/buy-box";
import type { Row } from "@/lib/types";

/**
 * Settings, Buy box (AI instructions revision 1, approved 2026-11-02): the core and stretch ranges of EBITDA or SDE,
 * the industries included, the excluded types (three boxes and an Other text), the regions (five boxes and an Other
 * text), and owner-operator, kept as inputs rows (category "Buy box"; database update 0029 adds them with today's
 * values, and a save adds any that is missing, so the page works before the update too). The Fits check on Screen
 * listings and the AI instructions read them on every load or click. Returns { ok: false, error } instead of throwing,
 * so what was typed stays on the screen.
 */
export type BuyBoxInput = {
  /** Amounts as typed: "$1M", "750K", "2,500,000". */
  coreMin: string;
  coreMax: string;
  stretchMin: string;
  stretchMax: string;
  industries: string;
  excluded: ExcludedKey[];
  excludedOther: string;
  regions: RegionKey[];
  regionsOther: string;
  ownerOperator: boolean;
};

type Value = { value_number: number | null; value_text: string | null };
type RowSpec = { key: string; label: string; unit: "usd" | "text" | "boolean"; sort: number; description: string };

const READ = "Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.";

const ROWS: Record<keyof BuyBoxSettings, RowSpec> = {
  coreMin: { key: BUY_BOX_INPUT_KEYS.coreMin, label: "Core range from (EBITDA or SDE)", unit: "usd", sort: 90, description: `The low end of the core range. ${READ}` },
  coreMax: { key: BUY_BOX_INPUT_KEYS.coreMax, label: "Core range to (EBITDA or SDE)", unit: "usd", sort: 91, description: `The high end of the core range. ${READ}` },
  stretchMin: { key: BUY_BOX_INPUT_KEYS.stretchMin, label: "Stretch range from (EBITDA or SDE)", unit: "usd", sort: 92, description: `The low end of the stretch range (a near fit). ${READ}` },
  stretchMax: { key: BUY_BOX_INPUT_KEYS.stretchMax, label: "Stretch range to (EBITDA or SDE)", unit: "usd", sort: 93, description: `The high end of the stretch range (a near fit). ${READ}` },
  industries: { key: BUY_BOX_INPUT_KEYS.industries, label: "Industries included", unit: "text", sort: 94, description: `For example B2B services. ${READ}` },
  ownerOperator: { key: BUY_BOX_INPUT_KEYS.ownerOperator, label: "Owner-operator (1 yes, 0 no)", unit: "boolean", sort: 95, description: "Whether the buyer runs the business himself. Read by the AI instructions on every deal and listing. Edited in Settings, Buy box." },
  excluded: { key: BUY_BOX_INPUT_KEYS.excluded, label: "Excluded types", unit: "text", sort: 96, description: `Ticked types (retail, direct_to_consumer, franchises). ${READ}` },
  excludedOther: { key: BUY_BOX_INPUT_KEYS.excludedOther, label: "Excluded types, other", unit: "text", sort: 97, description: `Typed types, separated by commas. ${READ}` },
  regions: { key: BUY_BOX_INPUT_KEYS.regions, label: "Regions", unit: "text", sort: 98, description: `Ticked US regions (southeast, east_coast, midwest, southwest, west). ${READ}` },
  regionsOther: { key: BUY_BOX_INPUT_KEYS.regionsOther, label: "Regions, other", unit: "text", sort: 99, description: `Typed regions or places, separated by commas. ${READ}` },
};

export async function saveBuyBoxSettings(input: BuyBoxInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase: sb, ownerId } = await requireOwner();
  const amounts = { coreMin: parseMoneyText(input.coreMin) ?? NaN, coreMax: parseMoneyText(input.coreMax) ?? NaN, stretchMin: parseMoneyText(input.stretchMin) ?? NaN, stretchMax: parseMoneyText(input.stretchMax) ?? NaN };
  const problem = buyBoxRangeProblem(amounts);
  if (problem) return { ok: false, error: problem };
  const text = (v: string | null) => ({ value_number: null, value_text: v });
  const values: Record<keyof BuyBoxSettings, Value> = {
    coreMin: { value_number: amounts.coreMin, value_text: null },
    coreMax: { value_number: amounts.coreMax, value_text: null },
    stretchMin: { value_number: amounts.stretchMin, value_text: null },
    stretchMax: { value_number: amounts.stretchMax, value_text: null },
    industries: text(oneLine(input.industries, BUY_BOX_TEXT_MAX)),
    ownerOperator: { value_number: input.ownerOperator === false ? 0 : 1, value_text: null },
    // An empty list is kept as an empty text (none ticked), so it does not read as the default.
    excluded: text(parseExcludedKeys((input.excluded ?? []).join(",")).join(",")),
    excludedOther: text(oneLine(input.excludedOther, BUY_BOX_TEXT_MAX)),
    regions: text(parseRegionKeys((input.regions ?? []).join(",")).join(",")),
    regionsOther: text(oneLine(input.regionsOther, BUY_BOX_TEXT_MAX)),
  };
  const keys = Object.values(ROWS).map((r) => r.key);
  const { data, error: readError } = await sb.from("inputs").select("id,key").eq("owner_id", ownerId).in("key", keys);
  if (readError) return { ok: false, error: `Not saved: ${readError.message}` };
  const ids = new Map(((data ?? []) as Row[]).map((r) => [String(r.key), String(r.id)]));
  for (const name of Object.keys(ROWS) as (keyof BuyBoxSettings)[]) {
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
