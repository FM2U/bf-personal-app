import { buildWorkSample, type WorkSample, type WorkSampleSetup } from "@/lib/work/sample";

/**
 * Sample data for testing the final app before real data (2026-11-02): the Work module's listings, deals, people,
 * projects, opportunities, consulting, to-dos, End of day rows and sent reports, and (push C) two calendar blocks (src/lib/work/sample.ts). Every row is
 * listed in sample_records, so Remove sample data deletes only these.
 */

/** One insert into one table (inserted in order by the insert_record_batch database function). */
type Batch = { table: string; op?: "insert" | "update"; rows: Record<string, unknown>[] };

/** Tables sample data writes to, in insert order. Removal deletes in the reverse dependency order (SQL). */
export const SAMPLE_TABLES = [
  "organizations", "contacts", "pipeline_items", "deal_financials", "consulting_details", "partner_reports",
  "communications", "notes", "deal_todos", "projects", "work_events", "end_of_day", "time_blocks", "monthly_reviews", "waits",
] as const;

type Follow = Pick<WorkSample, "stageDates" | "documents" | "todos" | "noteDates" | "noActionItems">;

export function buildSampleData(setup: WorkSampleSetup, newId: () => string, today: string): { batches: Batch[]; counts: Record<string, number>; work: Follow } {
  const w = buildWorkSample(setup, newId, today);
  const batches: Batch[] = [
    { table: "organizations", rows: w.organizations },
    { table: "contacts", rows: w.contacts },
    { table: "pipeline_items", rows: w.items },
    { table: "deal_financials", rows: w.financials },
    { table: "consulting_details", rows: w.consultingDetails },
    { table: "partner_reports", rows: w.partnerReports },
    { table: "communications", rows: w.communications },
    { table: "notes", rows: w.notes },
    // Push C: the personal to-dos are rows of deal_todos with no record (one is linked to a deal).
    { table: "deal_todos", rows: w.personalTodos },
    { table: "projects", rows: w.projects },
    { table: "work_events", rows: w.workEvents },
    { table: "end_of_day", rows: w.endOfDay },
    { table: "time_blocks", rows: w.timeBlocks },
    // Push D: two monthly reviews (one finished, one to do).
    { table: "monthly_reviews", rows: w.monthlyReviews },
    // Push E2: the waits, after the deals, people, and emails they point to.
    { table: "waits", rows: w.waits },
  ].filter((b) => b.rows.length);
  const counts = Object.fromEntries(batches.map((b) => [b.table, b.rows.length]));
  return { batches, counts, work: { stageDates: w.stageDates, documents: w.documents, todos: w.todos, noteDates: w.noteDates, noActionItems: w.noActionItems } };
}
