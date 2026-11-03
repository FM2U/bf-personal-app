import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Notice, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { ConfirmSubmit, SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { loadSampleData, removeSampleData } from "@/app/actions/data-tools";
import { countRealRecords, countSampleRecords } from "@/lib/sample-server";

export const metadata = { title: "Sample data" };

const SAMPLE_LABELS: Record<string, string> = {
  organizations: "Organizations",
  contacts: "Contacts",
  pipeline_items: "Listings, deals, jobs, clients",
  deal_financials: "Deal figures",
  consulting_details: "Consulting details",
  partner_reports: "Sent reports",
  communications: "Emails and calls",
  notes: "Notes",
  todos: "To-dos",
  projects: "Rosara projects",
  work_events: "Done marks",
  end_of_day: "End of day days",
};

/** Settings, Sample data: load realistic sample records to test the app, and remove them again. */
export default async function SampleDataPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const [sample, real] = await Promise.all([countSampleRecords(supabase), countRealRecords(supabase)]);
  return (
    <div>
      <PageHeader title="Sample data" description="Load realistic sample records to test the app, then remove them before entering your real records." />
      {sp.notice ? (
        <div className="mb-4">
          <Notice tone={/not |failed|first|already|missing/i.test(sp.notice) ? "warn" : "success"}>{sp.notice}</Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card id="sample-load">
          <CardHeader>
            <CardTitle>Load sample data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-slate-700">
              <li>Listings to screen, deals in every stage, passed listings over several weeks</li>
              <li>Brokers, lenders and network contacts with calls, emails and follow-ups</li>
              <li>Rosara projects, job opportunities, consulting clients, to-dos</li>
              <li>An accountability partner with End of day days and sent reports</li>
            </ul>
            {real.total && !sample.total ? <Notice tone="warn">You already have {real.total} real records. Sample rows are marked, so Remove sample data deletes only them.</Notice> : null}
            {sample.total ? (
              <p className="text-sm text-slate-700" data-testid="sample-loaded">
                Sample data is loaded ({sample.total} records).
              </p>
            ) : (
              <GuardedForm action={loadSampleData} className="flex flex-col gap-3" data-unsaved="off">
                {real.total ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirm_real" className="mt-0.5 h-4 w-4 accent-primary" data-testid="sample-confirm-real" required />
                    Load sample data next to my real records
                  </label>
                ) : null}
                <SubmitButton pendingText="Loading sample data..." data-testid="sample-load">
                  Load sample data
                </SubmitButton>
              </GuardedForm>
            )}
          </CardContent>
          <CardNote>Emails end in example.com. Nothing is sent.</CardNote>
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
              <ConfirmSubmit variant="outline" disabled={!sample.total} message="Remove all sample data? Your real records are not changed." data-testid="sample-remove">
                Remove sample data
              </ConfirmSubmit>
            </GuardedForm>
          </CardContent>
          <CardNote>Deletes only sample rows and the notes, tasks and files made with them.</CardNote>
        </Card>
      </div>
    </div>
  );
}
