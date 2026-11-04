import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTabCounts } from "@/lib/work/data";
import { loadOutreach } from "@/lib/work/outreach-data";
import { loadOrganizations } from "@/lib/work/organizations-data";
import { parseTicks } from "@/lib/filters";
import { CONTACTS_LABEL, parsePeopleView, peopleViewHref } from "@/lib/work/people";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { PeopleBoard } from "@/components/app/work/people-board";
import { WorkShell } from "@/components/app/work/shell";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contacts" };

/**
 * Contacts (push B, 2026-11-03; Outreach renamed People, then Contacts in the Push B edits): the title with Add a
 * person (or Add an organization on the Organizations view) and Ask AI, the view choice under it, the top menu row
 * under 1024px, then three views: Follow-ups
 * (today's working list, what Outreach was), People (every person A to Z), Organizations. The views and the Filter
 * window are in src/components/app/work/people-board.tsx. "?view=people" (or the old "?view=everyone") or
 * "?view=orgs" picks a view; "?ff=", "?fp=", "?fo=" keep each view's ticks; the old "?role=<role>" ticks that role on
 * People; "?add=1" opens the add form of the view; "?saved=<name>" shows the Saved line.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ view?: string; add?: string; saved?: string; role?: string; ff?: string; fp?: string; fo?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const view = parsePeopleView(sp.view);
  const ctx = await loadCtx(supabase, ownerId);
  const [tabs, d, orgs] = await Promise.all([loadTabCounts(supabase, ownerId, ctx.today), loadOutreach(supabase, ctx), loadOrganizations(supabase, ctx)]);
  const adding = sp.add === "1";
  const roleTick = sp.role && /^[a-z_]{1,40}$/.test(sp.role) ? { role: [sp.role] } : null;
  const ticks = { follow: parseTicks(sp.ff), people: roleTick && !sp.fp ? roleTick : parseTicks(sp.fp), orgs: parseTicks(sp.fo) };
  const here = peopleViewHref(view);
  const addHref = `${here}${here.includes("?") ? "&" : "?"}add=1`;
  const addButton = (
    <Link href={adding ? here : addHref} className={cn("inline-flex h-9 items-center rounded-[7px] border px-3.5 text-[13px] font-medium whitespace-nowrap", adding ? "border-input bg-white text-slate-800 hover:bg-slate-50" : "border-primary-solid bg-primary-solid text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover")} data-testid={view === "orgs" ? "add-org-button" : "add-person-button"}>
      {adding ? "Close the form" : view === "orgs" ? "Add an organization" : "Add a person"}
    </Link>
  );
  return (
    <WorkShell testId="work-people">
      <PeopleBoard view={view} data={d} orgs={orgs} adding={adding} saved={sp.saved ?? null} ticks={ticks} addButton={addButton} askAi={<AskAiPill context={{ page: "outreach", label: CONTACTS_LABEL }} />} tabs={<WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} className="mt-3 mb-0 border-b border-border" />} />
    </WorkShell>
  );
}
