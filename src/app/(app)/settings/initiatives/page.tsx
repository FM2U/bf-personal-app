import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import type { Row } from "@/lib/types";

export const metadata = { title: "Initiatives and pipelines" };

export default async function InitiativesSettingsPage() {
  const { supabase } = await requireOwner();
  const { data: pipes } = await supabase.from("pipelines").select("id,name").order("sort_order");
  return (
    <div>
      <PageHeader title="Initiatives and pipelines" description="Add or edit initiatives, pipelines, and stages. A new pipeline needs no new code: choose its kind to get the matching extra fields (acquisition, job, investor)." />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ListCard sb={supabase} table="initiatives" columns={["name", "sort_order", "is_active"]} />
          <ListCard sb={supabase} table="pipelines" columns={["name", "initiative_id", "kind", "is_active"]} />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {((pipes ?? []) as Row[]).map((p) => (
            <ListCard key={p.id} sb={supabase} table="pipeline_stages" title={`${p.name}: stages`} filters={[["pipeline_id", "eq", p.id]]} prefill={{ pipeline_id: p.id }} columns={["name", "position", "outcome"]} />
          ))}
        </div>
      </div>
    </div>
  );
}
