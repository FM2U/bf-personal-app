import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobVsAcquisition, projectScenario, type Baseline } from "@/lib/calc/scenario";
import type { FinanceSnapshot } from "@/lib/finance";
import type { Row } from "@/lib/types";

/** Current numbers used as the starting point for every scenario. */
export function baselineFromSnapshot(s: FinanceSnapshot): Baseline {
  return {
    startDate: s.today,
    cash: s.cash,
    monthlySpending: s.averages.avgSpending,
    monthlyIncome: (s.inputs.num.runway_subtract_income ?? 1) >= 1 ? s.averages.avgIncome : 0,
    debts: s.debtInputs,
    investmentBalance: s.investmentBalance,
    otherAssets: s.otherAssets,
    emergencyFundBalance: s.emergencyFund.balance,
    inputs: s.inputs.num,
    textInputs: s.inputs.text,
  };
}

export async function loadScenario(sb: SupabaseClient, id: string): Promise<{ scenario: Row; overrides: Record<string, number> } | null> {
  const { data: scenario } = await sb.from("scenarios").select("*").eq("id", id).maybeSingle();
  if (!scenario) return null;
  const { data: changes } = await sb.from("scenario_input_changes").select("key,value_number").eq("scenario_id", id);
  const overrides = Object.fromEntries(((changes ?? []) as Row[]).map((c) => [c.key, Number(c.value_number)]));
  return { scenario, overrides };
}

export function runScenario(base: Baseline, overrides: Record<string, number>, horizon: number) {
  const result = projectScenario(base, overrides, horizon);
  const jva = jobVsAcquisition({ ...base.inputs, ...overrides });
  return { result, jobVsAcquisition: jva };
}
