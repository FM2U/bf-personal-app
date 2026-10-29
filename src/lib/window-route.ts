/**
 * Window addresses. Every window (a record overview, an editor, the step-by-step initiative setup, Work through tasks)
 * has its own web address: the page underneath stays the same and the window is named in the `w` parameter, for
 * example `/plan?w=r/initiatives/<id>` (the initiative's overview over Plan) or `/?w=setup/<draft id>/goals`.
 * Refresh or a bookmarked link opens the same window over the same page; browser Back closes it (or goes back one
 * step inside it). Pure functions, tested in src/lib/window-route.test.ts; the browser part is
 * src/components/app/window-host.tsx.
 *
 * `w` values:
 *   r/<table>/<id>         a record's overview (initiatives, goals, pipeline items, scenarios) or quick view (others)
 *   e/<table>/<id>         the record's editor
 *   n/<table>/<k=v&...>    a new record (fields filled from the query text)
 *   draft/<id>             an initiative draft's overview
 *   setup                  Start an initiative, step 1 (Describe)
 *   setup/manual           Add manually (no AI): a draft is made and the setup opens at Name and purpose
 *   setup/<id>/<step>      one step of the setup for a draft
 *   work, work/<task id>   Work through tasks (today's tasks one at a time)
 *   plan/<initiative id>   an initiative's plan document as text
 *   ss/<id>[,<id>...]      the scenario summary (one scenario, or the scenarios being compared)
 *   resolve/<miss id>      resolve a missed commitment: a one-line reason, then a new date or a decision
 */
import { getResource } from "@/lib/resources";

export const WINDOW_PARAM = "w";

export const SETUP_STEPS = ["describe", "name", "goals", "milestones", "tasks", "target", "plan", "review"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_LABEL: Record<SetupStep, string> = {
  describe: "Describe",
  name: "Name and purpose",
  goals: "Goals",
  milestones: "Milestones",
  tasks: "Tasks",
  target: "Target and budget",
  plan: "Plan and checklists",
  review: "Review and approve",
};

/** The one-line instruction at the top of each setup step. */
export const SETUP_STEP_HELP: Record<SetupStep, string> = {
  describe: "Type or speak what you want to start, in one or a few sentences. The AI drafts every step for you to check.",
  name: "Give the initiative a short name and say in one or two sentences why you are doing it.",
  goals: "Each goal is a measured number, a target, and a deadline. Uncheck Include for any goal you do not want.",
  milestones: "Milestones are dated checkpoints with a test you can check. Each one is a commitment.",
  tasks: "Recurring tasks repeat on a schedule and appear in Today's tasks. Only reviews count as commitments.",
  target: "A target is a count per day or week (counted with +1). A budget change sets the monthly amount for one category.",
  plan: "The plan is bulleted text shown on the initiative page. Checklists are lists you check off, such as groceries.",
  review: "Check the summary, then approve. Every included item is created together and linked to the initiative.",
};

export type WindowView =
  | { kind: "record"; table: string; id: string }
  | { kind: "edit"; table: string; id: string }
  | { kind: "new"; table: string; prefill: Record<string, string> }
  | { kind: "draft"; id: string }
  | { kind: "setup"; draftId: null; manual: boolean }
  | { kind: "setup"; draftId: string; step: SetupStep }
  | { kind: "work"; taskId: string | null }
  | { kind: "plan"; initiativeId: string }
  | { kind: "scenario-summary"; ids: string[] }
  | { kind: "resolve"; missId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (s: string | undefined): s is string => !!s && UUID.test(s);
const isTable = (s: string | undefined): s is string => !!s && /^[a-z_]+$/.test(s) && !!getResource(s);

/** Records that open in a window when a link to them is clicked on a page (inside a window, every record type does). */
export const WINDOW_TABLES = ["initiatives", "goals", "milestones", "pipeline_items", "scenarios", "tasks", "commitments", "contacts", "organizations"] as const;

/** Records whose window shows a large overview first (the others show the medium quick view). */
export const OVERVIEW_TABLES = ["initiatives", "goals", "pipeline_items", "scenarios"] as const;

/** Tasks and commitments open the one task window: large, with everything the full task page shows. */
export const TASK_WINDOW_TABLES = ["tasks", "commitments"] as const;

export function isSetupStep(s: string | undefined | null): s is SetupStep {
  return !!s && (SETUP_STEPS as readonly string[]).includes(s);
}

/** Reads the `w` parameter. Anything that does not name a window gives null (no window). */
export function parseWindowParam(w: string | null | undefined): WindowView | null {
  if (!w) return null;
  const [head, ...rest] = w.split("/");
  switch (head) {
    case "r":
    case "e": {
      const [table, id] = rest;
      if (rest.length !== 2 || !isTable(table) || !isId(id)) return null;
      return head === "r" ? { kind: "record", table, id } : { kind: "edit", table, id };
    }
    case "n": {
      const [table, ...q] = rest;
      if (!isTable(table)) return null;
      const prefill: Record<string, string> = {};
      new URLSearchParams(q.join("/")).forEach((v, k) => {
        if (/^[a-z_]+$/.test(k)) prefill[k] = v;
      });
      return { kind: "new", table, prefill };
    }
    case "draft":
      return rest.length === 1 && isId(rest[0]) ? { kind: "draft", id: rest[0] } : null;
    case "setup":
      if (!rest.length) return { kind: "setup", draftId: null, manual: false };
      if (rest.length === 1 && rest[0] === "manual") return { kind: "setup", draftId: null, manual: true };
      if (rest.length === 2 && isId(rest[0]) && isSetupStep(rest[1])) return { kind: "setup", draftId: rest[0], step: rest[1] };
      return null;
    case "work":
      if (!rest.length) return { kind: "work", taskId: null };
      return rest.length === 1 && isId(rest[0]) ? { kind: "work", taskId: rest[0] } : null;
    case "plan":
      return rest.length === 1 && isId(rest[0]) ? { kind: "plan", initiativeId: rest[0] } : null;
    case "resolve":
      return rest.length === 1 && isId(rest[0]) ? { kind: "resolve", missId: rest[0] } : null;
    case "ss": {
      const ids = rest.length === 1 ? rest[0].split(",").filter(Boolean) : [];
      return ids.length && ids.length <= 5 && ids.every(isId) ? { kind: "scenario-summary", ids } : null;
    }
    default:
      return null;
  }
}

/** The `w` parameter for a window (the opposite of parseWindowParam). */
export function windowParam(v: WindowView): string {
  switch (v.kind) {
    case "record":
      return `r/${v.table}/${v.id}`;
    case "edit":
      return `e/${v.table}/${v.id}`;
    case "new": {
      const q = new URLSearchParams(v.prefill).toString();
      return `n/${v.table}${q ? `/${q}` : ""}`;
    }
    case "draft":
      return `draft/${v.id}`;
    case "setup":
      return v.draftId === null ? (v.manual ? "setup/manual" : "setup") : `setup/${v.draftId}/${v.step}`;
    case "work":
      return v.taskId ? `work/${v.taskId}` : "work";
    case "plan":
      return `plan/${v.initiativeId}`;
    case "scenario-summary":
      return `ss/${v.ids.join(",")}`;
    case "resolve":
      return `resolve/${v.missId}`;
  }
}

/** The address of `current` (path and query, any hash dropped) with the window `v` open, or with no window (null). */
export function withWindow(current: string, v: WindowView | null): string {
  const url = new URL(current, "http://localhost");
  if (v) url.searchParams.set(WINDOW_PARAM, windowParam(v));
  else url.searchParams.delete(WINDOW_PARAM);
  const q = url.searchParams.toString();
  return `${url.pathname}${q ? `?${q}` : ""}`;
}

/** Large windows: overviews, editors, the setup, Work through tasks. Medium: the quick view of other records, resolving a miss. */
export function windowSize(v: WindowView): "large" | "medium" {
  if (v.kind === "resolve") return "medium";
  if (v.kind === "record") return (OVERVIEW_TABLES as readonly string[]).includes(v.table) || (TASK_WINDOW_TABLES as readonly string[]).includes(v.table) ? "large" : "medium";
  return "large";
}

/** The address that opens the resolve window for a missed commitment, over the Commitments page. */
export function resolveHref(missId: string): string {
  return `/accountability?${WINDOW_PARAM}=resolve/${missId}`;
}

/** Where Back goes when the window was opened straight at this view (a refresh or a bookmarked link). */
export function parentView(v: WindowView): WindowView | null {
  if (v.kind === "edit") return { kind: "record", table: v.table, id: v.id };
  if (v.kind === "plan") return { kind: "record", table: "initiatives", id: v.initiativeId };
  return null;
}

/** True when two views are the same window (compared by their address). */
export function sameView(a: WindowView | null, b: WindowView | null): boolean {
  return !!a && !!b && windowParam(a) === windowParam(b);
}

/**
 * The window a link opens, or null when the link should go to its page as usual.
 * - On a page (`inWindow` false): record pages of WINDOW_TABLES, scenario pages, initiative drafts (with `?step=` the
 *   setup step), and links marked with data-window.
 * - Inside a window: any record page, `?edit=1` (the editor), `/records/<table>/new?...` (a new record), drafts.
 * Links with a #section and links to other sites are never caught.
 */
export function hrefToView(href: string, opts: { origin?: string; inWindow?: boolean } = {}): WindowView | null {
  let url: URL;
  try {
    url = new URL(href, opts.origin ?? "http://localhost");
  } catch {
    return null;
  }
  if (opts.origin && url.origin !== opts.origin) return null;
  if (url.hash) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const params = url.searchParams;
  // /plan/initiatives/drafts/<id>[?step=<step>]
  if (parts.length === 4 && parts[0] === "plan" && parts[1] === "initiatives" && parts[2] === "drafts" && isId(parts[3])) {
    const step = params.get("step");
    if (isSetupStep(step)) return { kind: "setup", draftId: parts[3], step };
    return [...params.keys()].length ? null : { kind: "draft", id: parts[3] };
  }
  // /plan/scenarios/<id>
  if (parts.length === 3 && parts[0] === "plan" && parts[1] === "scenarios" && isId(parts[2])) {
    return [...params.keys()].length ? null : { kind: "record", table: "scenarios", id: parts[2] };
  }
  if (parts[0] !== "records" || !isTable(parts[1])) return null;
  const table = parts[1];
  // /records/<table>/new?...  (inside a window only)
  if (parts.length === 3 && parts[2] === "new") {
    if (!opts.inWindow || table === "initiatives") return null;
    const prefill: Record<string, string> = {};
    params.forEach((v, k) => {
      if (/^[a-z_]+$/.test(k)) prefill[k] = v;
    });
    return { kind: "new", table, prefill };
  }
  if (parts.length !== 3 || !isId(parts[2])) return null;
  const id = parts[2];
  if (params.get("edit") === "1" && [...params.keys()].length === 1) return opts.inWindow && !getResource(table)?.noEdit ? { kind: "edit", table, id } : null;
  if ([...params.keys()].length) return null;
  if (!opts.inWindow && !(WINDOW_TABLES as readonly string[]).includes(table)) return null;
  return { kind: "record", table, id };
}

/** The full page for a window ("Open full page"). */
export function fullPageHref(v: WindowView): string {
  switch (v.kind) {
    case "record":
      return v.table === "scenarios" ? `/plan/scenarios/${v.id}` : `/records/${v.table}/${v.id}`;
    case "edit":
      return `/records/${v.table}/${v.id}?edit=1`;
    case "new": {
      const q = new URLSearchParams(v.prefill).toString();
      return `/records/${v.table}/new${q ? `?${q}` : ""}`;
    }
    case "draft":
      return `/plan/initiatives/drafts/${v.id}`;
    case "setup":
      return v.draftId ? `/plan/initiatives/drafts/${v.draftId}` : "/plan/start";
    case "work":
      return "/productivity";
    case "plan":
      return `/records/initiatives/${v.initiativeId}`;
    case "scenario-summary":
      return v.ids.length === 1 ? `/plan/scenarios/${v.ids[0]}` : `/plan/scenarios/compare?ids=${v.ids.join(",")}`;
    case "resolve":
      return `/accountability?${WINDOW_PARAM}=resolve/${v.missId}`;
  }
}

// ---------- Step-by-step setup ----------

/** The step after `s` (Save moves on); the last step stays. */
export function nextStep(s: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(s);
  return SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, i + 1)];
}

/** The step before `s`; Describe has none. */
export function previousStep(s: SetupStep): SetupStep | null {
  const i = SETUP_STEPS.indexOf(s);
  return i > 0 ? SETUP_STEPS[i - 1] : null;
}

/** "Step 3 of 8". */
export function stepPosition(s: SetupStep): { index: number; total: number } {
  return { index: SETUP_STEPS.indexOf(s) + 1, total: SETUP_STEPS.length };
}

/** The setup step that holds a review screen field (the summary lines point at field ids such as "g-title-0"). */
export function stepForField(anchor: string): SetupStep {
  if (anchor.startsWith("i-")) return "name";
  if (anchor.startsWith("g-")) return "goals";
  if (anchor.startsWith("m-")) return "milestones";
  if (anchor.startsWith("t-")) return "tasks";
  if (anchor.startsWith("tg-") || anchor.startsWith("b-") || anchor.startsWith("dc-")) return "target";
  if (anchor.startsWith("pd-") || anchor.startsWith("c-")) return "plan";
  return "review";
}

// ---------- Work through tasks ----------

/** Position in the list ("3 of 12") and the task after the current one (null at the end). */
export function workPosition(ids: string[], current: string | null): { index: number; total: number; next: string | null } {
  const total = ids.length;
  const i = current ? ids.indexOf(current) : 0;
  const index = i < 0 ? 0 : i;
  return { index: total ? index + 1 : 0, total, next: index + 1 < total ? ids[index + 1] : null };
}
