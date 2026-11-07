import { Suspense } from "react";
import { TimingNote } from "@/components/app/timing-note";
import { installTiming, requestTiming, settled, timingLine, TIMING_ON } from "@/lib/timing";

/**
 * Wraps every page (built again on each visit, unlike the layout). On the preview only, it adds the page speed line at
 * the bottom (src/lib/timing.ts, Bram 2026-11-06). Production shows the page alone.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  if (!TIMING_ON) return children;
  installTiming();
  requestTiming();
  return (
    <>
      {children}
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
