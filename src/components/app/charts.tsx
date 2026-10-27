"use client";

import { CHART_STATUS } from "@/lib/status";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Series = { key: string; label: string; color: string };

const fmtMoney = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `${Math.round(a / 1000)}K` : `${Math.round(a)}`;
  return `${v < 0 ? "-" : ""}$${s}`;
};
const fmtFull = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : String(v);

export function LineSeriesChart({ data, xKey, series, height = 220, zeroLine = false }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; zeroLine?: boolean }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tickFormatter={fmtMoney} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={56} />
          <Tooltip formatter={(v) => fmtFull(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          {zeroLine ? <ReferenceLine y={0} stroke={CHART_STATUS.negative} strokeDasharray="4 4" /> : null}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarSeriesChart({ data, xKey, series, height = 220, valueFormat = "money" }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; valueFormat?: "money" | "count" }) {
  const tick = valueFormat === "money" ? fmtMoney : (v: number) => String(v);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={tick} allowDecimals={valueFormat === "money"} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={56} />
          <Tooltip formatter={(v) => (valueFormat === "money" ? fmtFull(v) : String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

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
