import { Suspense } from "react";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { MobileModuleBar, SidebarLinks } from "@/components/app/nav-links";
import { signOut } from "@/app/actions/auth";
import { UnsavedChangesGuard } from "@/components/app/unsaved-changes";
import { countToScreen } from "@/lib/work/data";
import { countOutreachDue } from "@/lib/work/outreach-data";
import { todayInTz } from "@/lib/calc/dates";
import { loadEodBadge } from "@/lib/accountability/data";
import { installTiming, requestTiming, TIMING_ON } from "@/lib/timing";
import { keptSettings } from "@/lib/kept-settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Page speed line, preview only (2026-11-06): start the clock before the first lookup of a full page load.
  if (TIMING_ON) {
    installTiming();
    requestTiming();
  }
  const { supabase, user, ownerId } = await requireOwner();
  // Speed plan (2026-11-07): with the time zone kept in the browser (src/lib/kept-settings.ts), the three badges are
  // read at once; without it, the time zone is read first, as before.
  const kept = await keptSettings(ownerId);
  const tz = kept ? kept.tz : String(((await supabase.from("owner_profile").select("timezone").eq("owner_id", ownerId).maybeSingle()).data as { timezone?: string | null } | null)?.timezone || "America/New_York");
  const today = todayInTz(tz);
  // Listings to screen (the badge under Work); people due today or overdue on Outreach (the amber badge; null before
  // database update 0022); the End of day badge under Accountability (batch C: 5:30 until the day is closed, then Sent
  // or Skipped; null before database update 0025).
  const [toScreen, outreachDue, eodBadge] = await Promise.all([countToScreen(supabase, ownerId), countOutreachDue(supabase, ownerId, today), loadEodBadge(supabase, ownerId, today)]);
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-white px-3 py-4 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-3 text-base font-semibold tracking-tight text-slate-900">
          <span aria-hidden className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-primary" />
          BF Personal App
        </Link>
        <SidebarLinks toScreen={toScreen} outreachDue={outreachDue} eodBadge={eodBadge} />
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <form action={signOut}>
            <button className="w-full rounded-md px-3 py-2 text-left text-slate-500 hover:bg-slate-100">Sign out ({user.email})</button>
          </form>
        </div>
      </aside>
      {/* Under 1024px this header scrolls away with the page; the slim pinned bar of each page takes the top (2026-11-04). */}
      <header className="no-print border-b border-border bg-white pt-3 lg:hidden">
        <div className="mb-2 flex items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden className="h-2 w-2 rotate-45 rounded-[1px] bg-primary" />
            BF Personal App
          </Link>
        </div>
        <MobileModuleBar />
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 pt-6 pb-24 sm:px-6 lg:px-8">{children}</main>
      <Suspense fallback={null}>
        <UnsavedChangesGuard />
      </Suspense>
    </div>
  );
}
