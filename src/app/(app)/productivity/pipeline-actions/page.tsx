import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

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
  const list = (items ?? []) as Row[];
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
                </TR>
              </THead>
              <TBody>
                {list.map((i) => (
                  <TR key={i.id}>
                    <TD className={`whitespace-nowrap ${i.next_action_due && i.next_action_due < ctx.today ? "font-medium text-red-700" : ""}`}>{i.next_action_due ? fmtDate(i.next_action_due) : "Not set"}</TD>
                    <TD className={i.next_action ? "" : "text-amber-700"}>{i.next_action ?? "Set the next action"}</TD>
                    <TD>
                      <Link href={`/records/pipeline_items/${i.id}`} className="font-medium hover:underline">
                        {i.name}
                      </Link>
                    </TD>
                    <TD>{pn[i.pipeline_id]}</TD>
                    <TD>{sn[i.stage_id]}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No open pipeline items." body="Add items in Opportunities." action={<Link href="/opportunities" className="text-sm text-teal-800 underline">Open Opportunities</Link>} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
