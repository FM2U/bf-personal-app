import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { ReportTemplatesEditor } from "@/components/app/report-templates-editor";
import { loadReportTemplates } from "@/lib/report-templates";
import { DB_UPDATE_FILE_0017 } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

export const metadata = { title: "Report templates" };

export default async function ReportTemplatesPage() {
  const { supabase, ownerId } = await requireOwner();
  const { available, templates } = await loadReportTemplates(supabase, ownerId);
  // partners.report_template_id exists after database update 0017 and report_frequency after 0018; before them,
  // every partner uses Standard and Weekly.
  const all = await supabase.from("partners").select("id,name,report_template_id,report_frequency").order("name");
  const withTemplate = all.error ? await supabase.from("partners").select("id,name,report_template_id").order("name") : all;
  const data: Row[] | null = withTemplate.error ? ((await supabase.from("partners").select("id,name").order("name")).data as Row[] | null) : (withTemplate.data as Row[] | null);
  const frequencyEditable = !all.error;
  const partners = ((data ?? []) as Row[]).map((p) => ({ id: String(p.id), name: String(p.name), templateId: (p.report_template_id as string | null | undefined) ?? null, frequency: String(p.report_frequency ?? "weekly") }));
  return (
    <div>
      <PageHeader
        title="Report templates"
        description="Choose which measures each partner report shows, from high-level totals (commitments met and missed, tasks, deals sourced) to each daily target and pipeline. When you send a report you can change the template or send two templates in one email."
      />
      {!available ? (
        <div className="mb-4">
          <DbUpdateNotice file={DB_UPDATE_FILE_0017} features="Adding, editing, and deleting templates, and a default template for each partner, appear after the update. Until then every report uses the starter templates below (Standard by default)." />
        </div>
      ) : null}
      <ReportTemplatesEditor templates={templates} partners={partners} editable={available} frequencyEditable={frequencyEditable} />
    </div>
  );
}
