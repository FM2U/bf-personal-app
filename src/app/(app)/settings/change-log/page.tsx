import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { getResource, recordHref, RESOURCES } from "@/lib/resources";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Change log" };

export default async function ChangeLogPage({ searchParams }: { searchParams: Promise<{ table?: string; actor?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  let q = supabase.from("change_log").select("*").order("created_at", { ascending: false }).limit(300);
  if (sp.table) q = q.eq("table_name", sp.table);
  if (sp.actor) q = q.eq("actor", sp.actor);
  const { data } = await q;
  const show = (v: unknown) => (v === null || v === undefined ? "empty" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));
  return (
    <div>
      <PageHeader title="Change log" description="Every change: what changed, old value, new value, date, and whether you, the AI (approved by you), or a scheduled job made it." />
      <Card>
        <CardHeader>
          <form method="get" className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <NativeSelect name="table" defaultValue={sp.table ?? ""} aria-label="Record type">
              <option value="">All record types</option>
              {Object.values(RESOURCES).map((r) => (
                <option key={r.table} value={r.table}>
                  {r.plural}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="actor" defaultValue={sp.actor ?? ""} aria-label="Changed by">
              <option value="">Anyone</option>
              <option value="owner">Owner</option>
              <option value="ai">AI (approved)</option>
              <option value="system">Scheduled job</option>
            </NativeSelect>
            <Button type="submit" variant="outline">
              Show
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>When</TH>
                <TH>Record</TH>
                <TH>Change</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {((data ?? []) as Row[]).map((c) => {
                const r = getResource(c.table_name);
                return (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap text-xs">{dateTime(c.created_at)}</TD>
                    <TD>
                      {c.record_id && r && c.action !== "delete" ? (
                        <Link href={recordHref(c.table_name, c.record_id)} className="hover:underline">
                          {r.singular}
                        </Link>
                      ) : (
                        r?.singular ?? (c.table_name === "partner_reports" ? "Partner report" : c.table_name)
                      )}
                    </TD>
                    <TD className="max-w-md text-sm">
                      {c.action === "update" ? (
                        <>
                          <span className="font-medium">{r?.fields.find((f) => f.name === c.field)?.label ?? c.field}</span>: {show(c.old_value)} to {show(c.new_value)}
                        </>
                      ) : c.field === "email_sent" ? (
                        <>
                          <span className="font-medium">Email sent from the app</span> to {show((c.new_value as Row | null)?.to)}: {show((c.new_value as Row | null)?.subject)}
                        </>
                      ) : c.action === "insert" ? (
                        "Created"
                      ) : (
                        "Deleted"
                      )}
                    </TD>
                    <TD>
                      <Badge variant={c.actor === "ai" ? "default" : "neutral"}>{c.actor === "ai" ? "AI (approved)" : c.actor === "system" ? "Scheduled job" : "Owner"}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
