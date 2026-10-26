import "server-only";
import { addDaysISO, addMonthsISO, monthBounds, previousMonthKeys } from "@/lib/calc/dates";
import { completionScore, repeatedMisses } from "@/lib/calc/scores";
import { round2 } from "@/lib/calc/runway";
import { computeMetrics } from "@/lib/metrics";
import { tryDraft } from "@/lib/ai/claude";
import { money, months as fmtMonths, date as fmtDate } from "@/lib/format";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { markdownToPlain } from "@/lib/markdown";
import { loadTargets, targetTotals } from "@/lib/targets";
import type { Row } from "@/lib/types";
import { createAlert, createTask, type Ctx } from "./helpers";

export function nextReportDate(schedule: string, from: string): string {
  if (schedule === "monthly") return addMonthsISO(from, 1);
  if (schedule === "biweekly") return addDaysISO(from, 14);
  return addDaysISO(from, 7);
}

export function periodLengthDays(schedule: string): number {
  return schedule === "monthly" ? 30 : schedule === "biweekly" ? 14 : 7;
}

/** Cash in runway accounts at the end of each of the last months. */
async function cashTrend(ctx: Ctx, runwayAccountIds: string[]): Promise<{ month: string; cash: number }[]> {
  if (!runwayAccountIds.length) return [];
  const { data } = await ctx.sb.from("account_balances").select("account_id,as_of,balance").eq("owner_id", ctx.ownerId).in("account_id", runwayAccountIds).order("as_of");
  const keys = [...previousMonthKeys(ctx.today, 5), ctx.today.slice(0, 7)];
  return keys.map((k) => {
    const end = monthBounds(`${k}-01`).end;
    const latest: Record<string, number> = {};
    for (const b of (data ?? []) as Row[]) if (b.as_of <= end) latest[b.account_id] = Number(b.balance);
    return { month: k, cash: round2(Object.values(latest).reduce((s, v) => s + v, 0)) };
  });
}

/** The saved copy of the numbers for one partner, limited to the sections that partner sees. */
export async function buildPartnerSnapshot(ctx: Ctx, partner: Row, start: string, end: string): Promise<Row> {
  const { sb, ownerId } = ctx;
  const sections: string[] = partner.sections ?? [];
  const metrics = await computeMetrics(sb, ctx.today, ownerId);
  const snap = metrics.snapshot;
  const out: Row = { generated_on: ctx.today, period_start: start, period_end: end, sections };
  if (sections.includes("runway")) {
    const ids = snap.accounts.filter((a) => a.is_active && a.include_in_runway && ["checking", "savings", "cash"].includes(a.kind) && (snap.includeBusiness || a.entity_kind !== "business")).map((a) => a.id);
    out.runway = {
      months: snap.runway.months,
      target_months: snap.inputs.num.runway_target_months,
      cash: snap.cash,
      avg_monthly_spending: snap.averages.avgSpending,
      avg_monthly_income: snap.averages.avgIncome,
      cash_trend: await cashTrend(ctx, ids),
    };
  }
  if (sections.includes("milestones")) {
    const { data } = await sb.from("milestones").select("title,status,due_date,met_on,completion_test").eq("owner_id", ownerId);
    const ms = (data ?? []) as Row[];
    out.milestones = {
      completed: ms.filter((m) => m.status === "met" && m.met_on && m.met_on >= start && m.met_on <= end).map((m) => ({ title: m.title, met_on: m.met_on })),
      missed: ms.filter((m) => m.status === "missed" && m.due_date >= start && m.due_date <= end).map((m) => ({ title: m.title, due_date: m.due_date })),
      upcoming: ms.filter((m) => ["planned", "active"].includes(m.status) && m.due_date > end).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5).map((m) => ({ title: m.title, due_date: m.due_date, completion_test: m.completion_test })),
    };
  }
  if (sections.includes("commitments")) {
    const [{ data: cs }, { data: misses }] = await Promise.all([
      sb.from("commitments").select("id,title,due_date,status").eq("owner_id", ownerId),
      sb.from("missed_commitments").select("commitment_id").eq("owner_id", ownerId),
    ]);
    const list = (cs ?? []) as Row[];
    const titles = Object.fromEntries(list.map((c) => [c.id, c.title]));
    out.commitments = {
      score: completionScore(list as { due_date: string; status: "open" }[], start, end),
      repeated_misses: Object.entries(repeatedMisses((misses ?? []) as { commitment_id: string }[])).map(([id, n]) => ({ title: titles[id] ?? "Commitment", misses: n })),
    };
  }
  if (sections.includes("savings")) {
    const { data } = await sb.from("reduction_actions").select("title,status,actual_monthly_savings,projected_monthly_savings,completed_on").eq("owner_id", ownerId);
    const done = ((data ?? []) as Row[]).filter((r) => r.status === "completed");
    out.savings = {
      monthly_savings_achieved: round2(done.reduce((s, r) => s + Number(r.actual_monthly_savings ?? r.projected_monthly_savings ?? 0), 0)),
      completed_actions: done.length,
      in_progress_actions: ((data ?? []) as Row[]).filter((r) => r.status === "chosen" || r.status === "in_progress").length,
      emergency_fund_pct: snap.emergencyFund.pct,
    };
  }
  if (sections.includes("loans")) {
    const ids: string[] = partner.funding_source_ids ?? [];
    let q = sb.from("funding_sources").select("*").eq("owner_id", ownerId).eq("kind", "loan");
    if (ids.length) q = q.in("id", ids);
    else if (partner.contact_id) q = q.eq("contact_id", partner.contact_id);
    else q = q.eq("giver_name", partner.name);
    const { data: loans } = await q;
    const loanList = (loans ?? []) as Row[];
    const { data: sched } = loanList.length ? await sb.from("repayment_schedules").select("*").in("funding_source_id", loanList.map((l) => l.id)).order("due_date") : { data: [] };
    out.loans = loanList.map((l) => {
      const rows = ((sched ?? []) as Row[]).filter((r) => r.funding_source_id === l.id);
      const paid = rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
      const principalPaid = rows.reduce((s, r) => s + Math.min(Number(r.paid_amount ?? 0), Number(r.principal ?? r.amount_due)), 0);
      const next = rows.find((r) => Number(r.paid_amount ?? 0) < Number(r.amount_due));
      return {
        name: l.giver_name,
        amount: Number(l.amount),
        paid_to_date: round2(paid),
        remaining_principal: round2(Math.max(0, Number(l.amount) - principalPaid)),
        overdue_payments: rows.filter((r) => r.due_date < ctx.today && Number(r.paid_amount ?? 0) < Number(r.amount_due)).length,
        next_payment: next ? { due_date: next.due_date, amount: Number(next.amount_due) - Number(next.paid_amount ?? 0) } : null,
      };
    });
  }
  if (sections.includes("targets")) {
    // Only targets marked "show to accountability partners". Empty until database update 0008 is applied.
    const data = await loadTargets(sb, { ownerId, tz: ctx.tz, from: addDaysISO(start, -120), to: end });
    out.targets = data.available
      ? targetTotals(data, start, end, end, (t) => !!t.show_to_partners).map((t) => ({
          name: t.name,
          period: t.period,
          minimum: t.minimum,
          total: t.total,
          required: t.required,
          met: t.met,
          missed: t.missed,
          pct: t.pct,
          met_in_a_row: t.met_in_a_row,
        }))
      : [];
  }
  return out;
}

export function templatePartnerSummary(s: Row): string {
  const parts: string[] = [];
  if (s.runway) parts.push(`- **Runway:** ${fmtMonths(s.runway.months)} against a target of ${s.runway.target_months ?? "not set"} months. Cash is ${money(s.runway.cash)}.`);
  if (s.milestones) parts.push(`- **Milestones:** ${s.milestones.completed.length} completed, ${s.milestones.missed.length} missed this period.`);
  if (s.commitments) parts.push(`- **Commitments:** ${s.commitments.score.met} met, ${s.commitments.score.missed} missed.`);
  if (s.targets?.length) for (const t of s.targets as Row[]) parts.push(`- **${t.name}:** ${t.total} done of ${t.required} required. ${t.met} ${t.period === "week" ? "weeks" : "days"} met, ${t.missed} missed.`);
  if (s.savings) parts.push(`- **Savings:** ${money(s.savings.monthly_savings_achieved)} per month from completed reduction actions.`);
  if (s.loans?.length) for (const l of s.loans as Row[]) parts.push(`- **Loan from ${l.name}:** ${money(l.paid_to_date)} repaid, ${money(l.remaining_principal)} remaining${l.next_payment ? `. Next payment ${money(l.next_payment.amount)} on ${fmtDate(l.next_payment.due_date)}` : ""}.`);
  return parts.join("\n");
}

/** Creates a draft report (saved numbers plus a summary draft) for one partner. */
export async function createPartnerReport(ctx: Ctx, partner: Row): Promise<string | null> {
  const end = ctx.today;
  const start = addDaysISO(end, -periodLengthDays(partner.schedule) + 1);
  const snapshot = await buildPartnerSnapshot(ctx, partner, start, end);
  const ai = await tryDraft({
    sb: ctx.sb,
    ownerId: ctx.ownerId,
    purpose: "partner_report_summary",
    prompt: `Write a short summary (under 120 words, at most 6 bullets) for an accountability partner report covering ${start} to ${end}. Refer to Bram in the first person ("I"). State facts and numbers only. Data (JSON): ${JSON.stringify(snapshot).slice(0, 8000)}`,
    maxTokens: 400,
  });
  const { data } = await ctx.sb
    .from("partner_reports")
    .insert({
      owner_id: ctx.ownerId,
      partner_id: partner.id,
      period_start: start,
      period_end: end,
      status: "draft",
      snapshot,
      summary: ai ?? templatePartnerSummary(snapshot),
      summary_source: ai ? "ai" : "template",
    })
    .select("id")
    .single();
  if (data) {
    await createTask(ctx, {
      title: `Review and finalize the report for accountability partner ${partner.name}`,
      due_date: ctx.today,
      source: "partner_report",
      source_key: `partner-report:${data.id}`,
      related_type: "partner_reports",
      related_id: data.id,
    });
  }
  return data?.id ?? null;
}

/** Morning job: creates report drafts for partners whose report date has arrived. */
export async function schedulePartnerReports(ctx: Ctx): Promise<{ created: number }> {
  const { data } = await ctx.sb.from("partners").select("*").eq("owner_id", ctx.ownerId).eq("is_active", true).lte("next_report_on", ctx.today);
  let created = 0;
  for (const p of (data ?? []) as Row[]) {
    const id = await createPartnerReport(ctx, p);
    if (id) created++;
    let next = nextReportDate(p.schedule, p.next_report_on);
    while (next <= ctx.today) next = nextReportDate(p.schedule, next);
    await ctx.sb.from("partners").update({ next_report_on: next }).eq("id", p.id);
  }
  return { created };
}

/** Text of the report for email, call script, or letter. */
export function reportText(partner: Row, report: Row, link: string | null, format: "email" | "phone" | "mail"): { subject: string; body: string } {
  const s = report.snapshot ?? {};
  const lines: string[] = [];
  const period = `${fmtDate(report.period_start)} to ${fmtDate(report.period_end)}`;
  if (format === "phone") lines.push(`Call script for ${partner.name}. Period: ${period}.`, "");
  else lines.push(`Hello ${partner.name},`, "", `Here is my accountability report for ${period}.`, "");
  if (report.summary) lines.push(markdownToPlain(report.summary), "");
  if (s.runway) lines.push(`Runway: ${fmtMonths(s.runway.months)} (target ${s.runway.target_months ?? "not set"} months). Cash: ${money(s.runway.cash)}.`);
  if (s.milestones) {
    lines.push(`Milestones completed: ${s.milestones.completed.map((m: Row) => m.title).join("; ") || "none"}.`);
    lines.push(`Milestones missed: ${s.milestones.missed.map((m: Row) => m.title).join("; ") || "none"}.`);
  }
  if (s.commitments) {
    lines.push(`Commitment completion: ${s.commitments.score.pct ?? "not available"}${s.commitments.score.pct !== null ? "%" : ""} (${s.commitments.score.met} met, ${s.commitments.score.missed} missed).`);
    if (s.commitments.repeated_misses?.length) lines.push(`Repeated misses: ${s.commitments.repeated_misses.map((r: Row) => `${r.title} (${r.misses})`).join("; ")}.`);
  }
  if (s.targets?.length) for (const t of s.targets as Row[]) lines.push(`${t.name}: ${t.total} done of ${t.required} required (${t.met} ${t.period === "week" ? "weeks" : "days"} met, ${t.missed} missed).`);
  if (s.savings) lines.push(`Monthly savings achieved: ${money(s.savings.monthly_savings_achieved)}.`);
  if (s.loans?.length) for (const l of s.loans) lines.push(`Loan repayment: ${money(l.paid_to_date)} repaid of ${money(l.amount)}. ${l.overdue_payments ? `${l.overdue_payments} payment(s) overdue.` : "No payments overdue."}`);
  if (format === "phone") lines.push("", "Questions to ask: Do you have any questions about these numbers? Is there anything you want me to report next time?");
  if (link && format !== "phone") lines.push("", `The full report is here (no login needed): ${link}`, "Nothing is required from you. You can press Reviewed, leave a comment, or request a call on that page.");
  if (format !== "phone") lines.push("", "Thank you,", "Bram");
  return { subject: `Accountability report: ${period}`, body: lines.join("\n") };
}

/** The partner's current private link (decrypted), if one is active. */
export async function activeLinkFor(ctx: Pick<Ctx, "sb">, partnerId: string): Promise<string | null> {
  const { data } = await ctx.sb.from("partner_links").select("*").eq("partner_id", partnerId).is("revoked_at", null).order("created_at", { ascending: false });
  const now = new Date().toISOString();
  const link = ((data ?? []) as Row[]).find((l) => !l.expires_at || l.expires_at > now);
  if (!link?.token_encrypted) return null;
  try {
    return `${env.appUrl}/report/${decrypt(link.token_encrypted)}`;
  } catch {
    return null;
  }
}

export async function alertPartnerResponse(ctx: Pick<Ctx, "sb" | "ownerId">, report: Row, partnerName: string, what: string) {
  await createAlert(ctx, {
    kind: "partner",
    severity: what === "call" ? "warning" : "info",
    message: what === "call" ? `Accountability partner ${partnerName} requested a call.` : what === "comment" ? `Accountability partner ${partnerName} left a comment.` : `Accountability partner ${partnerName} reviewed a report.`,
    href: `/records/partner_reports/${report.id}`,
    related_type: "partner_reports",
    related_id: report.id,
    dedupe_key: `partner:${report.id}:${what}`,
  });
}
