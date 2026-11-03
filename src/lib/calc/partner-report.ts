













// ---------- Tiles ----------

export type TileStatus = "met" | "soon" | "missed" | "neutral";

const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));








type Overall = { onTrack: number; total: number; status: TileStatus; text: string };



// ---------- One report section per template ----------








// ---------- Plain text part ----------
// ---------- HTML part (email-safe: tables, inline styles, no images, no scripts) ----------

/** Status colors for email (the same values as the app's status tokens). */
export const EMAIL_COLORS = {
  bar: { met: "#16a34a", soon: "#f59e0b", missed: "#dc2626", neutral: "#94a3b8" } as Record<TileStatus, string>,
  text: { met: "#15803d", soon: "#b45309", missed: "#b91c1c", neutral: "#334155" } as Record<TileStatus, string>,
  tint: { met: "#ecfdf5", soon: "#fffbeb", missed: "#fef2f2", neutral: "#f8fafc" } as Record<TileStatus, string>,
  track: "#e2e8f0",
  rule: "#d5dbe3",
  ink: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  link: "#1e40af",
  cobalt: "#1e40af",
};

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const FONT = "font-family:Arial,Helvetica,sans-serif";

/** A progress bar as two table cells (filled and empty) with background colors: works in every email app. */
export function barHtml(pct: number | null, status: TileStatus): string {
  const p = pct === null ? 0 : clampPct(pct);
  const fill = p > 0 ? `<td width="${p}%" style="width:${p}%;height:4px;line-height:4px;font-size:0;background-color:${EMAIL_COLORS.bar[status]};border-radius:2px">&nbsp;</td>` : "";
  const rest = p < 100 ? `<td style="height:4px;line-height:4px;font-size:0;background-color:${EMAIL_COLORS.track}">&nbsp;</td>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 4px 0"><tr>${fill}${rest}</tr></table>`;
}



export function pillHtml(o: Pick<Overall, "status" | "text">): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${EMAIL_COLORS.tint[o.status]};border:1px solid ${EMAIL_COLORS.bar[o.status]};color:${EMAIL_COLORS.text[o.status]};font-size:13px;line-height:18px;font-weight:bold;white-space:nowrap;${FONT}"><span style="color:${EMAIL_COLORS.bar[o.status]}">&#9679;</span>&nbsp;${escapeHtml(o.text)}</span>`;
}







