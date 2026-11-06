/**
 * The Ask AI pieces of batch C, pure and tested: the prompt and the strict check for "Draft the reasons for the missed
 * commitments" (one line per missed Commitment, from what the day shows), and the page context lines of Targets, End
 * of day, and Reports (what the AI reads; nothing more).
 */
import type { EndOfDayPage, ReportsPage, TargetsPage } from "@/lib/accountability/data";
import { judgedMark, MARK_WORD, type Judged } from "@/lib/accountability/targets";

export type ReasonDraft = { targetId: string; name: string; reason: string };

const REASON_MAX = 200;

/** The lines the AI reads about a day: the counted facts, the judged targets, the open waits. */
export function endOfDayLines(p: EndOfDayPage): string[] {
  const n = p.numbers;
  const lines: string[] = [
    `day: ${p.dateLabel}${p.friday ? " (Friday: the week is judged tonight)" : ""}`,
    `listings screened: ${n.screened.value}${n.screened.detail ? ` (${n.screened.detail})` : ""}`,
    `deals moved: ${n.moves.length}${n.moves.length ? ` (${n.moves.map((m) => `${m.name} to ${m.to}${m.keyFinding ? `, key finding: ${m.keyFinding}` : ""}`).join("; ")})` : ""}`,
    `calls: ${n.calls.value}${n.calls.detail ? ` (${n.calls.detail})` : ""}; emails: ${n.emails.value}${n.emails.detail ? ` (${n.emails.detail})` : ""}`,
    `network outreach: ${n.outreachToday.value} today, ${n.outreachWeek.value} this week`,
    `next actions done: ${n.actionsDone.value}${n.actionsByArea?.length ? ` (by area: ${n.actionsByArea.map((a) => `${a.area} ${a.count}`).join(", ")})` : ""}${n.actionsDone.detail ? ` (${n.actionsDone.detail})` : ""}`,
    `to-dos done: ${n.todosDone?.value ?? 0}`,
    ...n.waits.map((w) => `${w.kind === "person" ? "waiting on person" : "waiting on broker"}: ${w.name}, ${w.days} days${w.who ? `, ${w.who}` : ""}${w.what ? `, for ${w.what}` : ""}`),
    ...p.judged.map((j) => `target: ${j.name} | ${j.line} | ${MARK_WORD[judgedMark(j)].toLowerCase()} ${j.figure}${j.commitment ? " | commitment" : ""}${p.reasons[j.targetId] ? ` | reason given: ${p.reasons[j.targetId]}` : ""}`),
    `tomorrow line: ${p.tomorrow.trim() || "(empty)"}`,
  ];
  return lines;
}

export function targetsLines(p: TargetsPage): string[] {
  return [
    `week: ${p.weekLabel}; ${p.targets.length} targets, ${p.commitments} commitments`,
    ...p.targets.map((t) => `target: ${t.name} | ${t.line} | ${t.figures[0].label.toLowerCase()} ${t.figures[0].value}, ${t.figures[1].label.toLowerCase()} ${t.figures[1].value} | ${MARK_WORD[t.mark].toLowerCase()} | ${t.strip.text}${t.commitment ? " | commitment" : ""}`),
    ...p.past.map((w) => `past week of ${w.weekStart}: ${w.met} of ${w.total} met${w.missed.length ? `; missed ${w.missed.map((m) => `${m.name} ${m.figure}`).join(", ")}` : ""}`),
    ...(p.mostMissed ? [`most missed: ${p.mostMissed.name}, ${p.mostMissed.n} of the last ${p.mostMissed.of} weeks`] : []),
  ];
}

export function reportsLines(p: ReportsPage): string[] {
  const lines: string[] = [];
  for (const per of p.periods) {
    lines.push(`period ${per.label}: ${per.tiles.map((t) => `${t.label} ${t.value}${t.small ? ` ${t.small}` : ""}${t.note ? ` (${t.note})` : ""}`).join("; ")}`);
    for (const t of per.targets) lines.push(`${per.label}, target: ${t.name} ${t.figure} ${t.met ? "met" : "missed"} | ${t.line}`);
    for (const m of per.moves.slice(0, 8)) lines.push(`${per.label}, deal moved: ${m.name} | ${m.line} | ${m.when}`);
  }
  for (const w of p.periods[0]?.waits ?? []) lines.push(`waiting on broker: ${w.name}, ${w.days} days${w.who ? `, ${w.who}` : ""}`);
  for (const s of p.sent) for (const r of s.rows.slice(0, 6)) lines.push(`sent report: ${r.title} | ${r.state}${r.sentTime ? ` ${r.sentTime}` : ""} | ${r.summary}${r.reviewedTime ? ` | reviewed ${r.reviewedTime}` : ""}${r.to.length ? ` | to ${r.to.map((t) => t.name).join(", ")}` : ""}${r.replies.map((x) => ` | reply from ${x.name}: ${x.text}`).join("")}`);
  return lines;
}

/** "Draft the reasons for the missed commitments": one honest line per target, in Bram's voice, from the day's facts. */
export function reasonsPrompt(p: EndOfDayPage, asked: readonly Judged[]): string {
  return [
    "TASK: eod_reasons",
    "The signed-in user's End of day asks for one reason per missed commitment. Write each reason as one plain line (at most 25 words) in the user's own voice, first person, naming what took the time from what the day shows (calls, deals moved, waits) and what carries to the next working day. No excuses, no apologies, no hedging words.",
    "",
    `Page: End of day, ${p.dateLabel}`,
    "What is on the page (one line each):",
    ...endOfDayLines(p).map((l) => `- ${l}`),
    "",
    `The missed commitments to write for: ${asked.map((j) => `${j.name} (${j.figure}; id ${j.targetId})`).join("; ")}`,
    "",
    'Return only JSON: {"reasons": [{"target_id": "<id>", "reason": "<one line>"}, ...]}',
  ].join("\n");
}

/** The reply: one reason per asked target (matched by id, or by name, or in order), each a clean line. */
export function validateReasonsReply(value: unknown, asked: readonly Judged[]): { ok: true; value: ReasonDraft[] } | { ok: false; error: string } {
  const v = value as { reasons?: unknown; items?: unknown } | null;
  const raw = Array.isArray(v) ? v : Array.isArray(v?.reasons) ? v!.reasons : Array.isArray(v?.items) ? v!.items : null;
  if (!raw) return { ok: false, error: 'the reply needs a "reasons" array of {target_id, reason}' };
  const out: ReasonDraft[] = [];
  const used = new Set<string>();
  raw.forEach((item: unknown) => {
    const o = (item && typeof item === "object" ? item : { reason: item }) as { target_id?: unknown; targetId?: unknown; name?: unknown; target?: unknown; reason?: unknown };
    const text = typeof o.reason === "string" ? o.reason : typeof item === "string" ? item : "";
    const line = text.replace(/\s+/g, " ").trim().slice(0, REASON_MAX);
    if (!line) return;
    const id = String(o.target_id ?? o.targetId ?? "");
    const name = String(o.name ?? o.target ?? "").toLowerCase();
    const t = asked.find((j) => j.targetId === id) ?? asked.find((j) => name && (j.name.toLowerCase() === name || name.startsWith(j.name.toLowerCase()))) ?? asked.filter((j) => !used.has(j.targetId))[0] ?? null;
    if (!t || used.has(t.targetId)) return;
    used.add(t.targetId);
    out.push({ targetId: t.targetId, name: t.name, reason: line });
  });
  if (!out.length) return { ok: false, error: "no reason came back" };
  return { ok: true, value: out };
}
