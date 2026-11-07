import { Suspense } from "react";
import { TimingNote } from "@/components/app/timing-note";
import { KeptSettingsCheck, startKeptReads } from "@/components/app/kept-settings";
import { requireOwner } from "@/lib/auth";
import { installTiming, requestTiming, settled, timingLine, TIMING_ON } from "@/lib/timing";

/**
 * Wraps every page (built again on each visit, unlike the layout). On the preview only, it adds the page speed line at
 * the bottom (src/lib/timing.ts, Bram 2026-11-06). Production shows the page alone.
 */
export default async function AppTemplate({ children }: { children: React.ReactNode }) {
  // Speed plan (2026-11-07): after the page, the settings kept in the browser are checked (kept-settings.tsx); the
  // check's reads start now, so they go in the page's own trip.
  const owner = await requireOwner();
  for (const p of startKeptReads(owner.supabase, owner.ownerId)) Promise.resolve(p).catch(() => {});
  const check = (
    <Suspense fallback={null}>
      <KeptSettingsCheck />
    </Suspense>
  );
  if (!TIMING_ON) return (
    <>
      {children}
      {check}
    </>
  );
  installTiming();
  requestTiming();
  return (
    <>
      {children}
      {check}
      <Suspense fallback={null}>
        <TimingLine />
      </Suspense>
    </>
  );
}

async function TimingLine() {
  const r = requestTiming();
  await settled(r);
  return <TimingNote text={timingLine(r)} />;
}
