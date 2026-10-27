import Link from "next/link";
import { dueClass } from "@/components/ui/badge";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { sourceRank } from "@/lib/calc/pipeline";
import { loadPipelineStatus } from "@/lib/pipeline";
import { DealSourceBadge, ItemStatusBadges } from "@/components/app/pipeline-badges";

export const metadata = { title: "Pipeline next actions" };

export default async function PipelineActionsPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: items }, { data: pipes }, { data: stages }] = await Promise.all([
    supabase.from("pipeline_items").select("*").eq("status", "open").order("next_action_due", { ascending: true, nullsFirst: true }),
    supabase.from("pipelines").select("id,name"),
    supabase.from("pipeline_stages").select("id,name"),
  ]);
  const pn = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [p.id, p.name]));
  const sn = Object.fromEntries(((stages ?? []) as Row[]).map((p) => [p.id, p.name]));
  // Items without a next action first, then by due date; at the same date proprietary deals come before brokered ones.
  const list = ((items ?? []) as Row[]).sort((a, b) => {
    const ad = a.next_action_due ?? "";
    const bd = b.next_action_due ?? "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return sourceRank(a.deal_source_type) - sourceRank(b.deal_source_type);
  });
  const status = await loadPipelineStatus(supabase, list, { ownerId, tz: ctx.tz, today: ctx.today });
  return (
    <div>
      <PageHeader title="Pipeline next actions" description="Every open pipeline item's next action. Each one also appears in the task list on its due date. Items without a next action are listed first." />
      <Card>
        <CardContent className="pt-5">
          {list.length ? (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Due</TH>
                  <TH>Next action</TH>
                  <TH>Item</TH>
                  <TH>Pipeline</TH>
                  <TH>Stage</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {list.map((i) => (
                  <TR key={i.id}>
                    <TD className={`whitespace-nowrap ${dueClass(i.next_action_due, ctx.today)}`}>{i.next_action_due ? fmtDate(i.next_action_due) : "Not set"}</TD>
                    <TD className={i.next_action ? "" : "text-status-soon"}>{i.next_action ?? "Set the next action"}</TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/records/pipeline_items/${i.id}`} className="font-medium hover:underline">
                          {i.name}
                        </Link>
                        <DealSourceBadge type={i.deal_source_type} />
                      </span>
                    </TD>
                    <TD>{pn[i.pipeline_id]}</TD>
                    <TD>{sn[i.stage_id]}</TD>
                    <TD>
                      <ItemStatusBadges status={status.byItem[i.id]} itemStatus={i.status} fallback />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No open pipeline items." body="Add items in Opportunities." action={<Link href="/opportunities" className="text-sm text-primary-strong underline">Open Opportunities</Link>} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
