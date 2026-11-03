"use client";




/** Simple horizontal progress bar with an accessible label. */
export function Progress({ value, tone = "primary" }: { value: number | null; tone?: "primary" | "green" | "amber" | "red" }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = tone === "red" ? "bg-status-missed-solid" : tone === "amber" ? "bg-status-soon-solid" : tone === "green" ? "bg-status-met-solid" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}
