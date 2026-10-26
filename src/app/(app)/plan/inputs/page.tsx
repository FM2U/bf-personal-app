import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { updateInput } from "@/app/actions/domain";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Inputs and Assumptions" };

const UNIT_LABEL: Record<string, string> = { usd: "$", months: "months", percent: "%", years: "years", number: "", date: "date", boolean: "1 or 0", text: "text" };

export default async function InputsPage() {
  const { supabase } = await requireOwner();
  const { data } = await supabase.from("inputs").select("*").order("sort_order");
  const rows = (data ?? []) as Row[];
  const groups: Record<string, Row[]> = {};
  for (const r of rows) (groups[r.category] ??= []).push(r);
  return (
    <div>
      <PageHeader
        title="Inputs and Assumptions"
        description="Every changeable number in one list. Every calculation reads these values. Each change is saved with its old value."
        actions={
          <Button asChild size="sm">
            <Link href="/records/inputs/new">Add input</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Object.entries(groups).map(([group, list]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{group}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-slate-100">
              {list.map((i) => {
                const isText = i.unit === "text" || i.unit === "date";
                return (
                  <form key={i.id} action={updateInput} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
                    <input type="hidden" name="id" value={i.id} />
                    <div className="min-w-0">
                      <Link href={`/records/inputs/${i.id}`} className="clamp-2 text-sm font-medium hover:underline">
                        {i.label}
                      </Link>
                      <p className="clamp-2 text-xs text-muted-foreground">{i.description ?? ""}</p>
                      <p className="text-[11px] text-slate-400">Updated {dateTime(i.updated_at)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        name="value"
                        type={i.unit === "date" ? "date" : isText ? "text" : "number"}
                        step="any"
                        defaultValue={isText ? i.value_text ?? "" : i.value_number ?? ""}
                        placeholder="Not set"
                        aria-label={i.label}
                      />
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{UNIT_LABEL[i.unit]}</span>
                    </div>
                    <SubmitButton size="sm" variant="outline">
                      Save
                    </SubmitButton>
                  </form>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
