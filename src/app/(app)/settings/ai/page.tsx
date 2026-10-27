import { requireOwner } from "@/lib/auth";
import { aiBudget } from "@/lib/ai/claude";
import { env } from "@/lib/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { Progress } from "@/components/app/charts";
import { StatusBadge } from "@/components/app/field-value";
import { dateTime, money } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "AI usage and proposals" };

export default async function AiUsagePage() {
  const { supabase, ownerId } = await requireOwner();
  const [budget, { data: usage }, { data: proposals }] = await Promise.all([
    aiBudget(supabase, ownerId),
    supabase.from("ai_usage").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("ai_proposals").select("*").neq("status", "pending").order("decided_at", { ascending: false }).limit(50),
  ]);
  const rows = (usage ?? []) as Row[];
  const byMonth: Record<string, { cost: number; calls: number; tokens: number }> = {};
  const byPurpose: Record<string, { cost: number; calls: number }> = {};
  for (const u of rows) {
    const m = u.created_at.slice(0, 7);
    byMonth[m] ??= { cost: 0, calls: 0, tokens: 0 };
    byMonth[m].cost += Number(u.cost_usd);
    byMonth[m].calls++;
    byMonth[m].tokens += u.input_tokens + u.output_tokens;
    if (m === new Date().toISOString().slice(0, 7)) {
      byPurpose[u.purpose] ??= { cost: 0, calls: 0 };
      byPurpose[u.purpose].cost += Number(u.cost_usd);
      byPurpose[u.purpose].calls++;
    }
  }
  return (
    <div>
      <PageHeader title="AI usage and proposals" description={`Every AI call is recorded with tokens and cost. Prices used: $${env.aiInputPricePerMTok} per million input tokens and $${env.aiOutputPricePerMTok} per million output tokens (set in the server settings).`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>This month</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={budget.cap ? (budget.spent / budget.cap) * 100 : 0} tone={budget.blocked ? "red" : "primary"} />
            <StatGrid className="grid-cols-3">
              <Stat label="Spent" value={money(budget.spent, true)} />
              <Stat label="Cap" value={money(budget.cap, true)} />
              <Stat label="Remaining" value={money(budget.remaining, true)} />
            </StatGrid>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By purpose, this month</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(byPurpose).length ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {Object.entries(byPurpose).map(([p, v]) => (
                  <li key={p} className="flex justify-between gap-2">
                    <span>{p.replace(/_/g, " ")}</span>
                    <span className="tabular">
                      {v.calls} calls, {money(v.cost, true)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No AI calls this month.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By month</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(byMonth).length ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {Object.entries(byMonth).map(([m, v]) => (
                  <li key={m} className="flex justify-between gap-2">
                    <span>{m}</span>
                    <span className="tabular">
                      {v.calls} calls, {money(v.cost, true)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent AI calls</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Time</TH>
                  <TH>Purpose</TH>
                  <TH>Model</TH>
                  <TH className="text-right">Input tokens</TH>
                  <TH className="text-right">Output tokens</TH>
                  <TH className="text-right">Cost</TH>
                </TR>
              </THead>
              <TBody>
                {rows.slice(0, 50).map((u) => (
                  <TR key={u.id}>
                    <TD className="whitespace-nowrap">{dateTime(u.created_at)}</TD>
                    <TD>{u.purpose.replace(/_/g, " ")}</TD>
                    <TD className="text-xs">{u.model}</TD>
                    <TD className="tabular text-right">{u.input_tokens.toLocaleString()}</TD>
                    <TD className="tabular text-right">{u.output_tokens.toLocaleString()}</TD>
                    <TD className="tabular text-right">{money(u.cost_usd, true)}</TD>
                  </TR>
                ))}
                {!rows.length ? (
                  <TR>
                    <TD colSpan={6} className="text-muted-foreground">
                      No AI calls yet.
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Decided proposals</CardTitle>
            <CardDescription>Approved changes are saved with the actor &quot;AI (approved)&quot; in the change log.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Decided</TH>
                  <TH>Proposal</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {((proposals ?? []) as Row[]).map((p) => (
                  <TR key={p.id}>
                    <TD className="whitespace-nowrap">{dateTime(p.decided_at)}</TD>
                    <TD>{p.summary}</TD>
                    <TD>
                      <StatusBadge status={p.status} />
                    </TD>
                  </TR>
                ))}
                {!(proposals ?? []).length ? (
                  <TR>
                    <TD colSpan={3} className="text-muted-foreground">
                      No decided proposals yet.
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
