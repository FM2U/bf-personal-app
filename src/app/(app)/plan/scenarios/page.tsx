import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { createScenario } from "@/app/actions/domain";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Scenarios" };

export default async function ScenariosPage() {
  const { supabase } = await requireOwner();
  const [{ data }, { data: changes }] = await Promise.all([supabase.from("scenarios").select("*").order("created_at", { ascending: false }), supabase.from("scenario_input_changes").select("scenario_id")]);
  const rows = (data ?? []) as Row[];
  const counts: Record<string, number> = {};
  for (const c of (changes ?? []) as Row[]) counts[c.scenario_id] = (counts[c.scenario_id] ?? 0) + 1;
  return (
    <div>
      <PageHeader title="Scenarios" description="Copy the current numbers, change any input (income, an expense, loan term, interest rate, job salary, retirement age), and compare results side by side." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Saved scenarios</CardTitle>
            <CardDescription>Select two or more and press Compare to see them side by side with the current numbers.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <form action="/plan/scenarios/compare" method="get" className="flex flex-col gap-3">
                <ul className="flex flex-col divide-y divide-slate-100">
                  {rows.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2">
                      <input type="checkbox" name="ids" value={s.id} className="h-4 w-4 accent-teal-700" aria-label={`Compare ${s.name}`} />
                      <Link href={`/plan/scenarios/${s.id}`} className="min-w-0 flex-1 hover:underline">
                        <span className="clamp-1 text-sm font-medium">{s.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {s.kind === "job_vs_acquisition" ? "Job vs acquisition" : "General"} . {counts[s.id] ?? 0} numbers changed . {s.horizon_months} months . created {dateTime(s.created_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Button type="submit" size="sm" variant="outline" className="self-start">
                  Compare selected
                </Button>
              </form>
            ) : (
              <EmptyState title="No scenarios yet." body="Create a scenario with the form. It starts as a copy of the current numbers." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New scenario</CardTitle>
          </CardHeader>
          <CardContent>
            <GuardedForm action={createScenario} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Name
                <Input name="name" required placeholder="Example: Cut dining by half" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Kind
                <NativeSelect name="kind" defaultValue="general">
                  <option value="general">General</option>
                  <option value="job_vs_acquisition">Job vs acquisition</option>
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Months projected
                <Input name="horizon_months" type="number" defaultValue={60} min={1} max={480} />
              </label>
              <SubmitButton>Create scenario</SubmitButton>
            </GuardedForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
