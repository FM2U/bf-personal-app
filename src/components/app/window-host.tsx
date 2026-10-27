"use client";

/**
 * The app's window: one at a time, never one on top of another, each with its own web address.
 *
 * - The window is named in the `w` parameter of the page underneath (src/lib/window-route.ts), for example
 *   `/plan?w=r/initiatives/<id>`. Opening it adds a browser history entry, so browser Back closes it (or goes back one
 *   step inside it), and a refresh or a bookmarked link opens the same window over the same page.
 * - Escape, a click outside, and Close return to the page exactly as it was (the page is never reloaded, so the scroll
 *   position stays). When the window holds changes that are not saved, closing asks first.
 * - A link to a record opens its window: an overview first for initiatives, goals, pipeline items, and scenarios; the
 *   quick view for tasks, contacts, organizations, milestones. Inside the window, every record link (and Edit, and
 *   "+ Add") opens in the same window with Back; "Open full page" and any other link go to that page.
 * - Ctrl, Cmd, Shift, or a middle click on a link still opens the full page.
 *
 * The draft review page keeps a local summary window (openSummary) whose lines scroll to fields on that page.
 */
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { WindowFrame, WindowShell } from "@/components/ui/window";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SummaryContent } from "@/components/app/initiative-summary";
import { AskAiButton } from "@/components/app/ask-ai-button";
import { WindowView as WindowViewContent } from "@/components/app/windows/views";
import { guardHistory, hasUnsavedIn } from "@/components/app/unsaved-changes";
import { fullPageHref, hrefToView, parentView, parseWindowParam, WINDOW_PARAM, windowParam, windowSize, withWindow, type WindowView } from "@/lib/window-route";
import type { InitiativeSummary, SummaryRef } from "@/lib/initiative/summary";

// ---------- History (module level: buttons anywhere can open a window) ----------

/** This page load. History entries made by an earlier page load cannot be stepped back through without a reload. */
const DOC = typeof window === "undefined" ? "server" : Math.random().toString(36).slice(2);

type WinState = { __winDoc?: string; __winDepth?: number; __winPrev?: string | null; __winRootDoc?: string };

function histState(): WinState {
  return ((typeof window !== "undefined" && window.history.state) || {}) as WinState;
}
function currentW(): string | null {
  return new URL(window.location.href).searchParams.get(WINDOW_PARAM);
}
const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * The page underneath is reloaded once, when the window closes, after something changed in the window. Reloading it
 * while the window moves from step to step would hold up each step (Next.js handles one navigation at a time).
 */
const pageState = { stale: false };

/** A message shown in the window (or at the bottom of the page) for a few seconds: "Saved", "Saved for later". */
const flashListeners = new Set<(m: string) => void>();
export function flashMessage(message: string) {
  flashListeners.forEach((l) => l(message));
}

/**
 * Opens a window. From a page this adds one history entry; inside a window it adds the next step ("push", with Back)
 * or swaps the current one ("replace"). The unsaved changes guard's extra entry is reused, never left behind.
 */
export function openWindowView(v: WindowView, how: "push" | "replace" = "push") {
  const cur = currentW();
  const s = histState();
  const same = s.__winDoc === DOC;
  const url = withWindow(here(), v);
  if (!cur) {
    const state: WinState = { __winDoc: DOC, __winDepth: 0, __winPrev: null, __winRootDoc: DOC };
    if (guardHistory.sentinel) {
      guardHistory.sentinel = false;
      window.history.replaceState(state, "", url);
    } else window.history.pushState(state, "", url);
    return;
  }
  if (how === "replace") {
    window.history.replaceState({ __winDoc: DOC, __winDepth: same ? s.__winDepth ?? 0 : 0, __winPrev: same ? s.__winPrev ?? null : null, __winRootDoc: same ? s.__winRootDoc : undefined }, "", url);
    return;
  }
  const state: WinState = { __winDoc: DOC, __winDepth: (same ? s.__winDepth ?? 0 : 0) + 1, __winPrev: cur, __winRootDoc: same ? s.__winRootDoc : undefined };
  if (guardHistory.sentinel) {
    guardHistory.sentinel = false;
    window.history.replaceState(state, "", url);
  } else window.history.pushState(state, "", url);
}

/** True when Back inside the window can step back through history made in this page load. */
function canStepBack(): boolean {
  const s = histState();
  return s.__winDoc === DOC && (s.__winDepth ?? 0) > 0;
}

/** Back inside the window: the previous step, or (opened straight at this view) the view it belongs to. */
export function windowBack(view: WindowView | null) {
  if (canStepBack()) {
    const extra = guardHistory.sentinel ? 1 : 0;
    guardHistory.sentinel = false;
    window.history.go(-(1 + extra));
    return;
  }
  const p = view ? parentView(view) : null;
  if (p) openWindowView(p, "replace");
}

/** Closes the window: back to the page entry it was opened from, or (opened by a refresh or a link) the page without it. */
function closeWindowHistory() {
  if (!currentW()) return;
  const s = histState();
  const extra = guardHistory.sentinel ? 1 : 0;
  guardHistory.sentinel = false;
  if (s.__winDoc === DOC && s.__winRootDoc === DOC) {
    window.history.go(-((s.__winDepth ?? 0) + 1 + extra));
  } else {
    window.history.replaceState({ ...s, __winDoc: undefined, __winDepth: undefined, __winPrev: undefined, __winRootDoc: undefined }, "", withWindow(here(), null));
  }
}

/** The current view's save ("Save and close" when closing with unsaved changes). */
const windowSaver: { fn: (() => Promise<boolean>) | null } = { fn: null };

// ---------- Window context (for the views) ----------

export type WindowNav = {
  view: WindowView;
  /** Opens the next view in the same window (Back returns). */
  push: (v: WindowView) => void;
  /** Swaps the current view (no new Back step). */
  replace: (v: WindowView) => void;
  back: () => void;
  canBack: boolean;
  /** Close as the Close button does (asks first when there are unsaved changes). */
  requestClose: () => void;
  /** Close without asking (after Save for later, after Approve). */
  close: () => void;
  /** After a record was saved in its editor: back to where Edit was pressed (or the record's overview), with "Saved". */
  afterSave: (table: string, id: string, message?: string) => void;
  /** The current view's save, used by "Save and close" when closing with unsaved changes. */
  setSaver: (fn: (() => Promise<boolean>) | null) => void;
  /** Marks the page underneath as changed: it reloads once when the window closes. */
  refreshPage: () => void;
};

const WindowNavContext = createContext<WindowNav | null>(null);
export function useWindowNav(): WindowNav {
  const ctx = useContext(WindowNavContext);
  if (!ctx) throw new Error("useWindowNav is used inside a window view");
  return ctx;
}

// ---------- Local summary window (draft review page) ----------

type WindowApi = {
  /** The draft review page's summary: each line closes the window and goes to that field on the page. */
  openSummary: (summary: InitiativeSummary, opts?: { onField?: (anchor: string) => void }) => void;
  /** Opens a record's window (overview or quick view). */
  openRecord: (table: string, id: string) => void;
  open: (v: WindowView) => void;
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
  const [local, setLocal] = useState<{ summary: InitiativeSummary; onField?: (anchor: string) => void } | null>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const focusAfterClose = useRef<string | null>(null);
  const api = useMemo<WindowApi>(
    () => ({
      openSummary: (summary, opts) => {
        setLocal({ summary, onField: opts?.onField });
        setLocalOpen(true);
      },
      openRecord: (table, id) => openWindowView({ kind: "record", table, id }),
      open: (v) => openWindowView(v),
    }),
    [],
  );
  const pick = (r: SummaryRef) => {
    if (!local) return;
    const anchor = r.kind === "field" ? r.anchor : r.kind === "plan" && local.summary.plan?.ref.kind === "field" ? local.summary.plan.ref.anchor : null;
    if (anchor && local.onField) {
      focusAfterClose.current = anchor;
      setLocalOpen(false);
    }
  };
  return (
    <WindowContext.Provider value={api}>
      <Suspense fallback={null}>
        {/* First child, so its click listener is registered before the unsaved changes guard's (it runs first). */}
        <UrlWindow />
      </Suspense>
      {children}
      {local ? (
        <WindowFrame
          host
          open={localOpen}
          onOpenChange={setLocalOpen}
          size="large"
          title={`Summary: ${local.summary.name}`}
          subtitle="Select a line to edit it on the review screen."
          testId="summary-window"
          ask={<AskAiButton compact context={{ label: `Initiative draft: ${local.summary.name}` }} />}
          onCloseAutoFocus={(e) => {
            const anchor = focusAfterClose.current;
            focusAfterClose.current = null;
            const onField = local.onField;
            setLocal(null);
            if (anchor) {
              e.preventDefault();
              onField?.(anchor);
              requestAnimationFrame(() => focusField(anchor));
            }
          }}
        >
          <SummaryContent s={local.summary} pick={pick} />
        </WindowFrame>
      ) : null}
    </WindowContext.Provider>
  );
}

// ---------- The window named in the address ----------

function testIdFor(v: WindowView): string {
  if (v.kind === "record") return v.table === "initiatives" ? "summary-window" : (["goals", "pipeline_items", "scenarios"] as string[]).includes(v.table) ? "overview-window" : "quick-view";
  if (v.kind === "edit" || v.kind === "new") return "edit-window";
  if (v.kind === "setup") return "setup-window";
  if (v.kind === "work") return "tasks-window";
  if (v.kind === "plan") return "plan-window";
  if (v.kind === "scenario-summary") return "scenario-summary-window";
  return "draft-window";
}

/** Views that keep their state while moving between steps (the setup keeps its edits; Work through tasks its counts). */
function viewKey(v: WindowView): string {
  if (v.kind === "setup") return `setup:${v.draftId ?? (v.manual ? "manual" : "new")}`;
  if (v.kind === "work") return "work";
  return windowParam(v);
}

function UrlWindow() {
  const router = useRouter();
  const w = useSearchParams().get(WINDOW_PARAM);
  const view = useMemo(() => parseWindowParam(w), [w]);
  // Closed by the owner: hidden at once while the address catches up.
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [lastW, setLastW] = useState(w);
  if (lastW !== w) {
    setLastW(w);
    setHiddenFor(null);
  }
  const [confirm, setConfirm] = useState<null | { proceed: () => void; canSave: boolean }>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const l = (m: string) => {
      setFlash(m);
      clearTimeout(t);
      t = setTimeout(() => setFlash(null), 5000);
    };
    flashListeners.add(l);
    return () => {
      flashListeners.delete(l);
      clearTimeout(t);
    };
  }, []);

  const open = !!view && hiddenFor !== w;

  // The window closed (Close, Escape, Back, or a link): reload the page underneath if something changed in the window.
  useEffect(() => {
    if (w || !pageState.stale) return;
    pageState.stale = false;
    router.refresh();
  }, [w, router]);

  const close = useCallback(() => {
    setHiddenFor(w);
    windowSaver.fn = null;
    closeWindowHistory();
  }, [w]);

  const ask = useCallback((proceed: () => void) => {
    if (hasUnsavedIn(document.querySelector("[data-url-window]"))) setConfirm({ proceed, canSave: !!windowSaver.fn });
    else proceed();
  }, []);

  const requestClose = useCallback(() => ask(close), [ask, close]);

  const nav = useMemo<WindowNav | null>(
    () =>
      view
        ? {
            view,
            push: (v) => openWindowView(v, "push"),
            replace: (v) => openWindowView(v, "replace"),
            back: () => ask(() => windowBack(view)),
            canBack: typeof window !== "undefined" && (canStepBack() || !!parentView(view)),
            requestClose,
            close,
            afterSave: (table, id, message = "Saved") => {
              windowSaver.fn = null;
              flashMessage(message);
              const s = histState();
              pageState.stale = true;
              if (s.__winDoc === DOC && (s.__winDepth ?? 0) > 0 && s.__winPrev) windowBack(view);
              else openWindowView({ kind: "record", table, id }, "replace");
            },
            setSaver: (fn) => {
              windowSaver.fn = fn;
            },
            refreshPage: () => {
              pageState.stale = true;
            },
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, requestClose, close, ask, router],
  );

  // Links: record links open their window; inside the window, links open the next view.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (a.protocol !== "http:" && a.protocol !== "https:") return; // mailto:, tel:
      const host = a.closest("[data-url-window]");
      const inHost = !!host;
      if (!inHost && a.closest("[role=dialog], [data-app-window]")) return; // another window or dialog: its links go to the page
      const v = a.dataset.window ? parseWindowParam(a.dataset.window) : a.dataset.fullPage !== undefined ? null : hrefToView(a.href, { origin: window.location.origin, inWindow: inHost });
      if (!v) {
        // Any other link inside the window goes to its page (the unsaved changes guard asks first when needed).
        if (inHost && !hasUnsavedIn(host)) {
          windowSaver.fn = null;
          setHiddenFor(currentW());
        }
        return;
      }
      // A link to the record whose full page is open stays a link.
      if (!inHost && window.location.pathname === fullPageHref(v).split("?")[0] && v.kind === "record") return;
      e.preventDefault();
      e.stopPropagation();
      if (inHost && hasUnsavedIn(host)) setConfirm({ proceed: () => openWindowView(v, "push"), canSave: !!windowSaver.fn });
      else openWindowView(v, "push");
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  const saveAndGo = async () => {
    const c = confirm;
    if (!c) return;
    if (!windowSaver.fn) return;
    setSaving(true);
    const ok = await windowSaver.fn().catch(() => false);
    setSaving(false);
    setConfirm(null);
    if (ok) c.proceed();
  };

  return (
    <>
      {view && nav ? (
        <WindowShell
          host
          urlWindow
          open={open}
          onOpenChange={(o) => {
            if (!o) requestClose();
          }}
          size={windowSize(view)}
          testId={testIdFor(view)}
          minHeight={view.kind === "setup" || view.kind === "work"}
        >
          <WindowNavContext.Provider value={nav}>
            <WindowViewContent key={viewKey(view)} />
          </WindowNavContext.Provider>
          {flash && open ? (
            <div role="status" className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-24" data-testid="window-flash">
              <span className="clamp-2 inline-flex max-w-xl items-center gap-1.5 rounded-full border border-status-met-border bg-status-met-bg px-3 py-1.5 text-sm font-medium text-status-met shadow-md">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> {flash}
              </span>
            </div>
          ) : null}
        </WindowShell>
      ) : null}
      {flash && !open ? (
        <div role="status" className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" data-testid="page-flash">
          <span className="inline-flex max-w-lg items-center gap-1.5 rounded-full border border-status-met-border bg-status-met-bg px-4 py-2 text-sm font-medium text-status-met shadow-lg">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {flash}
          </span>
        </div>
      ) : null}
      <Dialog open={!!confirm} onOpenChange={(o) => (!o && !saving ? setConfirm(null) : null)}>
        <DialogContent className="max-w-md" aria-describedby="window-unsaved-desc" data-testid="window-unsaved">
          <DialogTitle>Close without saving?</DialogTitle>
          <DialogDescription id="window-unsaved-desc">This window has changes that are not saved yet.</DialogDescription>
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start">
            {confirm?.canSave ? (
              <Button onClick={saveAndGo} disabled={saving} data-testid="window-unsaved-save">
                {saving ? "Saving..." : "Save and close"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={saving}
              data-testid="window-unsaved-discard"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                windowSaver.fn = null;
                // The window closes (or moves on) without saving.
                c?.proceed();
              }}
            >
              Close without saving
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setConfirm(null)} data-testid="window-unsaved-stay">
              Keep editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
