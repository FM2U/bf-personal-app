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
};

/**
 * A form that saves through a server action, keeps what was typed when the save fails,
 * clears or refreshes its fields after a successful save, and works with the unsaved changes warning.
 */
export function GuardedForm({ action, onResult, leaveTo = false, children, ...rest }: GuardedFormProps) {
  const ref = useRef<HTMLFormElement>(null);
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
        if (intent) intent.resolve({ ok: false, error: err instanceof Error && err.message ? err.message : "The changes could not be saved." });
        else throw err;
      }
    });
  };

  return (
    <FormPendingContext.Provider value={pending}>
      <form ref={ref} action={action as unknown as (fd: FormData) => void} onSubmit={onSubmit} {...rest}>
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
function saveForLeave(form: HTMLFormElement, dest: string | null): Promise<SaveResult> {
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

type Pending = { kind: "link"; href: string; anchor: HTMLAnchorElement } | { kind: "back" };

export function UnsavedChangesGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef(false);
  const bypass = useRef(false);

  // A new page starts clean; an earlier extra history entry stays behind as an ordinary entry of that page.
  const pageKey = `${pathname}?${search}`;
  const [shownFor, setShownFor] = useState(pageKey);
  if (shownFor !== pageKey) {
    setShownFor(pageKey);
    setError(null);
  }
  useEffect(() => {
    sentinel.current = false;
  }, [pageKey]);

  // The first change adds one extra history entry for this page, so the Back button can be answered by the dialog.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!sentinel.current && changedForms().length) {
          window.history.pushState(window.history.state, "", window.location.href);
          sentinel.current = true;
        }
      });
    };
    document.addEventListener("input", check, true);
    document.addEventListener("change", check, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("input", check, true);
      document.removeEventListener("change", check, true);
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
      if (!changedForms().length) return;
      e.preventDefault();
      e.stopPropagation();
      setError(null);
      setPending({ kind: "link", href: url.pathname + url.search + url.hash, anchor: a });
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  // Browser Back: the extra entry was left; this page is still shown.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (!sentinel.current) return;
      sentinel.current = false;
      e.stopImmediatePropagation();
      if (changedForms().length) {
        setError(null);
        setPending({ kind: "back" });
      } else {
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Tab close and reload: the browser's own prompt.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current || !changedForms().length) return;
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
      if (internal && sentinel.current) {
        // Replace the extra history entry, so Back from the next page returns here once.
        sentinel.current = false;
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
    if (wasBack && changedForms().length && !sentinel.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      sentinel.current = true;
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
      if (p.kind === "back" && !sentinel.current) {
        window.history.pushState(window.history.state, "", window.location.href);
        sentinel.current = true;
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
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription id="unsaved-desc">This page has changes that are not saved yet.</DialogDescription>
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start">
            <Button onClick={saveAndLeave} disabled={saving} data-testid="unsaved-save">
              {saving ? "Saving..." : "Save and leave"}
            </Button>
            <Button variant="outline" onClick={leave} disabled={saving} data-testid="unsaved-leave">
              Leave without saving
            </Button>
            <Button variant="ghost" onClick={stay} disabled={saving} data-testid="unsaved-stay">
              Stay on this page
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {error ? (
        <div role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-lg">
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Not saved.</span> {error} You are still on this page.
          </p>
          <button type="button" onClick={() => setError(null)} aria-label="Close" className="shrink-0 rounded p-0.5 hover:bg-red-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  );
}
