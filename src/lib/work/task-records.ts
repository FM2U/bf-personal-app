/**
 * The record a task belongs to (push C, merge approved 2026-11-03): a personal to-do linked to a record is one of that
 * record's tasks, so both are rows of deal_todos and a task carries its record (or none). The kinds of record a task
 * can sit on, how each is named on the gray record pill ("Deal · Summit Logistics Group"), the page it opens, and
 * the record_type stored with the task. Pure and tested in src/lib/work/tasks.test.ts.
 */

export type RecordKind = "deal" | "listing" | "person" | "organization" | "project" | "job" | "consulting";

/** The table a task's record_type names. */
export type RecordTable = "pipeline_items" | "contacts" | "organizations" | "projects";

export type TaskRecord = { kind: RecordKind; id: string; name: string; /** Passed, lost, archived, or closed. */ closed: boolean };

/** The word before the name on the record pill. */
export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  deal: "Deal",
  listing: "Listing",
  person: "Person",
  organization: "Organization",
  project: "Rosara",
  job: "Job",
  consulting: "Consulting",
};

export function recordTable(kind: RecordKind): RecordTable {
  if (kind === "person") return "contacts";
  if (kind === "organization") return "organizations";
  if (kind === "project") return "projects";
  return "pipeline_items";
}

export function recordHref(r: Pick<TaskRecord, "kind" | "id">): string {
  switch (r.kind) {
    case "person":
      return `/work/people/${r.id}`;
    case "organization":
      return `/work/people/organizations/${r.id}`;
    case "project":
      return `/work/rosara/${r.id}`;
    case "job":
      return `/work/jobs/${r.id}`;
    case "consulting":
      return `/work/consulting/${r.id}`;
    default:
      return `/work/deals/${r.id}`;
  }
}

/** "Deal · Summit Logistics Group". */
export function recordPillText(r: Pick<TaskRecord, "kind" | "name">): string {
  return `${RECORD_KIND_LABEL[r.kind]} · ${r.name}`;
}

/** The kind of a pipeline item from its pipeline and whether it was screened (a listing still to screen is a listing). */
export function pipelineItemKind(pipelineKind: string | null | undefined, screened: boolean | null | undefined): RecordKind {
  if (pipelineKind === "job") return "job";
  if (pipelineKind === "consulting") return "consulting";
  return screened === false ? "listing" : "deal";
}

/** A record kind from the value a page or the picker sends ("deal", "person", ...), or null. */
export function parseRecordKind(v: unknown): RecordKind | null {
  return typeof v === "string" && (["deal", "listing", "person", "organization", "project", "job", "consulting"] as string[]).includes(v) ? (v as RecordKind) : null;
}
