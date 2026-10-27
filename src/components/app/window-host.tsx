"use client";

/**
 * The app's shared window (one at a time, never one on top of another):
 * - Summary window ("View summary"): large (85% wide, max 1400px).
 * - Quick view of a linked record: medium (60% wide, max 960px), opened by clicking a link to a task, contact,
 *   organization, pipeline item, goal, or milestone anywhere in the app (a page, a list, a Home card).
 * - Inside the window, a link to any record opens in the same window with a Back control; "Open full page" and any
 *   other link close the window and go to that page. Links inside other windows (the daily close, dialogs) are left alone.
 * Ctrl, Cmd, Shift, or a middle click on a link still opens the full page as usual.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Circle, Mail, Pencil, Phone } from "lucide-react";
import { WindowFrame } from "@/components/ui/window";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { NextActionCard } from "@/components/app/next-action-card";
import { SummaryContent } from "@/components/app/initiative-summary";
import { AiText } from "@/components/app/ai-text";
import { Notice } from "@/components/app/page-header";
import { loadQuickView, type QuickViewData } from "@/app/actions/quick-view";
import { setTaskStatus } from "@/app/actions/records";
import { parseRecordHref } from "@/lib/quick-view";
import type { InitiativeSummary, SummaryRef } from "@/lib/initiative/summary";

type View =
  | { type: "summary"; summary: InitiativeSummary; onField?: (anchor: string) => void }
  | { type: "record"; table: string; id: string }
  | { type: "plan"; title: string; body: string };

type WindowApi = {
  openSummary: (summary: InitiativeSummary, opts?: { onField?: (anchor: string) => void }) => void;
  openRecord: (table: string, id: string) => void;
  close: () => void;
};

const WindowContext = createContext<WindowApi | null>(null);

export function useAppWindow(): WindowApi {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error("useAppWindow needs WindowProvider");
  return ctx;
}

/** Scrolls to a field on the page, focuses it, and outlines it briefly (review screen drill-down). */
export function focusField(anchor: string) {
  const el = document.getElementById(anchor);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  (el as HTMLElement).focus({ preventScroll: true });
  el.classList.add("field-flash");
  setTimeout(() => el.classList.remove("field-flash"), 1600);
}

export function WindowProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<View[]>([]);
  const [open, setOpen] = useState(false);
  const focusAfterClose = useRef<string | null>(null);

  const api = useMemo<WindowApi>(
    () => ({
      openSummary: (summary, opts) => {
        setStack([{ type: "summary", summary, onField: opts?.onField }]);
        setOpen(true);
      },
      openRecord: (table, id) => {
        setStack([{ type: "record", table, id }]);
        setOpen(true);
      },
      close: () => setOpen(false),
    }),
    [],
  );
  const push = useCallback((v: View) => setStack((s) => [...s, v]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  const top = stack[stack.length - 1];
  const root = stack[0];

  const pick = (r: SummaryRef) => {
    const s = root?.type === "summary" ? root : null;
    if (r.kind === "field") {
      if (s?.onField) {
        focusAfterClose.current = r.anchor;
        setOpen(false);
      }
    } else if (r.kind === "record") push({ type: "record", table: r.table, id: r.id });
    else if (r.kind === "plan" && s?.summary.plan) {
      if (s.onField && s.summary.plan.ref.kind === "field") {
        focusAfterClose.current = s.summary.plan.ref.anchor;
        setOpen(false);
      } else push({ type: "plan", title: s.summary.plan.title, body: s.summary.plan.body });
    }
  };

  let body: React.ReactNode = null;
  let title: React.ReactNode = "";
  let subtitle: React.ReactNode = null;
  let footer: React.ReactNode = null;
  let testId = "app-window";
  if (top?.type === "summary") {
    title = `Summary: ${top.summary.name}`;
    subtitle = top.onField ? "Select a line to edit it on the review screen." : "Select a line to open it.";
    body = <SummaryContent s={top.summary} pick={pick} />;
    testId = "summary-window";
  } else if (top?.type === "plan") {
    title = top.title;
    subtitle = "Plan document";
    body = <AiText text={top.body} className="max-w-[75ch]" />;
    testId = "plan-window";
  } else if (top?.type === "record") {
    const rv = <RecordView key={`${top.table}:${top.id}`} table={top.table} id={top.id} onClose={() => setOpen(false)} />;
    title = <RecordTitle table={top.table} id={top.id} />;
    body = rv;
    footer = <RecordFooter table={top.table} id={top.id} onClose={() => setOpen(false)} />;
    testId = "quick-view";
  }

  return (
    <WindowContext.Provider value={api}>
      {/* First child, so its click listener is registered before the unsaved changes guard's (it runs first). */}
      <LinkCatcher openRecord={api.openRecord} push={push} close={api.close} />
      {children}
      {stack.length ? (
        <WindowFrame
          host
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
          }}
          size={root?.type === "record" ? "medium" : "large"}
          title={title}
          subtitle={subtitle}
          onBack={stack.length > 1 ? back : undefined}
          footer={footer}
          testId={testId}
          onCloseAutoFocus={(e) => {
            const anchor = focusAfterClose.current;
            focusAfterClose.current = null;
            setStack([]);
            if (anchor) {
              e.preventDefault();
              const s = root;
              if (s?.type === "summary" && s.onField) s.onField(anchor);
              requestAnimationFrame(() => focusField(anchor));
            }
          }}
        >
          {body}
        </WindowFrame>
      ) : null}
    </WindowContext.Provider>
  );
}

/** A record link opens the quick view; inside the window it opens the next view in the same window. */
function LinkCatcher({ openRecord, push, close }: { openRecord: (table: string, id: string) => void; push: (v: View) => void; close: () => void }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (a.protocol !== "http:" && a.protocol !== "https:") return; // mailto:, tel:
      const inHost = !!a.closest("[data-window-host]");
      if (!inHost && a.closest("[role=dialog], [data-app-window]")) return; // another window: its links go to the full page
      const rec = a.dataset.fullPage !== undefined ? null : parseRecordHref(a.href, { anyTable: inHost, origin: window.location.origin });
      if (!rec) {
        // Any other link inside the window goes to its page, and the window closes.
        if (inHost) close();
        return;
      }
      if (!inHost && window.location.pathname === `/records/${rec.table}/${rec.id}`) return;
      e.preventDefault();
      e.stopPropagation();
      if (inHost) push({ type: "record", ...rec });
      else openRecord(rec.table, rec.id);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [openRecord, push, close]);
  return null;
}

// ---------- Quick view of one record ----------

const cache = new Map<string, QuickViewData>();
const listeners = new Set<() => void>();

function useQuickView(table: string, id: string): { data: QuickViewData | null; reload: () => void } {
  const key = `${table}:${id}`;
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const load = useCallback(() => {
    loadQuickView(table, id)
      .then((d) => cache.set(key, d))
      .catch(() => cache.set(key, { ok: false, error: "This record could not be loaded. Try Open full page." }))
      .finally(() => listeners.forEach((l) => l()));
  }, [key, table, id]);
  useEffect(() => {
    cache.delete(key);
    load();
  }, [key, load]);
  return { data: cache.get(key) ?? null, reload: load };
}

function RecordTitle({ table, id }: { table: string; id: string }) {
  const { data } = useQuickView(table, id);
  if (!data) return <span className="text-slate-400">Loading...</span>;
  return <>{data.ok ? data.title : "Record"}</>;
}

function RecordView({ table, id }: { table: string; id: string; onClose: () => void }) {
  const { data } = useQuickView(table, id);
  if (!data)
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  if (!data.ok) return <Notice tone="warn">{data.error}</Notice>;
  const short = data.fields.filter((f) => !f.wide);
  const wide = data.fields.filter((f) => f.wide);
  return (
    <div className="flex flex-col gap-4" data-testid="quick-view-body">
      <p className="-mt-2 text-xs font-medium text-slate-500">{data.singular}</p>
      <NextActionCard action={data.next} today={data.today} compact />
      {short.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-white p-4 lg:grid-cols-3">
          {short.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="clamp-2 text-xs font-medium leading-4 text-slate-500">{f.label}</dt>
              <dd className="mt-0.5 min-w-0 break-words text-sm text-slate-900">
                {f.href ? (
                  <Link href={f.href} className="font-medium text-primary-strong underline-offset-2 hover:underline">
                    {f.text}
                  </Link>
                ) : f.status ? (
                  <StatusBadge status={f.status}>{f.text}</StatusBadge>
                ) : (
                  f.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {wide.map((f, i) => (
        <div key={i} className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs font-medium text-slate-500">{f.label}</p>
          <p className="mt-1 max-w-[75ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{f.text}</p>
        </div>
      ))}
    </div>
  );
}

function RecordFooter({ table, id, onClose }: { table: string; id: string; onClose: () => void }) {
  const { data, reload } = useQuickView(table, id);
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!data?.ok) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/records/${table}/${id}`} data-full-page="" onClick={onClose}>
          Open full page
        </Link>
      </Button>
    );
  }
  return (
    <>
      {data.taskDone !== null ? (
        <Button
          size="sm"
          variant={data.taskDone ? "outline" : "default"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setTaskStatus(id, !data.taskDone);
              reload();
              router.refresh();
            })
          }
          data-testid="quick-view-task-toggle"
        >
          {data.taskDone ? <Circle /> : <CheckCircle2 />} {pending ? "Saving..." : data.taskDone ? "Mark as not done" : "Mark as done"}
        </Button>
      ) : null}
      {data.email ? (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${data.email}`}>
            <Mail /> {data.email}
          </a>
        </Button>
      ) : null}
      {data.phone ? (
        <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
          <a href={`tel:${data.phone}`}>
            <Phone /> {data.phone}
          </a>
        </Button>
      ) : null}
      <span className="flex-1" />
      {data.canEdit ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`${data.href}?edit=1`} data-full-page="">
            <Pencil /> Edit
          </Link>
        </Button>
      ) : null}
      <Button asChild size="sm">
        <Link href={data.href} data-full-page="" data-testid="quick-view-full-page">
          Open full page <ArrowUpRight />
        </Link>
      </Button>
    </>
  );
}
