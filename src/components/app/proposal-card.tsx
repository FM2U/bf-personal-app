import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { approveProposal, rejectProposal } from "@/app/actions/ai";
import { getResource } from "@/lib/resources";
import { dateTime, money } from "@/lib/format";
import type { Row } from "@/lib/types";
import { AiText } from "@/components/app/ai-text";
import { GuardedForm } from "@/components/app/unsaved-changes";

/** One AI proposal. Nothing is saved until "Approve" is pressed. */
export function ProposalCard({ p, back, labels }: { p: Row; back: string; labels?: Record<string, Record<string, string>> }) {
  const r = getResource(p.table_name);
  const isReduction = p.table_name === "reduction_actions";
  const isCategory = p.source === "category_suggestion";
  const fields = Object.entries(p.payload ?? {}).filter(([k]) => !["suggestions", "category_source", "owner_id"].includes(k));
  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border border-border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="clamp-2 text-sm font-medium text-slate-900">{p.summary}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.action === "create" ? "Create" : "Change"} {r?.singular.toLowerCase() ?? p.table_name} . {dateTime(p.created_at)}
          </p>
        </div>
        <Badge variant={p.status === "pending" ? "warning" : p.status === "approved" ? "success" : "neutral"}>{p.status}</Badge>
      </div>
      {p.reason ? <AiText text={p.reason} className="text-slate-600" /> : null}
      {!isReduction && !isCategory && fields.length ? (
        <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1 text-xs">
          {fields.slice(0, 8).map(([k, v]) => {
            const f = r?.fields.find((x) => x.name === k);
            const shown = f?.type === "ref" && labels?.[f.ref!]?.[String(v)] ? labels[f.ref!][String(v)] : f?.type === "money" ? money(v as number, true) : typeof v === "object" ? JSON.stringify(v) : String(v);
            return (
              <div key={k} className="contents">
                <dt className="clamp-1 text-muted-foreground">{f?.label ?? k}</dt>
                <dd className="clamp-1 text-slate-800">{shown}</dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {p.status === "pending" ? (
        <div className="mt-auto flex flex-col gap-2">
          <GuardedForm action={approveProposal} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="back" value={back} />
            {isReduction ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <span className="clamp-1">Deadline</span>
                  <Input type="date" name="o_deadline" defaultValue={p.payload?.deadline ?? ""} required />
                </label>
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <span className="clamp-1">Projected monthly savings</span>
                  <Input type="number" step="any" name="o_projected_monthly_savings" defaultValue={p.payload?.projected_monthly_savings ?? 0} required />
                </label>
              </div>
            ) : null}
            {isCategory ? (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="save_rule" className="h-4 w-4 accent-primary" /> Also save as a rule for this merchant
              </label>
            ) : null}
            <SubmitButton size="sm" pendingText="Saving...">
              {isReduction ? "Choose this one and approve" : "Approve"}
            </SubmitButton>
          </GuardedForm>
          <GuardedForm action={rejectProposal}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="back" value={back} />
            <SubmitButton size="sm" variant="outline" className="w-full" pendingText="Rejecting...">
              Reject
            </SubmitButton>
          </GuardedForm>
        </div>
      ) : p.error ? (
        <p className="text-xs text-status-missed">{p.error}</p>
      ) : null}
    </div>
  );
}
