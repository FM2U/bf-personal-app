/**
 * Weekly AI savings ideas: the spending analysis sent to the AI (last 90 days by category, merchant, and recurring
 * charge, with unused-subscription flags), the reply check (Zod), the savings estimate (computed from the real
 * numbers where possible, with a line saying how), the 90-day decline rule, and turning an approved idea into an
 * initiative draft or a reduction action. Pure functions, unit tested in src/lib/savings/ideas.test.ts.
 */
import { z } from "zod";
import { addDaysISO } from "@/lib/calc/dates";
import { normalizeDescription } from "@/lib/calc/csv";
import type { Proposal } from "@/lib/initiative/proposal";

export const ANALYSIS_DAYS = 90;
export const DECLINE_SUPPRESS_DAYS = 90;
export const MAX_IDEAS = 3;
/** 90 days in months (average month length 30.44 days). */
export const MONTHS_IN_PERIOD = ANALYSIS_DAYS / 30.4375;

export type SpendTxn = { id: string; date: string; amount: number; category_id: string | null; merchant_name: string | null; description: string | null; recurring_series_id?: string | null; is_transfer?: boolean | null };
export type SpendCategory = { id: string; name: string; kind?: string | null; is_software?: boolean | null };
export type SpendSeries = { id: string; merchant_name: string; frequency: string; monthly_cost: number | null; category_id: string | null; review_flag?: boolean | null; review_status?: string | null; status?: string | null };

export type Candidate = {
  key: string;
  type: "recurring_series" | "category" | "merchant";
  label: string;
  /** Current monthly cost: recurring charge = its monthly cost; category and merchant = last 90 days / 2.96 months. */
  monthly: number;
  total90: number;
  count: number;
  recurring_series_id?: string | null;
  category_id?: string | null;
  frequency?: string;
  unused?: boolean;
  category?: string | null;
};

export type Analysis = { periodStart: string; periodEnd: string; totalMonthly: number; candidates: Candidate[] };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Spending in the last 90 days: expense categories, the 15 largest merchants, and active recurring charges.
 * A recurring software charge marked for review and not yet confirmed as used is flagged "unused".
 */
export function analyzeSpending(input: { txns: SpendTxn[]; categories: SpendCategory[]; series: SpendSeries[]; today: string }): Analysis {
  const periodStart = addDaysISO(input.today, -ANALYSIS_DAYS);
  const catById = Object.fromEntries(input.categories.map((c) => [c.id, c]));
  const out = input.txns.filter((t) => !t.is_transfer && t.amount < 0 && t.date > periodStart && t.date <= input.today && (!t.category_id || (catById[t.category_id]?.kind ?? "expense") === "expense"));
  const byCat = new Map<string, { total: number; count: number }>();
  const byMerchant = new Map<string, { name: string; total: number; count: number; cats: Map<string, number> }>();
  let total = 0;
  for (const t of out) {
    const amt = -t.amount;
    total += amt;
    if (t.category_id) {
      const c = byCat.get(t.category_id) ?? { total: 0, count: 0 };
      c.total += amt;
      c.count++;
      byCat.set(t.category_id, c);
    }
    const name = (t.merchant_name || t.description || "").trim();
    const norm = normalizeDescription(name);
    if (!norm) continue;
    const m = byMerchant.get(norm) ?? { name, total: 0, count: 0, cats: new Map() };
    m.total += amt;
    m.count++;
    if (t.category_id) m.cats.set(t.category_id, (m.cats.get(t.category_id) ?? 0) + 1);
    byMerchant.set(norm, m);
  }
  const candidates: Candidate[] = [];
  for (const s of input.series) {
    if (s.status && s.status !== "active") continue;
    candidates.push({
      key: `series:${s.id}`,
      type: "recurring_series",
      label: s.merchant_name,
      monthly: r2(Number(s.monthly_cost ?? 0)),
      total90: r2(Number(s.monthly_cost ?? 0) * MONTHS_IN_PERIOD),
      count: 0,
      recurring_series_id: s.id,
      category_id: s.category_id,
      frequency: s.frequency,
      unused: !!s.review_flag && (s.review_status ?? "unreviewed") === "unreviewed",
      category: s.category_id ? catById[s.category_id]?.name ?? null : null,
    });
  }
  for (const [id, c] of byCat) {
    candidates.push({ key: `category:${id}`, type: "category", label: catById[id]?.name ?? "Uncategorized", monthly: r2(c.total / MONTHS_IN_PERIOD), total90: r2(c.total), count: c.count, category_id: id, category: catById[id]?.name ?? null });
  }
  [...byMerchant.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .forEach(([norm, m]) => {
      const topCat = [...m.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      candidates.push({ key: `merchant:${norm}`, type: "merchant", label: m.name, monthly: r2(m.total / MONTHS_IN_PERIOD), total90: r2(m.total), count: m.count, category_id: topCat, category: topCat ? catById[topCat]?.name ?? null : null });
    });
  candidates.sort((a, b) => b.monthly - a.monthly);
  return { periodStart, periodEnd: input.today, totalMonthly: r2(total / MONTHS_IN_PERIOD), candidates };
}

export const EstimateSchema = z.object({
  method: z.enum(["cancel", "reduce_percent", "reduce_to_amount", "other"]),
  percent: z.number().finite().min(0).max(100).nullish(),
  new_monthly_amount: z.number().finite().min(0).nullish(),
  monthly_amount: z.number().finite().min(0).nullish(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

export const IdeaReplySchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(90),
        target_keys: z.array(z.string().trim().min(1)).min(1).max(3),
        estimate: EstimateSchema,
        effort: z.enum(["low", "medium", "high"]),
        steps: z.array(z.string().trim().min(1).max(160)).min(2).max(4),
      }),
    )
    .max(MAX_IDEAS),
});
export type IdeaReply = z.infer<typeof IdeaReplySchema>;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Estimated monthly savings from the real current monthly cost, and a line saying how it was estimated.
 * cancel = the whole cost; reduce_percent = cost x percent; reduce_to_amount = cost minus the new amount;
 * other = the AI's number, never more than the current cost.
 */
export function estimateSavings(currentMonthly: number, e: Estimate): { monthly: number; basis: string } {
  const cur = Math.max(0, r2(currentMonthly));
  switch (e.method) {
    case "cancel":
      return { monthly: cur, basis: `Cancel it: the current cost is ${usd(cur)} per month (last 90 days).` };
    case "reduce_percent": {
      const pct = Math.min(100, Math.max(0, Number(e.percent ?? 0)));
      return { monthly: r2((cur * pct) / 100), basis: `Cut by ${pct}%: ${usd(cur)} per month now x ${pct}% = ${usd((cur * pct) / 100)}.` };
    }
    case "reduce_to_amount": {
      const next = Math.max(0, Number(e.new_monthly_amount ?? cur));
      const save = Math.max(0, r2(cur - next));
      return { monthly: save, basis: `Lower it to ${usd(next)} per month: ${usd(cur)} now minus ${usd(next)} = ${usd(save)}.` };
    }
    default: {
      const ai = Math.max(0, Number(e.monthly_amount ?? 0));
      const capped = Math.min(ai, cur);
      return { monthly: r2(capped), basis: `AI estimate of ${usd(ai)} per month${ai > cur ? `, held to the current cost of ${usd(cur)}` : ` (current cost ${usd(cur)} per month)`}.` };
    }
  }
}

export type IdeaHistory = { target_key: string; status: string; decided_at: string | null; created_at: string };

/** Target keys of one idea (an idea can target up to 3 expenses; they are stored comma separated). */
export const splitKeys = (k: string) => k.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Targets not to propose again: a declined idea suppresses its targets for 90 days from the day it was declined;
 * an idea still open (pending or Later) suppresses its targets until it is decided.
 */
export function suppressedTargets(history: IdeaHistory[], today: string, days = DECLINE_SUPPRESS_DAYS): Set<string> {
  const out = new Set<string>();
  const cutoff = addDaysISO(today, -days);
  for (const h of history) {
    const open = h.status === "pending" || h.status === "later";
    const recentDecline = h.status === "declined" && (h.decided_at ?? h.created_at).slice(0, 10) > cutoff;
    if (open || recentDecline) for (const k of splitKeys(h.target_key)) out.add(k);
  }
  return out;
}

export type NewIdea = {
  title: string;
  target_key: string;
  target_type: Candidate["type"];
  target_label: string;
  recurring_series_id: string | null;
  category_id: string | null;
  current_monthly_cost: number;
  estimated_monthly_savings: number;
  estimate_basis: string;
  effort: "low" | "medium" | "high";
  steps: string[];
};

/** Keeps the AI's ideas that target known, not suppressed expenses and save money; computes each estimate. */
export function buildIdeas(reply: IdeaReply, candidates: Candidate[], suppressed: Set<string>): NewIdea[] {
  const byKey = Object.fromEntries(candidates.map((c) => [c.key, c]));
  const used = new Set<string>();
  const out: NewIdea[] = [];
  for (const idea of reply.ideas) {
    const keys = [...new Set(idea.target_keys)].filter((k) => byKey[k]);
    if (!keys.length || keys.some((k) => suppressed.has(k) || used.has(k))) continue;
    const targets = keys.map((k) => byKey[k]);
    const current = r2(targets.reduce((s, t) => s + t.monthly, 0));
    const est = estimateSavings(current, idea.estimate);
    if (est.monthly <= 0) continue;
    keys.forEach((k) => used.add(k));
    const first = targets[0];
    out.push({
      title: idea.title,
      target_key: keys.join(","),
      target_type: first.type,
      target_label: targets.map((t) => t.label).join(", "),
      recurring_series_id: first.recurring_series_id ?? null,
      category_id: first.category_id ?? null,
      current_monthly_cost: current,
      estimated_monthly_savings: est.monthly,
      estimate_basis: est.basis,
      effort: idea.effort,
      steps: idea.steps,
    });
    if (out.length >= MAX_IDEAS) break;
  }
  return out;
}

/** The request to the AI. "TASK: savings_ideas" lets the local test stand-in recognize it. */
export function ideasPrompt(a: Analysis, suppressed: Set<string>): string {
  const open = a.candidates.filter((c) => !suppressed.has(c.key));
  // The 40 largest expenses, plus every subscription flagged as unused (often small, but easy to cancel).
  const top = open.slice(0, 40);
  const list = [...top, ...open.slice(40).filter((c) => c.unused)]
    .map((c) => ({ key: c.key, type: c.type, name: c.label, monthly: c.monthly, last_90_days: c.total90, charges: c.count || undefined, frequency: c.frequency, unused_subscription_flag: c.unused || undefined, category: c.category ?? undefined }));
  return `TASK: savings_ideas
Spending from ${a.periodStart} to ${a.periodEnd} (90 days). Average total spending: $${Math.round(a.totalMonthly)} per month.
Expenses (key, type, monthly cost, last 90 days, flags): ${JSON.stringify(list)}
Give up to 3 practical savings ideas with the largest real savings first. Prefer recurring charges flagged as unused subscriptions,
duplicate or overlapping charges (for example several storage units), and large categories such as food.
Return ONLY JSON: {"ideas": [{"title": "short action, under 10 words", "target_keys": ["key from the list"], "estimate": {"method": "cancel" | "reduce_percent" | "reduce_to_amount" | "other", "percent": number or null, "new_monthly_amount": number or null, "monthly_amount": number or null}, "effort": "low" | "medium" | "high", "steps": ["2 to 4 short steps"]}]}
Use only keys from the list. The app computes the savings from the real numbers with your method.`;
}

/**
 * An approved idea as an initiative draft (the owner reviews and edits it on the same screen as "Start an initiative"):
 * one goal, one milestone with options written in advance, a budget target change for a category, a short plan,
 * and a "Steps" checklist.
 */
export function ideaToProposal(idea: { title: string; target_label: string; target_type: string; category_name?: string | null; current_monthly_cost: number; estimated_monthly_savings: number; estimate_basis: string; steps: string[] }, today: string): Proposal {
  const target = Math.max(0, Math.round(idea.current_monthly_cost - idea.estimated_monthly_savings));
  const deadline = addDaysISO(today, 90);
  const isCategory = idea.target_type === "category" && !!idea.category_name;
  return {
    initiative: {
      name: idea.title.slice(0, 80),
      purpose: `Save about ${usd(idea.estimated_monthly_savings)} per month on ${idea.target_label}. ${idea.estimate_basis}`.slice(0, 500),
      parent_initiative: "Personal Finance",
    },
    goals: [
      {
        title: `${idea.target_label}: ${usd(target)} or less per month by ${deadline}`.slice(0, 160),
        metric_key: isCategory ? "category_spending_last_month" : null,
        categories: isCategory ? [idea.category_name as string] : null,
        comparison: "lte",
        target_value: target,
        deadline,
      },
    ],
    milestones: [
      {
        title: `Savings in place: ${idea.target_label}`.slice(0, 160),
        completion_test: `The monthly cost of ${idea.target_label} is ${usd(target)} or less.`.slice(0, 300),
        due_date: addDaysISO(today, 30),
        goal: 0,
        target_value: target,
        options_if_missed: ["Extend 30 days", "Choose a different savings idea", "Drop this idea"],
      },
    ],
    recurring_tasks: [],
    target: null,
    budget_change: isCategory ? { category: idea.category_name as string, new_monthly_amount: target, estimated_monthly_savings: idea.estimated_monthly_savings } : null,
    decision_condition: null,
    plan_document: {
      title: `Plan: ${idea.title}`.slice(0, 120),
      body: [
        `- **Savings:** about ${usd(idea.estimated_monthly_savings)} per month.`,
        `  - **How estimated:** ${idea.estimate_basis}`,
        `- **Expense:** ${idea.target_label}, ${usd(idea.current_monthly_cost)} per month now.`,
        "- **Steps:**",
        ...idea.steps.map((s, i) => `  - **Step ${i + 1}:** ${s}`),
      ].join("\n"),
    },
    checklists: [{ name: "Steps", reset_weekly: false, recurring_task: null, items: idea.steps.map((s) => ({ text: s.slice(0, 160), quantity: null, notes: null })) }],
    estimated_monthly_savings: idea.estimated_monthly_savings,
  };
}

/** An approved idea as a reduction action on the expense (Finance, Budget lists reduction actions). */
export function ideaToReductionAction(
  idea: { title: string; steps: string[]; estimated_monthly_savings: number; estimate_basis: string; recurring_series_id: string | null; category_id: string | null },
  edits: { title?: string; deadline?: string; projected_monthly_savings?: number; steps?: string },
  today: string,
): Record<string, unknown> {
  const steps = edits.steps?.trim() ? edits.steps.trim() : idea.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return {
    title: (edits.title?.trim() || idea.title).slice(0, 200),
    chosen_suggestion: steps,
    suggestions: [{ title: idea.title, description: idea.estimate_basis, estimated_monthly_savings: idea.estimated_monthly_savings }],
    deadline: edits.deadline && /^\d{4}-\d{2}-\d{2}$/.test(edits.deadline) ? edits.deadline : addDaysISO(today, 30),
    projected_monthly_savings: Number.isFinite(edits.projected_monthly_savings) ? edits.projected_monthly_savings : idea.estimated_monthly_savings,
    status: "chosen",
    recurring_series_id: idea.recurring_series_id,
    category_id: idea.category_id,
    notes: idea.estimate_basis,
  };
}
