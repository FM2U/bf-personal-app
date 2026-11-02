import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUY_BOX_INPUT_KEYS, buyBoxSettingsFromRows, defaultBuyBoxSettings, type BuyBoxSettings } from "@/lib/work/buy-box";

/**
 * The buy box the AI instructions read (src/lib/ai/instructions.ts): the size range, industries, and regions of
 * src/lib/work/buy-box.ts and the three settings in the inputs table (Settings, Buy box). Read on every AI click, so the
 * instructions follow any change. A missing row reads as its default; a failed read gives the defaults.
 */
export async function loadBuyBoxSettings(sb: SupabaseClient, ownerId: string): Promise<BuyBoxSettings> {
  const { data, error } = await sb.from("inputs").select("key,value_number,value_text").eq("owner_id", ownerId).in("key", Object.values(BUY_BOX_INPUT_KEYS));
  if (error) return defaultBuyBoxSettings();
  return buyBoxSettingsFromRows((data ?? []) as { key: string; value_number?: unknown; value_text?: unknown }[]);
}
