"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/app/page-header";
import { PanelClose } from "@/components/app/outreach-actions";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { deleteReportTemplate, saveReportTemplate, setPartnerTemplate } from "@/app/actions/report-templates";
import { MEASURES, NOTE_MAX, PERIOD_LABEL, TEMPLATE_PERIODS, type MeasureKey, type ReportTemplate, type TemplatePeriod } from "@/lib/calc/partner-report";
import { cn } from "@/lib/utils";

type Draft = { id: string | null; name: string; measures: MeasureKey[]; period: TemplatePeriod; note: string };

const EMPTY: Draft = { id: null, name: "", measures: [], period: "week", note: "" };
const LEVELS: { key: "high" | "detailed"; title: string; hint: string }[] = [
  { key: "high", title: "High-level", hint: "Totals for the period" },
  { key: "detailed", title: "Detailed", hint: "Each daily target and pipeline" },
];
const label = (k: string) => MEASURES.find((m) => m.key === k)?.label ?? k;

/**
 * Accountability, Report templates: the list of templates (Summary, Standard, Detailed, and any added), the editor
 * (name, period, note, and the measures in two groups), and each partner's default template.
 */
export function ReportTemplatesEditor({ templates, partners, editable }: { templates: ReportTemplate[]; partners: { id: string; name: string; templateId: string | null }[]; editable: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const dirty = !!draft && JSON.stringify(draft) !== initial;
  useUnsavedWork(dirty, "The template has changes that are not saved.");
  const standardId = templates.find((t) => t.starter_key === "standard")?.id ?? templates[0]?.id ?? "";

  const open = (d: Draft) => {
    setDraft(d);
    setInitial(JSON.stringify(d));
    setError(null);
    setMessage(null);
  };
  const toggle = (k: MeasureKey) => setDraft((d) => (d ? { ...d, measures: d.measures.includes(k) ? d.measures.filter((x) => x !== k) : [...d.measures, k] } : d));
  const setLevel = (level: "high" | "detailed", on: boolean) =>
    setDraft((d) => {
      if (!d) return d;
      const keys = MEASURES.filter((m) => m.level === level).map((m) => m.key);
      return { ...d, measures: on ? [...new Set([...d.measures, ...keys])] : d.measures.filter((k) => !keys.includes(k)) };
    });
  const save = () =>
    start(async () => {
      if (!draft) return;
      const r = await saveReportTemplate({ id: draft.id, name: draft.name, measures: draft.measures, period: draft.period, note: draft.note });
      if (!r.ok) return setError(r.error);
      setDraft(null);
      setMessage(r.message);
      router.refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      const r = await deleteReportTemplate(id);
      setConfirmDelete(null);
      if (!r.ok) return setError(r.error);
      setMessage(r.message);
      router.refresh();
    });
  const choose = (partnerId: string, templateId: string) =>
    start(async () => {
      const r = await setPartnerTemplate(partnerId, templateId);
      if (!r.ok) return setError(r.error);
      setSaved((s) => ({ ...s, [partnerId]: "Saved" }));
      router.refresh();
    });

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Templates</CardTitle>
            <CardDescription>Each template lists the measures a report email shows, its period, and an optional note at the top.</CardDescription>
          </div>
          {editable ? (
            <Button size="sm" onClick={() => open({ ...EMPTY })} disabled={!!draft} data-testid="template-add">
              <Plus /> Add template
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}
          {draft ? (
            <div className="@container rounded-lg border border-slate-200 bg-slate-50/70 p-4" data-testid="template-editor">
              <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">{draft.id ? `Edit ${templates.find((t) => t.id === draft.id)?.name ?? "template"}` : "New template"}</p>
                <PanelClose onClick={() => setDraft(null)} label="Close the template editor" />
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 @md:grid-cols-[minmax(0,1fr)_12rem]">
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-800">
                  Name
                  <Input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Example: Deal search, weekly" data-testid="template-name" />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-800">
                  Period
                  <NativeSelect value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value as TemplatePeriod })} data-testid="template-period">
                    {TEMPLATE_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {PERIOD_LABEL[p]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-800 @md:col-span-2">
                  <span className="flex items-baseline justify-between gap-2">
                    Note at the top of the email (optional)
                    <span className={cn("text-xs font-normal", draft.note.length > NOTE_MAX ? "text-status-missed" : "text-muted-foreground")}>
                      {draft.note.length} of {NOTE_MAX}
                    </span>
                  </span>
                  <Textarea rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Example: This week I focused on broker calls." data-testid="template-note" />
                </label>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 @xl:grid-cols-2">
                {LEVELS.map((lv) => (
                  <fieldset key={lv.key} className="min-w-0" data-testid={`template-measures-${lv.key}`}>
                    <legend className="mb-1 flex w-full items-baseline justify-between gap-2 text-sm font-medium text-slate-900">
                      <span>
                        {lv.title} <span className="font-normal text-muted-foreground">{lv.hint}</span>
                      </span>
                      <span className="flex gap-2 text-xs font-normal">
                        <button type="button" className="text-primary-strong hover:underline" onClick={() => setLevel(lv.key, true)}>
                          All
                        </button>
                        <button type="button" className="text-primary-strong hover:underline" onClick={() => setLevel(lv.key, false)}>
                          None
                        </button>
                      </span>
                    </legend>
                    <div className="flex flex-col">
                      {MEASURES.filter((m) => m.level === lv.key).map((m) => (
                        <label key={m.key} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-slate-800" title={m.help}>
                          <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={draft.measures.includes(m.key)} onChange={() => toggle(m.key)} data-testid={`measure-${m.key}`} />
                          <span className="clamp-1">{m.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={save} disabled={pending} data-testid="template-save">
                  {pending ? "Saving..." : "Save template"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="template-list">
            {templates.map((t) => {
              const high = t.measures.filter((k) => MEASURES.find((m) => m.key === k)?.level === "high");
              const detailed = t.measures.filter((k) => MEASURES.find((m) => m.key === k)?.level === "detailed");
              return (
                <div key={t.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3" data-testid="template-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="clamp-1 font-medium text-slate-900">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {PERIOD_LABEL[t.period]}, {t.measures.length} measures
                      </p>
                    </div>
                    {t.starter_key ? <Badge variant="neutral">Starter</Badge> : null}
                  </div>
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">High-level</dt>
                    <dd className="clamp-2 text-slate-800">{high.length ? high.map(label).join(", ") : "None"}</dd>
                    <dt className="text-muted-foreground">Detailed</dt>
                    <dd className="clamp-2 text-slate-800">{detailed.length ? detailed.map(label).join(", ") : "None"}</dd>
                    <dt className="text-muted-foreground">Note</dt>
                    <dd className="clamp-1 text-slate-800">{t.note || "None"}</dd>
                  </dl>
                  {editable ? (
                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                      {confirmDelete === t.id ? (
                        <>
                          <span className="text-sm text-slate-800">Delete {t.name}?</span>
                          <Button size="sm" variant="destructive" onClick={() => remove(t.id)} disabled={pending} data-testid="template-delete-confirm">
                            Delete
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => open({ id: t.id, name: t.name, measures: [...t.measures], period: t.period, note: t.note ?? "" })} disabled={!!draft} data-testid="template-edit">
                            <Pencil /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(t.id)} disabled={!!draft || templates.length <= 1} data-testid="template-delete">
                            <Trash2 /> Delete
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
        <CardNote>Rename a template with Edit. A partner whose template is deleted gets Standard. Reset all data keeps the three starter templates.</CardNote>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Default template for each partner</CardTitle>
          <CardDescription>Used for the report email and the partner&apos;s report page. You can pick another template, or two, when you send.</CardDescription>
        </CardHeader>
        <CardContent>
          {partners.length ? (
            <ul className="flex flex-col divide-y divide-slate-100" data-testid="partner-template-list">
              {partners.map((p) => (
                <li key={p.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex items-baseline justify-between gap-2 text-sm font-medium text-slate-900">
                    <span className="clamp-1">{p.name}</span>
                    {saved[p.id] ? <span className="text-xs font-normal text-status-met">{saved[p.id]}</span> : null}
                  </span>
                  <NativeSelect value={p.templateId ?? standardId} onChange={(e) => choose(p.id, e.target.value)} disabled={!editable || pending} aria-label={`Default template for ${p.name}`} data-testid="partner-template">
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No accountability partners yet. Add one on Accountability partners.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
