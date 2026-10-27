import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Notice, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { ConfirmSubmit, SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { ResetFlow } from "@/components/app/reset-flow";
import { loadSampleData, removeSampleData } from "@/app/actions/data-tools";
import { countRealRecords, countSampleRecords } from "@/lib/sample-server";
import { hasUpdate0014 } from "@/lib/update-0014";
import { DB_UPDATE_FILE_0014 } from "@/lib/schema-guard";
import { EXPORT_COOKIE, exportIsRecent, RESET_KEEP_TABLES, RESET_RECREATED_DEFAULTS, RESET_TABLE_LABELS, resetSummaryRows } from "@/lib/reset";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Sample data and reset" };

const KEEP_LABELS: Record<string, string> = {
  owner_profile: "Owner profile",
  entities: "Personal and LLC entities",
  inputs: "Inputs and Assumptions",
  input_history: "Inputs history",
  change_log: "Change log",
  categories: "Categories",
  categorization_rules: "Category rules",
  import_layouts: "Saved CSV layouts",
  pipelines: "Pipelines",
  pipeline_stages: "Stages",
  stage_tasks: "Stage task lists",
  targets: "Targets (count from today)",
  task_templates: "Recurring tasks",
  google_connections: "Google connection",
  plaid_items: "Plaid connections",
  ai_usage: "AI usage (monthly cap)",
};

const SAMPLE_LABELS: Record<string, string> = { ...RESET_TABLE_LABELS };

export default async function SampleDataPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const available = await hasUpdate0014(supabase);
  const jar = await cookies();
  const exportValue = jar.get(EXPORT_COOKIE)?.value ?? null;
  const exportedAt = exportIsRecent(exportValue) ? decodeURIComponent(exportValue as string) : null;
  const [sample, real] = available ? await Promise.all([countSampleRecords(supabase), countRealRecords(supabase)]) : [{ total: 0, byTable: {} }, { total: 0, byTable: {} }];
  const { data: lastReset } = available
    ? await supabase.from("change_log").select("created_at,new_value").eq("field", "all_data_reset").order("created_at", { ascending: false }).limit(1)
    : { data: [] };
  const reset = ((lastReset ?? []) as Row[])[0] ?? null;
  const resetRows = reset ? resetSummaryRows(reset.new_value as Record<string, number>) : [];

  return (
    <div>
      <PageHeader title="Sample data and reset" description="Load clearly fake sample data to test the app, remove it again, and reset all data before entering your real records." />
      {!available ? (
        <div className="mb-4">
          <DbUpdateNotice file={DB_UPDATE_FILE_0014} features="Load sample data, Remove sample data, and Reset all data appear after the update." />
        </div>
      ) : null}
      {sp.notice ? (
        <div className="mb-4">
          <Notice tone={/not |failed|first|Type RESET|already/i.test(sp.notice) ? "warn" : "success"}>{sp.notice}</Notice>
        </div>
      ) : null}
      {sp.reset === "done" && reset ? (
        <div className="mb-4">
          <Notice tone="success">All data was reset on {dateTime(reset.created_at)}. Your setup was kept. {sp.files_failed ? `${sp.files_failed} document files could not be removed from storage.` : ""}</Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card id="sample-load">
          <CardHeader>
            <CardTitle>Load sample data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">
              <li>5 accounts: checking, savings, 2 cards, and 1 Cyan Arc LLC account</li>
              <li>12 months of transactions: rent, 3 storage units (about $1,000 a month), food (about $1,500 a month), phone, utilities, 5 software subscriptions (2 unused), consulting income</li>
              <li>Debts on both cards, 3 acquisition deals (proprietary and brokered), 1 consulting client, contacts, and an accountability partner</li>
            </ul>
            {real.total && !sample.total ? (
              <Notice tone="warn">
                You already have {real.total} real records. Sample rows are marked, so Remove sample data deletes only them.
              </Notice>
            ) : null}
            {sample.total ? (
              <p className="text-sm text-slate-700" data-testid="sample-loaded">Sample data is loaded ({sample.total} records).</p>
            ) : (
              <GuardedForm action={loadSampleData} className="flex flex-col gap-3" data-unsaved="off">
                {real.total ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirm_real" className="mt-0.5 h-4 w-4 accent-teal-700" data-testid="sample-confirm-real" required />
                    Load sample data next to my real records
                  </label>
                ) : null}
                <SubmitButton disabled={!available} pendingText="Loading sample data..." data-testid="sample-load">
                  Load sample data
                </SubmitButton>
              </GuardedForm>
            )}
          </CardContent>
          <CardNote>Every name starts with &quot;Sample&quot; and every email ends in example.com.</CardNote>
        </Card>

        <Card id="sample-remove">
          <CardHeader>
            <CardTitle>Remove sample data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <StatGrid className="grid-cols-2">
              <Stat label="Sample records" value={sample.total} />
              <Stat label="Your real records" value={real.total} />
            </StatGrid>
            {sample.total ? (
              <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {Object.entries(sample.byTable).map(([t, n]) => (
                  <li key={t} className="flex justify-between gap-2">
                    <span className="clamp-1">{SAMPLE_LABELS[t] ?? t}</span>
                    <span className="tabular">{n}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <GuardedForm action={removeSampleData} data-unsaved="off">
              <ConfirmSubmit variant="outline" disabled={!available || !sample.total} message="Remove all sample data? Your real records are not changed." data-testid="sample-remove">
                Remove sample data
              </ConfirmSubmit>
            </GuardedForm>
          </CardContent>
          <CardNote>Deletes only sample rows and the tasks, links, and recurring charges made from them.</CardNote>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reset keeps your setup</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
              {RESET_KEEP_TABLES.map((t) => (
                <li key={t} className="clamp-2">{KEEP_LABELS[t] ?? t}</li>
              ))}
              <li className="clamp-2">Default initiatives</li>
            </ul>
          </CardContent>
          <CardNote>Created again after a reset: {RESET_RECREATED_DEFAULTS.join("; ")}.</CardNote>
        </Card>

        <Card className="lg:col-span-2" id="reset">
          <CardHeader>
            <CardTitle>Reset all data</CardTitle>
          </CardHeader>
          <CardContent>
            <ResetFlow exportedAt={exportedAt} disabled={!available} />
          </CardContent>
          <CardNote>Deletes every record you created or imported: transactions, accounts, budgets, debts, funding, income, pipeline items, contacts, tasks, reviews, documents, notes, checklists, AI conversations, and initiatives you created. All or nothing.</CardNote>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Last reset</CardTitle>
          </CardHeader>
          <CardContent>
            {reset ? (
              <>
                <p className="mb-2 text-sm text-slate-700" data-testid="reset-summary">
                  {dateTime(reset.created_at)}: {resetRows.reduce((s, r) => s + r.count, 0)} records deleted.
                </p>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Records</TH>
                      <TH className="text-right">Deleted</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {resetRows.slice(0, 14).map((r) => (
                      <TR key={r.table}>
                        <TD className="text-sm">{r.label}</TD>
                        <TD className="tabular text-right text-sm">{r.count}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No reset yet.</p>
            )}
          </CardContent>
          <CardNote>The change log keeps one entry for each reset.</CardNote>
        </Card>
      </div>
    </div>
  );
}
