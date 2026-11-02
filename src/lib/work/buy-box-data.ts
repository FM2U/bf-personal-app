import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUY_BOX_INPUT_KEYS, buyBoxSettingsFromRows, defaultBuyBoxSettings, type BuyBoxSettings } from "@/lib/work/buy-box";

/**
 * The buy box (Settings, Buy box; inputs rows, AI instructions revision 1): the core and stretch ranges, industries,
 * excluded types, regions, and owner-operator. The AI instructions (src/lib/ai/instructions.ts) and the Fits check on
 * Screen listings read it on every load or click, so both follow any change. A missing row reads as its default; a
 * failed read gives the defaults.
 */
export async function loadBuyBoxSettings(sb: SupabaseClient, ownerId: string): Promise<BuyBoxSettings> {
  const { data, error } = await sb.from("inputs").select("key,value_number,value_text").eq("owner_id", ownerId).in("key", Object.values(BUY_BOX_INPUT_KEYS));
  if (error) return defaultBuyBoxSettings();
  return buyBoxSettingsFromRows((data ?? []) as { key: string; value_number?: unknown; value_text?: unknown }[]);
}
