/**
 * Field labels and help text that depend on the pipeline kind (data-driven, one table for every pipeline).
 * Used by the pipeline item form and the item page. A pipeline added in Settings uses its kind's labels.
 */

export type FieldText = { label?: string; help?: string; placeholder?: string };

/** "Organization" on a pipeline item, per pipeline kind. */
export const ORGANIZATION_LABEL: Record<string, string> = {
  acquisition: "Company being acquired",
  job: "Employer",
  cofounder: "Current company",
  investor: "Investor firm",
  other: "Organization",
  consulting: "Client",
};

export const SOURCE_FIELD_TEXT: Record<string, Record<string, FieldText>> = {
  acquisition: {
    source_contact_id: {
      label: "Deal came from",
      help: 'Who handed you this deal: the broker, the owner, or a friend who knows the owner. For a listing or a campaign, choose "Not a person".',
    },
    source: { placeholder: "Examples: BizBuySell listing, Cold email campaign" },
    introduced_by_contact_id: {
      label: "Introduced by",
      help: "The person in your network who started the chain, for example the friend who introduced you to the broker.",
    },
    source_notes: { label: "Source notes", help: "Middle steps in the chain, for example a friend's colleague." },
  },
  consulting: {
    source_contact_id: {
      label: "Lead came from",
      help: 'Who handed you this lead: the client, or the person who referred you. For a posting or a campaign, choose "Not a person".',
    },
    source: { placeholder: "Examples: LinkedIn post, Cold email campaign" },
    introduced_by_contact_id: {
      label: "Introduced by",
      help: "The person in your network who started the chain, for example the friend who introduced you to the referrer.",
    },
  },
};

/** pipeline_items fields shown only for some pipeline kinds. */
export const KIND_ONLY_FIELDS: Record<string, string[]> = {
  deal_source_type: ["acquisition"],
  source_notes: ["acquisition"],
  source_contact_id: ["acquisition", "consulting"],
  introduced_by_contact_id: ["acquisition", "consulting"],
};

/** Fields to leave out of a pipeline item form for this pipeline kind. */
export function hiddenForKind(kind: string | null | undefined): string[] {
  return Object.entries(KIND_ONLY_FIELDS)
    .filter(([, kinds]) => !kinds.includes(String(kind ?? "")))
    .map(([field]) => field);
}

/** Label and help overrides for a pipeline item of this kind (empty for an unknown kind). */
export function fieldTextForKind(kind: string | null | undefined): Record<string, FieldText> {
  const k = String(kind ?? "");
  const out: Record<string, FieldText> = { ...(SOURCE_FIELD_TEXT[k] ?? {}) };
  if (ORGANIZATION_LABEL[k]) out.organization_id = { label: ORGANIZATION_LABEL[k] };
  return out;
}
