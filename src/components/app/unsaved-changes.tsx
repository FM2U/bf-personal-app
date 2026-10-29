"use client";

/**
 * Unsaved changes warning, for every form in the app.
 *
 * - GuardedForm: the form used across the app. It saves through a server action and can be saved by the
 *   "Save and leave" button of the warning.
 * - UnsavedChangesGuard: placed once in the app layout. When any form on the page holds a change that is not saved,
 *   leaving asks first: an in-app link or the browser Back button shows the app's dialog (Save and leave,
 *   Leave without saving, Stay on this page); closing or reloading the tab shows the browser's own prompt.
 *
 * A field counts as changed when its value differs from the value it was shown with
 * (changing it back is not a change). Forms with method="get" (filters) and forms marked
 * data-unsaved="off" are never checked.
 *
 * - useUnsavedWork: for screens that are not one form (the CSV import wizard). While it reports work in progress,
 *   leaving asks too; the dialog offers "Leave and discard" and "Stay on this page" (there is nothing to save).
 * - Add steps (a form marked data-step="You chose a file but did not press Upload." and data-step-finish="Upload"):
 *   the dialog names each unfinished step and its first button finishes them ("Upload and leave"), next to
 *   Leave without saving and Stay on this page. The window's close question does the same (window-host.tsx).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { requestFormReset } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IGNORED_INPUT_TYPES, isFormDirty, safeLeaveTarget, type FieldState } from "@/lib/form-dirty";

// ---------- Reading forms ----------

function fieldState(el: Element): FieldState {
  // A field that does not count as work on its own (the kind of a document, the relation of a link).
  if ((el as HTMLElement).dataset?.unsavedIgnore !== undefined) return { kind: "ignore" };
  if (el instanceof HTMLInputElement) {
    if (!el.name || el.disabled || IGNORED_INPUT_TYPES.has(el.type)) return { kind: "ignore" };
    if (el.dataset.initial !== undefined) return { kind: "value", value: el.value, initial: el.dataset.initial };
    if (el.type === "checkbox" || el.type === "radio") return { kind: "check", checked: el.checked, initial: el.defaultChecked };
    if (el.type === "file") return { kind: "file", count: el.files?.length ?? 0 };
    return { kind: "value", value: el.value, initial: el.defaultValue };
  }
  if (el instanceof HTMLTextAreaElement) {
    if (!el.name || el.disabled) return { kind: "ignore" };
    return { kind: "value", value: el.value, initial: el.dataset.initial ?? el.defaultValue };
  }
  if (el instanceof HTMLSelectElement) {
    if (!el.name || el.disabled) return { kind: "ignore" };
    const opts = [...el.options];
    return { kind: "select", selected: opts.map((o) => o.selected), initial: opts.map((o) => o.defaultSelected), multiple: el.multiple };
  }
  return { kind: "ignore" };
}

function isChecked(form: HTMLFormElement): boolean {
  if ((form.getAttribute("method") ?? "").toLowerCase() === "get") return false;
  if (form.dataset.unsaved === "off") return false;
  return true;
}

export function formHasChanges(form: HTMLFormElement): boolean {
  return isFormDirty([...form.elements].map(fieldState));
}

function changedForms(): HTMLFormElement[] {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll("form")].filter((f) => isChecked(f) && formHasChanges(f));
}

// ---------- Work in progress outside a form ----------

const UNSAVED_EVENT = "app:unsaved-work";
const unsavedWork = new Map<symbol, string>();

/**
 * Reports work in progress that is not a form field (example: a CSV file chosen in the import wizard).
 * `message` is shown in the leave dialog.
 */
export function useUnsavedWork(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return;
    const key = Symbol("unsaved-work");
    unsavedWork.set(key, message);
    window.dispatchEvent(new Event(UNSAVED_EVENT));
    return () => {
      unsavedWork.delete(key);
    };
  }, [active, message]);
}

function hasChanges(): boolean {
  return changedForms().length > 0 || unsavedWork.size > 0;
}

/**
 * The guard's extra history entry (added at the first change so Back can be answered by the dialog). Shared with the
 * window (src/components/app/window-host.tsx), which counts it when it closes and replaces it when it moves on.
 */
export const guardHistory = { sentinel: false };

/** True when a form inside `root` holds a change that is not saved, or work outside a form is in progress. */
export function hasUnsavedIn(root: Element | null): boolean {
  if (unsavedWork.size > 0) return true;
  if (!root) return false;
  return [...root.querySelectorAll("form")].some((f) => isChecked(f) && formHasChanges(f));
}

/** An add step that was started but not finished (a file chosen, Upload not pressed). */
export type UnfinishedStep = { message: string; finish: string; form: HTMLFormElement };

/** The changed forms in `root` (the whole page when null), split into add steps and other forms. */
export function unsavedParts(root: ParentNode | null = null): { steps: UnfinishedStep[]; others: HTMLFormElement[] } {
  const forms = root ? [...root.querySelectorAll("form")].filter((f) => isChecked(f) && formHasChanges(f)) : changedForms();
  const steps: UnfinishedStep[] = [];
  const others: HTMLFormElement[] = [];
  for (const f of forms) {
    if (f.dataset.step) steps.push({ message: f.dataset.step, finish: f.dataset.stepFinish || "Finish", form: f });
    else others.push(f);
  }
  return { steps, others };
}

/** The first button of the leave question: "Upload and leave", "Finish all 3 and leave", "Save and leave". */
export function finishLabel(steps: { finish: string }[], others: number, verb: "leave" | "close"): string {
  if (steps.length === 1 && !others) return `${steps[0].finish} and ${verb}`;
  if (steps.length > 1 && !others) return `Finish all ${steps.length} and ${verb}`;
  return `Save and ${verb}`;
}

/** The unfinished steps as a short list in the leave question. */
export function StepList({ steps }: { steps: { message: string }[] }) {
  if (!steps.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-sm text-slate-800" data-testid="unsaved-steps">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-soon-solid" />
          <span>{s.message}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- GuardedForm ----------

type SaveResult = { ok: true; redirected: boolean } | { ok: false; error: string; field?: boolean };
type LeaveIntent = { dest: string | null; resolve: (r: SaveResult) => void };

const registered = new WeakSet<HTMLFormElement>();
const honorsLeaveTo = new WeakSet<HTMLFormElement>();
const leaveIntents = new WeakMap<HTMLFormElement, LeaveIntent>();

/** True while a GuardedForm is saving (read by SubmitButton). */
export const FormPendingContext = createContext(false);
export function useGuardedPending() {
  return useContext(FormPendingContext);
}

function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function failureOf(result: unknown): string | null {
  if (result && typeof result === "object" && (result as { ok?: unknown }).ok === false) {
    return String((result as { error?: unknown }).error ?? "The changes could not be saved.");
  }
  return null;
}

type GuardedFormProps = Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> & {
  /** A server action (or a function calling one). A result of { ok: false, error } counts as a failed save. */
  action: (fd: FormData) => unknown;
  /** Receives what the action returned (example: a form error to show). */
  onResult?: (result: unknown) => void;
  /** The action redirects to "__leave_to" after saving when it is given (saveRecord does). */
  leaveTo?: boolean;
  ref?: React.Ref<HTMLFormElement>;
};

/** A save error as a sentence. Production hides server error text ("Minified React error #441"): say what happened instead. */
export function friendlySaveError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (!msg || /Minified React error|Server Components render|unexpected response|Failed to fetch|NetworkError|Body exceeded/i.test(msg)) {
    return "The server did not save this. Check the connection and try again; if it keeps happening, reload the page.";
  }
  return msg;
}

const SAVE_ERROR_EVENT = "app:save-error";
/** Shows "Not saved. ..." at the bottom of the page (the guard's message) instead of a crash page. */
function reportSaveError(message: string) {
  window.dispatchEvent(new CustomEvent<string>(SAVE_ERROR_EVENT, { detail: message }));
}

/**
 * A form that saves through a server action, keeps what was typed when the save fails,
 * clears or refreshes its fields after a successful save, and works with the unsaved changes warning.
 */
export function GuardedForm({ action, onResult, leaveTo = false, children, ref: outerRef, ...rest }: GuardedFormProps) {
  const ref = useRef<HTMLFormElement>(null);
  const setRef = useCallback(
    (el: HTMLFormElement | null) => {
      ref.current = el;
      if (typeof outerRef === "function") outerRef(el);
      else if (outerRef) (outerRef as React.RefObject<HTMLFormElement | null>).current = el;
    },
    [outerRef],
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    registered.add(f);
    if (leaveTo) honorsLeaveTo.add(f);
    return () => {
      registered.delete(f);
      honorsLeaveTo.delete(f);
    };
  }, [leaveTo]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // A form inside a dialog (shown in a portal) reaches this handler through React; it saves itself.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter ?? null;
    const fd = new FormData(form, submitter);
    const intent = leaveIntents.get(form) ?? null;
    leaveIntents.delete(form);
    if (intent?.dest && leaveTo) fd.set("__leave_to", intent.dest);
    startTransition(async () => {
      try {
        const result = await action(fd);
        onResult?.(result);
        const failed = failureOf(result);
        if (!failed) startTransition(() => requestFormReset(form));
        intent?.resolve(failed ? { ok: false, error: failed } : { ok: true, redirected: false });
      } catch (err) {
        if (isRedirect(err)) {
          if (intent) intent.resolve({ ok: true, redirected: true });
          else throw err;
          return;
        }
        // Never a crash page: what was typed stays, and a message says it was not saved.
        if (intent) intent.resolve({ ok: false, error: friendlySaveError(err) });
        else reportSaveError(friendlySaveError(err));
      }
    });
  };

  return (
    <FormPendingContext.Provider value={pending}>
      <form ref={setRef} action={action as unknown as (fd: FormData) => void} onSubmit={onSubmit} {...rest}>
        {children}
      </form>
    </FormPendingContext.Provider>
  );
}

function saveSubmitter(form: HTMLFormElement): HTMLElement | null {
  return (
    form.querySelector<HTMLElement>("[data-save-and-leave]") ??
    [...form.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.type === "submit" || !b.getAttribute("type")) && !b.hasAttribute("formaction") && b.form === form) ??
    null
  );
}

/** Saves one form for "Save and leave". Resolves when the save is done or has failed. */
export function saveForLeave(form: HTMLFormElement, dest: string | null): Promise<SaveResult> {
  if (!form.checkValidity()) {
    form.reportValidity();
    return Promise.resolve({ ok: false, error: "Some fields need a value or a valid entry. They are marked on the form.", field: true });
  }
  if (!registered.has(form)) {
    form.requestSubmit(saveSubmitter(form));
    return Promise.resolve({ ok: false, error: "The form was sent. Check the page for the result, then leave." });
  }
  return new Promise((resolve) => {
    leaveIntents.set(form, { dest: honorsLeaveTo.has(form) ? dest : null, resolve });
    form.requestSubmit(saveSubmitter(form));
  });
}

// ---------- The guard ----------

/** savable: a form holds the changes (Save and leave is offered); otherwise only work outside forms (nothing to save). */
type Pending = ({ kind: "link"; href: string; anchor: HTMLAnchorElement } | { kind: "back" }) & { savable: boolean; steps: { message: string; finish: string }[]; others: number };

/** What the leave question shows, read from the page when leaving is asked for. */
function pendingParts(): { savable: boolean; steps: { message: string; finish: string }[]; others: number } {
  const { steps, others } = unsavedParts();
  return { savable: steps.length + others.length > 0, steps: steps.map(({ message, finish }) => ({ message, finish })), others: others.length };
}

export function UnsavedChangesGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bypass = useRef(false);

  // A new page starts clean; an earlier extra history entry stays behind as an ordinary entry of that page.
  const pageKey = `${pathname}?${search}`;
  const [shownFor, setShownFor] = useState(pageKey);
  if (shownFor !== pageKey) {
    setShownFor(pageKey);
    setError(null);
  }
  useEffect(() => {
    guardHistory.sentinel = false;
  }, [pageKey]);

  // The first change adds one extra history entry for this page, so the Back button can be answered by the dialog.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!guardHistory.sentinel && hasChanges()) {
          window.history.pushState(window.history.state, "", window.location.href);
          guardHistory.sentinel = true;
        }
      });
    };
    document.addEventListener("input", check, true);
    document.addEventListener("change", check, true);
    window.addEventListener(UNSAVED_EVENT, check);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("input", check, true);
      document.removeEventListener("change", check, true);
      window.removeEventListener(UNSAVED_EVENT, check);
    };
  }, []);

  // In-app links: checked before Next.js handles the click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page (a section link)
      if (!hasChanges()) return;
      e.preventDefault();
      e.stopPropagation();
      setError(null);
      setPending({ kind: "link", href: url.pathname + url.search + url.hash, anchor: a, ...pendingParts() });
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  // Browser Back: the extra entry was left; this page is still shown.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (!guardHistory.sentinel) return;
      guardHistory.sentinel = false;
      e.stopImmediatePropagation();
      if (hasChanges()) {
        setError(null);
        setPending({ kind: "back", ...pendingParts() });
      } else {
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A form's save failed outside "Save and leave": the same message at the bottom of the page.
  useEffect(() => {
    const onError = (e: Event) => setError((e as CustomEvent<string>).detail);
    window.addEventListener(SAVE_ERROR_EVENT, onError);
    return () => window.removeEventListener(SAVE_ERROR_EVENT, onError);
  }, []);

  // Tab close and reload: the browser's own prompt.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current || !hasChanges()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const go = useCallback(
    (p: Pending, opts: { redirected?: boolean } = {}) => {
      if (p.kind === "back") {
        if (opts.redirected) {
          // The save moved to another page first: go back past it and past this page.
          const start = window.location.href;
          const t0 = Date.now();
          const wait = () => (window.location.href !== start || Date.now() - t0 > 4000 ? window.history.go(-2) : setTimeout(wait, 50));
          wait();
        } else window.history.back();
        return;
      }
      const internal = safeLeaveTarget(p.href);
      if (internal && guardHistory.sentinel) {
        // Replace the extra history entry, so Back from the next page returns here once.
        guardHistory.sentinel = false;
        router.replace(internal);
        return;
      }
      bypass.current = true;
      if (p.anchor.isConnected) p.anchor.click();
      else if (internal) router.push(internal);
      else window.location.href = p.href;
      setTimeout(() => (bypass.current = false), 500);
    },
    [router],
  );

  const stay = () => {
    const wasBack = pending?.kind === "back";
    setPending(null);
    if (wasBack && hasChanges() && !guardHistory.sentinel) {
      window.history.pushState(window.history.state, "", window.location.href);
      guardHistory.sentinel = true;
    }
  };

  const leave = () => {
    const p = pending;
    setPending(null);
    if (p) go(p);
  };

  const saveAndLeave = async () => {
    const p = pending;
    if (!p) return;
    setSaving(true);
    setError(null);
    const forms = changedForms();
    const dest = p.kind === "link" ? safeLeaveTarget(p.href) : null;
    let last: SaveResult = { ok: true, redirected: false };
    for (const f of forms) {
      last = await saveForLeave(f, forms.length === 1 ? dest : null);
      if (!last.ok) break;
    }
    setSaving(false);
    if (!last.ok) {
      // Stay on the page; keep the extra history entry so Back still asks.
      setPending(null);
      if (p.kind === "back" && !guardHistory.sentinel) {
        window.history.pushState(window.history.state, "", window.location.href);
        guardHistory.sentinel = true;
      }
      if (!last.field) setError(last.error);
      return;
    }
    setPending(null);
    const redirectedToDest = forms.length === 1 && last.redirected && !!dest && honorsLeaveTo.has(forms[0]);
    if (redirectedToDest) return;
    go(p, { redirected: last.redirected });
  };

  return (
    <>
      <Dialog open={!!pending} onOpenChange={(open) => (!open && !saving ? stay() : null)}>
        <DialogContent className="max-w-md" aria-describedby="unsaved-desc">
          {pending && !pending.savable ? (
            <>
              <DialogTitle>Leave this page?</DialogTitle>
              <DialogDescription id="unsaved-desc">{[...unsavedWork.values()][0] ?? "This page has work that is not finished."}</DialogDescription>
            </>
          ) : pending && pending.steps.length ? (
            <>
              <DialogTitle>{pending.steps.length === 1 && !pending.others ? "Finish this step before you leave?" : "Finish these steps before you leave?"}</DialogTitle>
              <DialogDescription id="unsaved-desc" className="sr-only">
                {pending.steps.map((x) => x.message).join(" ")}
              </DialogDescription>
              <StepList steps={pending.steps} />
              {pending.others ? <p className="text-sm text-slate-700">Other changes on this page are not saved yet.</p> : null}
            </>
          ) : (
            <>
              <DialogTitle>Save your changes?</DialogTitle>
              <DialogDescription id="unsaved-desc">This page has changes that are not saved yet.</DialogDescription>
            </>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start">
            {pending && !pending.savable ? null : (
              <Button onClick={saveAndLeave} disabled={saving} data-testid="unsaved-save">
                {saving ? "Saving..." : pending ? finishLabel(pending.steps, pending.others, "leave") : "Save and leave"}
              </Button>
            )}
            <Button variant="outline" onClick={leave} disabled={saving} data-testid="unsaved-leave">
              {pending && !pending.savable ? "Leave and discard" : "Leave without saving"}
            </Button>
            <Button variant="ghost" onClick={stay} disabled={saving} data-testid="unsaved-stay">
              Stay on this page
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {error ? (
        <div role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-lg border border-status-missed-border bg-status-missed-bg px-4 py-3 text-sm text-status-missed shadow-lg">
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Not saved.</span> {error} You are still on this page.
          </p>
          <button type="button" onClick={() => setError(null)} aria-label="Close" className="shrink-0 rounded p-0.5 hover:bg-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  );
}
