import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, Plus, RotateCcw, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { AiText } from "@/components/app/ai-text";
import { addChecklistItem, deleteChecklistItem, toggleChecklistItem, uncheckAllItems } from "@/app/actions/checklists";
import { checklistProgress } from "@/lib/checklists";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Checklists for an initiative (initiative page) or for a recurring task (task pages). Nothing before update 0014. */
export async function loadChecklists(sb: SupabaseClient, by: { initiativeId?: string; templateId?: string }): Promise<{ lists: Row[]; items: Row[]; templates: Record<string, Row> } | null> {
  let q = sb.from("checklists").select("*").order("sort_order");
  if (by.initiativeId) q = q.eq("initiative_id", by.initiativeId);
  else if (by.templateId) q = q.eq("task_template_id", by.templateId);
  else return null;
  const { data, error } = await q;
  if (error) return null;
  const lists = (data ?? []) as Row[];
  if (!lists.length) return { lists, items: [], templates: {} };
  const ids = lists.map((l) => l.id);
  const tIds = [...new Set(lists.map((l) => l.task_template_id).filter(Boolean))];
  const [{ data: items }, { data: templates }] = await Promise.all([
    sb.from("checklist_items").select("*").in("checklist_id", ids).order("sort_order"),
    tIds.length ? sb.from("task_templates").select("id,title,cadence,weekday").in("id", tIds) : Promise.resolve({ data: [] }),
  ]);
  return { lists, items: (items ?? []) as Row[], templates: Object.fromEntries(((templates ?? []) as Row[]).map((t) => [t.id, t])) };
}

/** One checklist card: items with a check button, quantity and notes, Uncheck all, and an add-item row. */
export function ChecklistCard({ list, items, template, compact = false }: { list: Row; items: Row[]; template?: Row | null; compact?: boolean }) {
  const prog = checklistProgress(items as { checked: boolean }[]);
  const when = template ? `${template.title}${template.cadence === "weekly" && template.weekday !== null ? ` (${WEEKDAYS[Number(template.weekday)]})` : ""}` : null;
  return (
    <Card data-testid="checklist-card">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="clamp-2">
            <Link href={`/records/checklists/${list.id}`} className="hover:underline">
              {list.name}
            </Link>
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="checklist-progress">{prog.text}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {list.reset_weekly ? <Badge variant="default">Resets each week</Badge> : null}
          {prog.done ? (
            <GuardedForm action={uncheckAllItems}>
              <input type="hidden" name="checklist_id" value={list.id} />
              <SubmitButton size="sm" variant="ghost" className="h-7 px-2 text-xs" pendingText="Unchecking...">
                <RotateCcw /> Uncheck all
              </SubmitButton>
            </GuardedForm>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length ? (
          <ul className={cn("flex flex-col divide-y divide-slate-100", compact && "max-h-80 overflow-y-auto")}>
            {items.map((it) => (
              <li key={it.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 py-1.5">
                <GuardedForm action={toggleChecklistItem}>
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="checked" value={it.checked ? "false" : "true"} />
                  <button
                    type="submit"
                    aria-label={`${it.checked ? "Uncheck" : "Check"} ${it.text}`}
                    aria-pressed={!!it.checked}
                    data-testid="checklist-item-toggle"
                    className={cn("inline-flex h-6 w-6 items-center justify-center rounded border", it.checked ? "border-status-met bg-status-met text-white" : "border-slate-300 bg-white hover:border-primary")}
                  >
                    {it.checked ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                </GuardedForm>
                <span className="min-w-0">
                  <span className={cn("clamp-1 text-sm", it.checked && "text-muted-foreground line-through")}>{it.text}</span>
                  {it.notes ? <span className="clamp-1 text-xs text-muted-foreground">{it.notes}</span> : null}
                </span>
                <span className="flex items-center gap-1">
                  {it.quantity ? <span className="tabular whitespace-nowrap text-xs text-slate-600">{it.quantity}</span> : null}
                  {!compact ? (
                    <GuardedForm action={deleteChecklistItem}>
                      <input type="hidden" name="id" value={it.id} />
                      <button type="submit" className="rounded p-1 text-muted-foreground hover:bg-slate-100" aria-label={`Remove ${it.text}`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </GuardedForm>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No items yet.</p>
        )}
        {!compact ? (
          <GuardedForm action={addChecklistItem} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-2">
            <input type="hidden" name="checklist_id" value={list.id} />
            <Input name="text" placeholder="Add an item" aria-label="New item" maxLength={160} />
            <Input name="quantity" placeholder="Quantity" aria-label="Quantity" maxLength={40} />
            <SubmitButton size="icon" variant="outline" aria-label="Add item" pendingText="...">
              <Plus />
            </SubmitButton>
          </GuardedForm>
        ) : null}
      </CardContent>
      <CardNote>
        {list.reset_weekly && when ? `Every item is unchecked when "${when}" is created${list.last_reset_on ? `; last reset ${fmtDate(list.last_reset_on)}` : ""}.` : when ? `Goes with the recurring task "${when}".` : "A named list of items. Check items off as you go."}
      </CardNote>
    </Card>
  );
}

/** Plan documents for an initiative (bulleted text shown with the safe AI text renderer). */
export function PlanDocumentCard({ doc }: { doc: Row }) {
  return (
    <Card data-testid="plan-document">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <CardTitle className="clamp-2">{doc.title}</CardTitle>
        <Link href={`/records/plan_documents/${doc.id}?edit=1`} className="shrink-0 text-sm text-primary-strong hover:underline">
          Edit
        </Link>
      </CardHeader>
      <CardContent>
        <AiText text={doc.body} />
      </CardContent>
      <CardNote>The written plan for this initiative. Updated {fmtDate(String(doc.updated_at).slice(0, 10))}.</CardNote>
    </Card>
  );
}
