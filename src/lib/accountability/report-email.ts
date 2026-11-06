/**
 * The End of day report to a partner (batch C; push B edits, 2026-11-03), pure and tested in
 * src/lib/accountability/report-email.test.ts: the email exactly as it is sent. The header (the small label, the
 * date, the status pill, the hairline), the greeting, then each section the partner gets today
 * (src/lib/accountability/report-sections.ts): number tiles for Today and The week, parent and child bullets for
 * every list section, the bold tomorrow line, and today's note under a section (thin rule on the left); then "Nothing is required from you" and "Thank you, Bram". Inline
 * styles and simple ul/li only, so it reads well in Gmail. The same parts make the report window on End of day, so
 * what Bram reviews is what is sent. The same data makes the plain-text part.
 */
import { barHtml, EMAIL_COLORS, escapeHtml, FONT, pillHtml, type TileStatus } from "@/lib/calc/partner-report";
import { judgedMark, MARK_WORD, type Judged, type ReportTile } from "@/lib/accountability/targets";
import { blocksText, buildSections, parseEdited, sentSections, tilesText, type Block, type BuiltSection, type Line, type ReportChoices, type ReportData } from "@/lib/accountability/report-sections";
import { signOff } from "@/lib/work/names";

export type { ReportData, ReportChoices };

const C = EMAIL_COLORS;
const p = (html: string, extra = "") => `<p style="margin:0 0 8px 0;font-size:14px;line-height:20px;color:${C.ink};${FONT}${extra}">${html}</p>`;
const muted = (text: string) => `<div style="font-size:13px;line-height:18px;color:${C.muted};${FONT}">${escapeHtml(text)}</div>`;

/** The small-caps heading over a section, on a hairline. */
export function headingHtml(text: string): string {
  return `<div style="padding:0 0 4px 0;margin-bottom:8px;border-bottom:1px solid ${C.border};font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;color:${C.text.neutral};${FONT}">${escapeHtml(text)}</div>`;
}

/** One tile: the label, the number with its small part ("3 of 5"), the bar, and the note. */
function tile(t: ReportTile): string {
  const color = t.status === "missed" ? C.text.missed : t.status === "met" ? C.text.met : C.ink;
  return (
    `<div data-tile="1" style="display:inline-block;width:100%;max-width:180px;vertical-align:top;padding:3px;box-sizing:border-box;text-align:left">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${C.border};border-radius:8px;background-color:#ffffff"><tr><td style="padding:8px 10px;${FONT}">` +
    `<div style="font-size:12px;line-height:16px;color:${C.muted}">${escapeHtml(t.label)}</div>` +
    `<div style="font-size:19px;line-height:24px;font-weight:bold;white-space:nowrap;color:${color}">${escapeHtml(t.value)}${t.small ? ` <span style="font-size:12px;font-weight:normal;color:${C.muted}">${escapeHtml(t.small)}</span>` : ""}</div>` +
    (t.pct !== null ? barHtml(t.pct, t.status) : "") +
    (t.note ? `<div style="font-size:11px;line-height:15px;color:${C.muted}">${escapeHtml(t.note)}</div>` : "") +
    `</td></tr></table></div>`
  );
}

function tilesHtml(list: readonly ReportTile[]): string {
  return `<div style="font-size:0;line-height:0;text-align:left;margin:0 -3px">${list.map(tile).join("")}</div>`;
}

const TONE: Record<string, string> = { red: C.text.missed, amber: C.text.soon, green: C.text.met };

function lineHtml(l: Line): string {
  return `${l.lead ? `<b>${escapeHtml(l.lead)}:</b> ` : ""}${l.label ? `<span style="color:${C.muted}">${escapeHtml(l.label)}:</span> ` : ""}${escapeHtml(l.text)}${l.todo ? `<span style="color:${C.text.soon}">${escapeHtml(l.todo)}</span>` : ""}`;
}

const UL = `margin:2px 0 0 0;padding:0 0 0 18px;list-style-type:disc;font-size:13px;line-height:19px;color:${C.ink};${FONT}`;
const LI = "margin:0 0 2px 0";

/** Parent and child bullets: the parent line in bold (red, amber, green, or ink), its children as a simple list. */
export function blocksHtml(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      const title = b.title ? `<div style="font-size:13px;line-height:19px;font-weight:bold;color:${b.tone ? TONE[b.tone] : C.ink};${FONT}">${escapeHtml(b.title)}</div>` : "";
      const items = b.items.length ? `<ul style="${UL}">${b.items.map((it) => `<li style="${LI}">${lineHtml(it.line)}${it.sub?.length ? `<ul style="${UL};margin-top:1px;list-style-type:circle;color:${C.muted}">${it.sub.map((s) => `<li style="${LI}">${lineHtml(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>` : "";
      return `<div style="margin:0 0 8px 0">${title}${items}</div>`;
    })
    .join("");
}

/** A section as rewritten with Edit: lines starting with "- " become bullets (indent for a level deeper). */
export function editedHtml(text: string): string {
  const lines = parseEdited(text);
  let html = "";
  let open = 0;
  const close = (to: number) => {
    while (open > to) {
      html += "</li></ul>";
      open--;
    }
  };
  lines.forEach((l, i) => {
    if (!l.bullet) {
      close(0);
      const parent = lines[i + 1]?.bullet;
      html += `<div style="font-size:13px;line-height:19px;${parent ? "font-weight:bold;margin-top:4px;" : "margin:0 0 4px 0;"}color:${C.ink};${FONT}">${escapeHtml(l.text)}</div>`;
      return;
    }
    if (l.depth > open) {
      while (open < l.depth) {
        html += `<ul style="${UL}${open ? `;color:${C.muted}` : ""}"><li style="${LI}">`;
        open++;
      }
    } else {
      close(l.depth);
      html += `</li><li style="${LI}">`;
    }
    html += escapeHtml(l.text);
  });
  close(0);
  return html;
}

/** The body of a section as sent (no heading): its edited text, its tiles or lists, or its line. */
export function sectionBodyHtml(s: BuiltSection): string {
  if (s.edited) return editedHtml(s.edited);
  if (s.kind === "tiles") return s.tiles.length ? tilesHtml(s.tiles) : muted("Nothing shown in this section today.");
  if (s.kind === "line") return s.line ? `<div style="font-size:14px;line-height:20px;font-weight:bold;color:${C.ink};${FONT}">${escapeHtml(s.line)}</div>` : `<div style="font-size:13px;line-height:18px;color:${C.text.soon};${FONT}">(no line yet)</div>`;
  if (s.blocks.length) return blocksHtml(s.blocks);
  return muted(s.quiet ?? "Nothing shown in this section today.");
}

/**
 * Today's note under a section ("+ Note", 2026-11-05): the user's own words, set off with a rule on the left, line
 * breaks kept. Fix list item 6 (approved 2026-11-06): the normal dark reading color (not muted) and a cobalt left line,
 * slightly thicker (3px). The same HTML in the email, the report window, and every re-shown sent report.
 */
export function noteHtml(note: string | null | undefined): string {
  const t = String(note ?? "").trim();
  if (!t) return "";
  return `<div data-note="1" style="margin:6px 0 8px 0;padding:2px 0 2px 10px;border-left:3px solid ${C.cobalt};font-size:13px;line-height:19px;color:${C.ink};${FONT}">${escapeHtml(t).replace(/\n/g, "<br>")}</div>`;
}

/** The note in the plain-text part: each line after "| ", the same rule on the left. */
export function noteText(note: string | null | undefined): string {
  const t = String(note ?? "").trim();
  return t ? t.split("\n").map((l) => (l.trim() ? `| ${l}` : "|")).join("\n") : "";
}

/** The header: "Daily report" (or "Daily report, with the week"), the date, the status pill. */
export function headerHtml(d: ReportData): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
    `<td valign="middle" style="padding:0 0 10px 0;${FONT}"><div style="font-size:12px;line-height:16px;color:${C.muted}">${d.withWeek ? "Daily report, with the week" : "Daily report"}</div>` +
    `<div style="font-size:18px;line-height:24px;font-weight:bold;color:${C.ink}">${escapeHtml(d.dateLong)}</div></td>` +
    `<td valign="middle" align="right" style="padding:0 0 10px 0;${FONT}">${pillHtml(d.pill)}</td>` +
    `</tr><tr><td colspan="2" style="height:1px;line-height:1px;font-size:0;background-color:${C.rule}">&nbsp;</td></tr></table>`
  );
}

export function greetingHtml(d: ReportData): string {
  return p(`Hello ${escapeHtml(d.partnerFirst)},`, ";margin-top:12px;margin-bottom:2px") + p(`Here is my report for ${escapeHtml(d.dateShort)}.${d.withWeek ? " It is Friday, so the week is at the end." : ""}`);
}

/** The closing; the name under "Thank you," is the Name in Settings (fix list item 10), none when not set. */
export function closingHtml(signName?: string | null): string {
  return p("Nothing is required from you. Reply to this email if you want to talk.", `;color:${C.muted};font-size:13px;margin-top:4px`) + p(signName ? `Thank you,<br>${escapeHtml(signName)}` : "Thank you,", ";margin-bottom:0");
}

/** The inner card of the email (what is sent, and what Sent reports shows): the sections this partner gets today. */
export function reportInnerHtml(d: ReportData): string {
  const row = (inner: string, pad: string) => `<tr><td style="padding:${pad}">${inner}</td></tr>`;
  const parts = [row(headerHtml(d), "16px 20px 0 20px"), row(greetingHtml(d), "0 20px 0 20px")];
  for (const s of sentSections(d)) parts.push(row(headingHtml(s.title) + sectionBodyHtml(s) + noteHtml(s.note), "8px 20px 4px 20px"));
  parts.push(row(closingHtml(d.signName), "10px 20px 18px 20px"));
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#ffffff;border:1px solid ${C.border};border-radius:10px">${parts.join("")}</table>`;
}

export function reportSubject(d: ReportData): string {
  return `${d.withWeek ? "Daily report with the week" : "Daily report"}: ${d.dateLong}`;
}

/** The plain-text part, from the same sections. */
export function reportText(d: ReportData): string {
  const lines: string[] = [`Hello ${d.partnerFirst},`, "", `Here is my report for ${d.dateShort}.${d.withWeek ? " It is Friday, so the week is at the end." : ""}`, `${d.pill.text}.`];
  for (const s of sentSections(d)) {
    lines.push("", s.title.toUpperCase());
    if (s.edited) lines.push(s.edited.trim());
    else if (s.kind === "tiles") lines.push(tilesText(s.tiles).split("\n").map((x) => `- ${x}`).join("\n"));
    else if (s.kind === "line") lines.push(s.line || "(no line yet)");
    else lines.push(s.blocks.length ? blocksText(s.blocks) : (s.quiet ?? ""));
    if (s.note) lines.push("", noteText(s.note));
  }
  lines.push("", "Nothing is required from you. Reply to this email if you want to talk.", "", ...signOff("Thank you", d.signName).split("\n"));
  return lines.join("\n");
}

/**
 * "Listings screened: 3 of 5 today, 8 of 10 this week" as a target's line in the report. The week's number is the
 * target times the weekdays counted so far (less a skipped day), as on Targets: on a Wednesday "13 of 15", on Friday
 * "19 of 25". The Rosara focus reads "Rosara focus: done" or "not yet".
 */
export function targetLine(j: Judged, weekSum: number | null, countedDays = 5): string {
  if (j.key === "rosara_focus_done") return `${j.name.replace(/\s+done$/i, "")}: ${j.met ? "done" : j.judged ? "not done" : "not yet"}`;
  const base = `${j.name}: ${j.figure}`;
  return j.cadence === "day" && weekSum !== null ? `${base} today, ${weekSum} of ${j.number * Math.max(1, countedDays)} this week` : base;
}

/** The group a judged target sits in: Met, Missed, or Under way (Edit batch C round 2, item 7). */
export function targetGroup(j: { met: boolean; judged: boolean }): "met" | "missed" | "now" {
  return judgedMark(j);
}

export { MARK_WORD };

/** "3 of 6 targets met" (Friday) or "Listings screened met" / "2 targets missed" for the pill. */
export function pillOf(judged: readonly Judged[], withWeek: boolean): { text: string; status: TileStatus } {
  const today = judged.filter((j) => j.judged);
  if (!today.length) return { text: "No targets judged today", status: "neutral" };
  const met = today.filter((j) => j.met).length;
  if (withWeek || today.length > 1) return { text: `${met} of ${today.length} targets met`, status: met === today.length ? "met" : "missed" };
  return { text: `${today[0].name} ${today[0].met ? "met" : "missed"}`, status: today[0].met ? "met" : "missed" };
}

/** One partner's copy of the day's report (push B): their name in the greeting, their standing sections, today's choices. */
export function reportFor(base: ReportData, partner: { name: string; first: string; sections: readonly string[] }, choices?: ReportChoices | null): ReportData {
  return { ...base, partnerName: partner.name, partnerFirst: partner.first, sections: [...partner.sections], choices: choices ?? null };
}

export { buildSections, sentSections };
