import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { FieldValue } from "@/components/app/field-value";
import { checkConditionsNow } from "@/app/actions/domain";
import { metricLabel } from "@/lib/metrics-list";
import { OPERATOR_LABELS, type Operator } from "@/lib/calc/conditions";
import { getResource } from "@/lib/resources";
import { date as fmtDate, dateTime, num } from "@/lib/format";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Decision Conditions" };

export default async function ConditionsPage() {
  const { supabase } = await requireOwner();
  const { data } = await supabase.from("decision_conditions").select("*").order("created_at");
  const rows = (data ?? []) as Row[];
  const actionsField = getResource("decision_conditions")!.fields.find((f) => f.name === "actions");
  return (
    <div>
      <PageHeader
        title="Decision Conditions"
        description="A rule the app checks every day and after every data change: measured number + comparison + threshold + required action. Actions run once when the rule becomes true."
        actions={
          <>
            <GuardedForm action={checkConditionsNow}>
              <SubmitButton size="sm" variant="outline" pendingText="Checking...">
                Check all now
              </SubmitButton>
            </GuardedForm>
            <Button asChild size="sm">
              <Link href="/records/decision_conditions/new">Add condition</Link>
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="pt-5">
          {rows.length ? (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Rule</TH>
                  <TH>Current value</TH>
                  <TH>Status</TH>
                  <TH>Required actions</TH>
                  <TH>Last checked</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id}>
                    <TD className="max-w-xs">
                      <Link href={`/records/decision_conditions/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="clamp-2 text-xs text-muted-foreground">
                        If {metricLabel(c.metric_key).toLowerCase()} {OPERATOR_LABELS[c.operator as Operator]} {num(c.threshold, 2)}
                        {c.check_from ? `, checked from ${fmtDate(c.check_from)}` : ""}
                      </p>
                    </TD>
                    <TD className="tabular">{c.last_value === null || c.last_value === undefined ? "Not available" : Number(c.last_value) >= 9999 ? "Not decreasing" : num(c.last_value, 2)}</TD>
                    <TD>{!c.is_active ? <Badge variant="neutral">Inactive</Badge> : c.currently_met ? <Badge variant="danger">Met</Badge> : <Badge variant="success">Not met</Badge>}</TD>
                    <TD className="max-w-sm text-xs">
                      <FieldValue field={actionsField} value={c.actions} />
                    </TD>
                    <TD className="text-xs text-muted-foreground">{c.last_evaluated_at ? dateTime(c.last_evaluated_at) : "Not yet"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState
              title="No decision conditions yet."
              body='Example: "If runway is under 6 months, create the task Start active job search and add an alert to Home."'
              action={<Button asChild size="sm"><Link href="/records/decision_conditions/new">Add condition</Link></Button>}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
