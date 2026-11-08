"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, Loader2 } from "lucide-react";
import { approveAndSend, saveReasons, saveTomorrow, saveWeeklyReview, setPartnerToday, skipToday, putShortReport } from "@/app/actions/accountability";
import type { ReasonDraft } from "@/lib/accountability/ask-ai";
import type { EndOfDayPage } from "@/lib/accountability/data";
import { dueLine, getsLabel, sendLabel } from "@/lib/accountability/partners";
import { includesLine, REVIEW_QUESTIONS, reviewAnswered, sentSections, type WeeklyReview } from "@/lib/accountability/report-sections";
import { PARTNER_BOX, ReportWindow } from "@/components/app/work/report-window";
import { NO_RECIPIENTS, RecipientPicker, recipientCount, recipientsTo, SendReportButton, type Recipients } from "@/components/app/work/send-report";
import { sendReport, sendReportSetup, type SendReportPerson } from "@/app/actions/send-report";
import { DONE_AREAS, judgedMark, MARK_WORD, owedReasons, sendChecklist, todayStrip, type DayNumbers, type Judged, type TodayPart } from "@/lib/accountability/targets";
import type { AskContext } from "@/lib/work/ask-ai";
import { AccountabilityTabs, type EodBadge } from "@/components/app/nav-links";
import { AiCardStar, AiFieldStar, AskAiPill, type EodExtras } from "@/components/app/work/ask-ai";
import { StatusMark } from "@/components/app/work/targets-ui";
import { Drawer } from "@/components/app/work/drawer";
import { Confirm, Figure, Line1, Line2, Name, Pill, PinnedBlock, ROW_GRIDS, RowButton, Rows, WorkCard, WorkHeader } from "@/components/app/work/ui";
import { eodCountdown, minutesLeftWords } from "@/lib/work/settings";
import { personHref } from "@/lib/work/people";
import { cn } from "@/lib/utils";

/**
 * End of day (batch C, approved 2026-10-31; Edit batch C items 9 to 12; push B edits 2026-11-03). Two columns at desktop
 * width (the right one about 40% of the width; stacked on the phone), their tops level. Left, what Bram does: the
 * Today tiles (hybrid of 2026-11-05, Option A: white tiles with no label above them, the TODAY label gone 2026-11-05, a big number over a small-caps
 * label, 4 a row on desktop and 2 on the phone, Next actions done two tiles wide with its area split; a zero is light
 * gray, Waiting red above 0), each tile opening a small drawer with the items behind it; the Targets card with the status mark, the Commitment
 * pill, and a one-line reason box on each missed Commitment (the field star drafts it; "Same reason for all" fills
 * every box), with reasons owed from a skipped day under their own heading. Right: the "Report to Jake" card (hybrid of
 * 2026-11-05, Option B): the "Before you send" checklist (Reasons, Fridays the Weekly review, Tomorrow's line, each
 * row a circle that turns into a green check, a click scrolling to its card and outlining it for a moment, "N of M
 * done" at the right), View report, Approve and send, Edit, Skip today, then a Partner | Gets | Sections table (View
 * shows a partner's sections as a list); then "What matters tomorrow". View report opens the report window (src/components/app/work/report-window.tsx) with
 * the email exactly as it will be sent and the include box, Change, and Edit on each section. Approve and send works
 * from the card or the window, with the same check for missing reasons.
 *
 * Push D (approved 2026-11-04): on Fridays a Weekly review card under Targets asks three questions (What went well
 * this week, What slipped, Next week's focus); each answer saves when the box loses focus, goes into Friday's report
 * as the Weekly review section (include, Change, Edit like every section), and the checklist counts them (2 of 3).
 */
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const FIG = "w-[82px]";
const GRID = ROW_GRIDS.eodTarget;
/**
 * The partner table on the report card: the checkbox (fix list item 1, 2026-11-06), Partner | Gets | Sections | View,
 * the columns the same on every row.
 */
const PT_ROW = "grid grid-cols-[16px_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_44px] items-center gap-3";
const BTN_LG = "inline-flex h-[38px] w-full min-w-0 shrink-0 min-[421px]:w-auto min-[421px]:flex-1 min-[421px]:basis-0 items-center justify-center gap-2 rounded-[7px] border px-4 text-sm font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50";

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

/** "Jake", "Jake and Sarah", "Jake, Sarah and Ann". */
const andNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function EndOfDayBoard({ data }: { data: EndOfDayPage }) {
  const router = useRouter();
  const { day } = data;
  // Push B: one copy per partner due today (their own sections); the window has a tab per copy.
  const copies = data.copies;
  const [sel, setSel] = useState<string | null>(copies[0]?.partner.id ?? null);
  const copy = copies.find((c) => c.partner.id === sel) ?? copies[0] ?? null;
  const partner = copy?.partner ?? null;
  const first = partner?.first ?? "your partner";
  // Fix list item 1: the partners unticked for today (one setting for the card and the window), read again whenever
  // the page brings back a different set from the server.
  const serverSkipped = copies.filter((c) => c.skipped).map((c) => c.partner.id).join(",");
  const [seenSkipped, setSeenSkipped] = useState(serverSkipped);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set(serverSkipped ? serverSkipped.split(",") : []));
  if (seenSkipped !== serverSkipped) {
    setSeenSkipped(serverSkipped);
    setSkippedIds(new Set(serverSkipped ? serverSkipped.split(",") : []));
  }
  const ticked = (id: string) => !skippedIds.has(id);
  const unsent = copies.filter((c) => !c.sentAt && ticked(c.partner.id));
  const toNames = (list: typeof copies) => andNames(list.map((c) => c.partner.first));
  const [reasons, setReasons] = useState<Record<string, string>>(data.reasons);
  const [tomorrow, setTomorrow] = useState(data.tomorrow);
  const [review, setReview] = useState<WeeklyReview>({ well: data.review?.well ?? "", slipped: data.review?.slipped ?? "", focus: data.review?.focus ?? "" });
  const [state, setState] = useState<{ status: EndOfDayPage["state"]; sentTime: string | null; skipReason: string | null }>({ status: data.state, sentTime: data.sentTime, skipReason: data.skipReason });
  const [windowOpen, setWindowOpen] = useState<false | "view" | "edit">(false);
  const [resetKey, setResetKey] = useState(0);
  const [shared, setShared] = useState(false);
  const [sharedText, setSharedText] = useState("");
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipWhy, setSkipWhy] = useState("");
  const [check, setCheck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sending, startSend] = useTransition();
  const [focused, setFocused] = useState<string | null>(null);
  /** The Today strip part whose drawer is open. */
  const [drawer, setDrawer] = useState<TodayPart | null>(null);
  const requestId = useRef(newRequestId());
  // "Also send to" (Bram, 2026-11-08): more people for today's send, for today only; they get the copy of the partner
  // whose tab is open in the review window, right after Approve and send.
  const [also, setAlso] = useState<Recipients>(NO_RECIPIENTS);
  const [alsoOpen, setAlsoOpen] = useState(false);
  const [alsoPeople, setAlsoPeople] = useState<SendReportPerson[] | null>(null);
  const [alsoError, setAlsoError] = useState<string | null>(null);
  const alsoRequest = useRef(newRequestId());
  const alsoCount = recipientCount(also);
  const alsoNames = andNames([...also.chosen.map((id) => alsoPeople?.find((p) => p.id === id)?.name ?? "a contact"), ...also.fresh.map((f) => f.name || f.email)]);
  const openAlso = () => {
    setAlsoOpen((o) => !o);
    if (!alsoPeople) sendReportSetup().then((r) => (r.ok ? setAlsoPeople(r.people) : setAlsoError(r.error)));
  };
  const tomorrowRef = useRef<HTMLTextAreaElement>(null);
  const closed = state.status !== "open";
  const judged = data.judged;
  const asked = useMemo(() => judged.filter((j) => j.judged && !j.met && j.commitment), [judged]);
  const owedPrev = data.owed;
  const owedKey = (j: Judged) => `owed:${owedPrev!.day}:${j.targetId}`;
  const owedLeft = owedReasons(judged, reasons).length + (owedPrev ? owedPrev.items.filter((j) => !String(reasons[owedKey(j)] ?? "").trim()).length : 0);
  const met = judged.filter((j) => j.judged && j.met).length;
  const judgedCount = judged.filter((j) => j.judged).length;
  const badge: EodBadge = state.status === "sent" ? "Sent" : state.status === "skipped" ? "Skipped" : data.eodTime.short;
  /** The weekly review day's name (the review card shows on that day only; Friday unless changed in Settings). */
  const dayWord = data.dateLabel.split(",")[0];
  const checks = sendChecklist(owedLeft, tomorrow, data.tomorrowLabel, data.review ? reviewAnswered(review) : null);
  const checksDone = checks.filter((c) => c.done).length;
  /** The partner whose sections show under the table (View). */
  const [openPartner, setOpenPartner] = useState<string | null>(null);
  const page: AskContext = { page: "end_of_day", label: `End of day, ${data.dateLabel}` };
  // What is still missing before sending: the reasons and the tomorrow line.
  const needs = [owedLeft ? `${owedLeft} ${owedLeft === 1 ? "reason" : "reasons"} still needed` : null, data.review && reviewAnswered(review) < 3 ? `Weekly review ${reviewAnswered(review)} of 3` : null, !tomorrow.trim() ? `${data.tomorrowLabel}'s line still empty` : null].filter((x): x is string => !!x);
  const reportTitle = copies.length > 1 ? `Reports to ${toNames(copies)}` : partner ? `Report to ${first}` : "Report";
  const kind = data.friday ? "Daily and week report" : "Daily report";
  // Sent to one partner and not yet to another (a failed send): said under the buttons.
  const partly = copies.some((c) => c.sentAt) && unsent.length ? `Sent to ${toNames(copies.filter((c) => c.sentAt))}; ${toNames(unsent)} still to send` : null;

  // The tomorrow box starts at two lines and grows with wrapped text.
  useEffect(() => {
    const ta = tomorrowRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }, [tomorrow]);

  const saveReason = (patch: Record<string, string>) =>
    start(async () => {
      setError(null);
      const r = await saveReasons(day, patch);
      if (!r.ok) return setError(r.error);
      if (!r.owed) setCheck(null);
      router.refresh();
    });
  const applyShared = (v: string) => {
    setSharedText(v);
    const patch: Record<string, string> = {};
    for (const j of asked) patch[j.targetId] = v;
    for (const j of owedPrev?.items ?? []) patch[owedKey(j)] = v;
    setReasons((r) => ({ ...r, ...patch }));
  };
  const useDrafts = (drafts: ReasonDraft[]) => {
    const patch: Record<string, string> = {};
    for (const d of drafts) patch[d.targetId] = d.reason;
    setReasons((r) => ({ ...r, ...patch }));
    saveReason(patch);
  };
  const saveLine = (text: string) =>
    start(async () => {
      setError(null);
      const r = await saveTomorrow(day, text);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  const useLine = (text: string) => {
    setTomorrow(text);
    saveLine(text);
  };
  const saveAnswer = (patch: Partial<WeeklyReview>) =>
    start(async () => {
      setError(null);
      const r = await saveWeeklyReview(day, patch);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  const applyShort = async () => {
    const r = await putShortReport(day, sel);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setResetKey((k) => k + 1);
    router.refresh();
    return r.html;
  };
  const togglePartner = (id: string, on: boolean) => {
    const before = skippedIds;
    const next = new Set(skippedIds);
    if (on) next.delete(id);
    else next.add(id);
    setSkippedIds(next);
    setError(null);
    start(async () => {
      const r = await setPartnerToday(day, id, on);
      if (!r.ok) {
        setSkippedIds(before);
        return setError(r.error);
      }
      router.refresh();
    });
  };
  const send = (force = false) =>
    startSend(async () => {
      setError(null);
      setCheck(null);
      const from = copy;
      const r = await approveAndSend(day, requestId.current, force);
      if (!r.ok) {
        if (r.reason === "reasons") return setCheck(r.error);
        setError(r.error);
        if (r.reason === "partial") router.refresh();
        return;
      }
      setState({ status: "sent", sentTime: r.sentTime, skipReason: null });
      let line = r.alreadySent ? "This report was already sent." : null;
      if (alsoCount && from) {
        const x = await sendReport({ day, sections: from.partner.sections, intro: "", to: recipientsTo(also), requestId: alsoRequest.current, force: true, choices: from.report.choices ?? null, notes: from.report.notes ?? null });
        if (x.ok) {
          line = `${line ? `${line} ` : ""}Also sent to ${andNames(x.sentTo)}`;
          setAlso(NO_RECIPIENTS);
          setAlsoOpen(false);
        } else setError(`Sent to your partners. Not sent to ${alsoNames}: ${x.error}`);
      }
      setNote(line);
      router.refresh();
    });
  const skip = () =>
    start(async () => {
      setError(null);
      const r = await skipToday(day, skipWhy);
      if (!r.ok) return setError(r.error);
      setState({ status: "skipped", sentTime: null, skipReason: skipWhy.trim() || "No reason given" });
      setSkipOpen(false);
      router.refresh();
    });
  const focusFirstReason = () => {
    setCheck(null);
    setWindowOpen(false);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>("[data-testid=reason-input]");
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  };
  /** A checklist row: scroll to its card and outline it for a moment. */
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goCard = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const pad = (document.querySelector<HTMLElement>("[data-testid=eod-sticky]")?.offsetHeight ?? 0) + 16;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - pad), behavior: "smooth" });
    document.querySelectorAll(".field-flash").forEach((x) => x.classList.remove("field-flash"));
    el.classList.add("field-flash");
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => el.classList.remove("field-flash"), 1400);
  };
  const extras: EodExtras = { day, tomorrow, closed: closed ? (state.status as "sent" | "skipped") : null, onUseReasons: useDrafts, onUseTomorrow: useLine, onUseShort: applyShort };
  const n = data.numbers;
  const cardIds = { reasons: "eod-targets", review: "eod-review", tomorrow: "eod-tomorrow" };
  const checkBox = check ? (
    <Confirm tone="warn" testId="send-check">
      <span>{check}</span>
      <RowButton onClick={focusFirstReason} data-testid="send-check-give">
        Give them
      </RowButton>
      <RowButton tone="primary" onClick={() => send(true)} disabled={sending} data-testid="send-check-anyway">
        Send anyway
      </RowButton>
    </Confirm>
  ) : null;
  // While sending: "Sending…" with the small spinner the Sample data buttons use, grayed until the result shows.
  const sendLabelNow = sending ? (
    <>
      <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin" aria-hidden />
      <span role="status">Sending…</span>
    </>
  ) : (
    sendLabel(unsent.length)
  );
  // Sent or skipped: one line above the checklist (the mockup's Sent state).
  const statusLine =
    state.status === "sent" ? (
      <RStat tone="green">
        Sent to {copies.length ? toNames(copies) : first} at {state.sentTime}
      </RStat>
    ) : state.status === "skipped" ? (
      <RStat tone="amber">Skipped today</RStat>
    ) : null;
  const checkCount = state.status === "sent" ? { text: `Sent ${state.sentTime ?? ""}`.trim(), tone: "green" } : state.status === "skipped" ? { text: "Skipped", tone: "amber" } : checksDone === checks.length ? { text: "All done", tone: "green" } : { text: `${checksDone} of ${checks.length} done`, tone: "plain" };

  return (
    <>
      <PinnedBlock testId="eod-sticky">
        <WorkHeader
          title={
            <>
              End of day ·{" "}
              <span className="whitespace-nowrap" data-testid="eod-title-date">
                {data.titleDate}
              </span>
            </>
          }
          slimTitle="End of day"
          right={
            <>
              <EodTimeLine data={data} status={state.status} sentTime={state.sentTime} />
              <AskAiPill context={page} extras={extras} />
            </>
          }
        />
        <AccountabilityTabs eodBadge={badge} tight />
      </PinnedBlock>

      {error ? (
        <p className="mb-3 rounded-lg border border-status-missed-border bg-status-missed-bg px-3.5 py-2.5 text-[13px] text-status-missed" role="alert" data-testid="eod-error">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1000px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="eod-columns">
        <div className="flex min-w-0 flex-col gap-4" data-testid="eod-left">
          <TodayTiles parts={todayStrip(n, data.threshold)} onOpen={setDrawer} />

          <WorkCard
            id="eod-targets"
            title="Targets"
            count={null}
            actions={
              <>
                <span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral" data-testid="eod-met-count">
                  {judgedCount < judged.length ? `${met} of ${judgedCount} met today · ${judged.length} targets` : `${met} of ${judged.length} met`}
                </span>
                {asked.length + (owedPrev?.items.length ?? 0) >= 2 && !closed ? (
                  <button type="button" onClick={() => setShared((s) => !s)} className="text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="same-reason-toggle">
                    Same reason for all
                  </button>
                ) : null}
                <AiCardStar context={{ ...page, card: "Reasons" }} extras={extras} />
              </>
            }
            testId="eod-targets"
          >
            {shared && !closed ? (
              <div className="flex flex-wrap items-center gap-2.5 border-b border-primary-border bg-primary-soft px-[22px] py-2.5" data-testid="same-reason-bar">
                <span className="text-[12.5px] font-medium whitespace-nowrap text-primary-strong">One reason for every missed commitment</span>
                <div className="relative min-w-0 flex-1 basis-[240px]">
                  <input value={sharedText} onChange={(e) => applyShared(e.target.value)} onBlur={() => sharedText.trim() && saveReason(Object.fromEntries([...asked.map((j) => [j.targetId, sharedText]), ...(owedPrev?.items ?? []).map((j) => [owedKey(j), sharedText])]))} placeholder="Type it once; each box below gets it" className={cn(INPUT, "pr-9")} data-testid="same-reason-input" />
                </div>
              </div>
            ) : null}
            <Rows testId="eod-rows">
              {judged.map((j) => {
                const ask = j.judged && !j.met && j.commitment && !closed;
                const given = !!String(reasons[j.targetId] ?? "").trim();
                return (
                  <div key={j.targetId} className={cn("grid items-center gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0", GRID.cls, GRID.gapCls)} data-testid="eod-target" data-target={j.name} data-met={judgedMark(j) === "met" ? "1" : judgedMark(j) === "missed" ? "0" : "now"} data-asks={ask ? "1" : "0"}>
                    <div className={cn("min-w-0", GRID.textMarginCls)} data-row-text>
                      <Line1>
                        <Name>{j.name}</Name>
                        {j.commitment ? <Pill tone="blue">Commitment</Pill> : null}
                      </Line1>
                      <Line2>{j.line}</Line2>
                    </div>
                    <StatusMark mark={judgedMark(j)} />
                    <Figure value={j.figure} label={MARK_WORD[judgedMark(j)]} tone={judgedMark(j) === "missed" ? "red" : "plain"} className={cn(FIG, j.met && "[&>b]:text-status-met")} testId="eod-figure" />
                    {ask || (closed && j.judged && !j.met && j.commitment) ? (
                      <div className="col-span-3 mt-0.5 grid grid-cols-1 items-center gap-x-3 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)]">
                        <span className="text-[12.5px] font-medium whitespace-nowrap text-status-missed">Why missed, one line</span>
                        <div className="relative min-w-0">
                          <input
                            value={reasons[j.targetId] ?? ""}
                            onChange={(e) => setReasons((r) => ({ ...r, [j.targetId]: e.target.value }))}
                            onFocus={() => setFocused(j.targetId)}
                            onBlur={(e) => {
                              setFocused(null);
                              if ((e.target.value ?? "") !== (data.reasons[j.targetId] ?? "")) saveReason({ [j.targetId]: e.target.value });
                            }}
                            placeholder="Type it, or press the star for a draft"
                            disabled={closed}
                            className={cn(INPUT, "pr-9")}
                            data-testid="reason-input"
                            data-target={j.name}
                          />
                          {!closed ? <AiFieldStar context={{ ...page, card: "Reasons" }} field={{ key: "eod_reason", label: `Reason, ${j.name}`, current: reasons[j.targetId] ?? "", extra: `The missed commitment: ${j.name} ${j.figure}.` }} visible={!given || focused === j.targetId} onUse={(t) => { setReasons((r) => ({ ...r, [j.targetId]: t })); saveReason({ [j.targetId]: t }); }} /> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Rows>
            {owedPrev ? (
              <div className="pt-1" data-testid="eod-owed-group">
                <div className="label-caps mx-[22px] mt-1 border-b border-rule py-1.5 pb-[7px]" data-testid="eod-owed-heading">
                  Owed from {owedPrev.dayLabel}
                </div>
                <Rows className="pt-0">
                  {owedPrev.items.map((j) => (
                    <div key={owedKey(j)} className={cn("grid items-center gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0", GRID.cls, GRID.gapCls)} data-testid="eod-owed" data-target={j.name}>
                      <div className={cn("min-w-0", GRID.textMarginCls)} data-row-text>
                        <Line1>
                          <Name>{j.name}</Name>
                          <Pill tone="blue">Commitment</Pill>
                        </Line1>
                        <Line2>{j.line}</Line2>
                      </div>
                      <StatusMark mark="missed" />
                      <Figure value={j.figure} label="Missed" tone="red" className={FIG} />
                      <div className="col-span-3 mt-0.5 grid grid-cols-1 items-center gap-x-3 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)]">
                        <span className="text-[12.5px] font-medium whitespace-nowrap text-status-missed">Why missed, one line</span>
                        <input value={reasons[owedKey(j)] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [owedKey(j)]: e.target.value }))} onBlur={(e) => saveReason({ [owedKey(j)]: e.target.value })} placeholder="The reason still owed from the skipped day" disabled={closed} className={INPUT} data-testid="reason-input" data-target={j.name} />
                      </div>
                    </div>
                  ))}
                </Rows>
              </div>
            ) : null}
            <p className="px-[22px] pt-1 pb-4 text-[12.5px] text-muted-foreground" data-testid="eod-targets-note">
              {data.weekJudged ? `It is ${data.weekEndName}, so the per-week targets are judged today. ` : data.weekday ? `The per-week targets are judged on ${data.weekEndName}; today judges the per-weekday ones. ` : "No targets are judged today: it is not one of your work days (Settings, Work settings). "}
              Only commitments ask for a reason; the reason goes into the report as written.
            </p>
          </WorkCard>

          {data.review ? (
            <WorkCard id="eod-review" title="Weekly review" sub={`${dayWord}s. Goes into ${dayWord}'s report.`} actions={<span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral" data-testid="eod-review-count">{reviewAnswered(review)} of 3 written</span>} testId="eod-review">
              <div className="flex flex-col gap-3.5 px-[22px] pt-3 pb-4">
                {REVIEW_QUESTIONS.map((q) => {
                  const value = review[q.key];
                  const fieldId = `eod-review-${q.key}`;
                  return (
                    <div key={q.key} className="min-w-0" data-testid="eod-review-field" data-key={q.key}>
                      <label htmlFor={fieldId} className="mb-1 block text-[12.5px] font-medium text-slate-700">
                        {q.question}
                      </label>
                      <div className="relative">
                        <textarea
                          id={fieldId}
                          rows={2}
                          value={value}
                          onChange={(e) => setReview((r) => ({ ...r, [q.key]: e.target.value }))}
                          onFocus={() => setFocused(fieldId)}
                          onBlur={(e) => {
                            setFocused(null);
                            if (e.target.value.trim() !== (data.review?.[q.key] ?? "").trim()) saveAnswer({ [q.key]: e.target.value });
                          }}
                          placeholder={q.key === "focus" ? "One or two lines" : "One or two lines, from the week"}
                          disabled={closed}
                          className="block w-full resize-y rounded-[7px] border border-input bg-white px-3 py-2 pr-10 text-sm leading-[1.5] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-600"
                          data-testid="eod-review-input"
                        />
                        {!closed ? (
                          <AiFieldStar
                            context={{ ...page, card: "Weekly review" }}
                            field={{ key: "weekly_review", label: q.question, current: value }}
                            visible={!value.trim() || focused === fieldId}
                            onUse={(t) => {
                              setReview((r) => ({ ...r, [q.key]: t }));
                              saveAnswer({ [q.key]: t });
                            }}
                            className="top-5 translate-y-0"
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[12.5px] text-muted-foreground">Each answer saves when you leave the box. Partners who get the Weekly review section see it in {dayWord}&apos;s report; an empty answer goes out as &ldquo;(still to write)&rdquo;.</p>
              </div>
            </WorkCard>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4" data-testid="eod-right">
          <WorkCard id="report-card" title={reportTitle} sub={`${kind} · ${data.dateLabel}`} actions={<AiCardStar context={{ ...page, card: "Report" }} extras={extras} />} testId="report-card">
            <div className="px-[22px] pt-3 pb-4">
              {statusLine ? (
                <div className="mb-3" data-testid="report-status" data-state={state.status}>
                  {statusLine}
                </div>
              ) : null}
              <div data-testid="eod-checklist" data-state={state.status} data-done={checksDone} data-total={checks.length} data-owed={owedLeft} data-needs={needs.length}>
                <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1.5">
                  <span className="label-caps">Before you send</span>
                  <span className={cn("tabular text-[12.5px] font-medium whitespace-nowrap", checkCount.tone === "green" ? "text-status-met" : checkCount.tone === "amber" ? "text-status-soon" : "text-muted-foreground")} data-testid="eod-checklist-count">
                    {checkCount.text}
                  </span>
                </div>
                <div className="mt-1">
                  {checks.map((c) => (
                    <button key={c.key} type="button" onClick={() => goCard(cardIds[c.key])} className="row-hover -mx-2 grid w-[calc(100%+16px)] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 p-2 text-left" data-testid="eod-check" data-key={c.key} data-done={c.done ? "1" : "0"} data-state={c.state}>
                      <span className={cn("inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]", c.done ? "border-status-met-solid bg-status-met-bg text-status-met-solid" : "border-input bg-white")} aria-hidden>
                        {c.done ? <Check className="h-[11px] w-[11px]" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 text-[13.5px] font-medium text-slate-900">{c.label}</span>
                      <span className={cn("text-right text-[12.5px] font-medium whitespace-nowrap", c.done ? "text-status-met" : "text-status-soon")}>{c.state}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div id="report-acts" className="mt-3 flex flex-col gap-2 min-[421px]:flex-row" data-testid="report-acts">
                <button type="button" onClick={() => setWindowOpen("view")} disabled={!copies.length} aria-haspopup="dialog" className={cn(BTN_LG, "border-primary-strong bg-white text-primary-strong hover:bg-primary-soft")} data-testid="report-view">
                  <Eye className="h-[15px] w-[15px]" aria-hidden />
                  View report
                </button>
                <button type="button" onClick={() => send(false)} disabled={state.status !== "open" || sending || !unsent.length} className={cn(BTN_LG, "border-primary-solid bg-primary-solid text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover")} data-testid="report-send" data-count={unsent.length} data-busy={sending ? "1" : "0"}>
                  {sendLabelNow}
                </button>
              </div>
              {checkBox && !windowOpen ? <div className="mt-3">{checkBox}</div> : null}
              {state.status === "sent" ? (
                <Confirm tone="ok" className="mt-3" testId="sent-line">
                  Sent through Gmail{note ? `. ${note}` : ""}. Replies will show on Reports and on {copies.length > 1 ? "each partner's" : `${first}'s`} timeline.
                </Confirm>
              ) : state.status === "skipped" ? (
                <Confirm tone="warn" className="mt-3" testId="skipped-line">
                  Skipped: {state.skipReason}. It shows on Reports as &ldquo;Not sent&rdquo;, and any reason still owed is asked on the next End of day.
                </Confirm>
              ) : null}
              {state.status === "open" && skipOpen ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-status-soon-border bg-status-soon-bg px-3 py-2" data-testid="skip-box">
                  <input value={skipWhy} onChange={(e) => setSkipWhy(e.target.value)} placeholder="Reason, one line (goes on Reports)" className={cn(INPUT, "h-[30px] flex-1 basis-[180px]")} data-testid="skip-reason" />
                  <RowButton onClick={skip} disabled={pending} data-testid="skip-confirm">
                    Skip
                  </RowButton>
                  <RowButton onClick={() => setSkipOpen(false)}>Cancel</RowButton>
                </div>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px]">
                {state.status === "open" ? (
                  <>
                    <button type="button" onClick={() => setWindowOpen("edit")} disabled={!copies.length} className="font-medium text-muted-foreground hover:text-primary-strong" data-testid="report-edit">
                      Edit
                    </button>
                    <button type="button" onClick={() => setSkipOpen(true)} className="font-medium text-muted-foreground hover:text-primary-strong" data-testid="skip-today">
                      Skip today
                    </button>
                  </>
                ) : null}
                {/* Send a report (Bram, 2026-11-07): today's or an earlier report, to anyone with an email address. */}
                <SendReportButton className="font-medium text-muted-foreground hover:text-primary-strong" />
                {state.status === "open" && partly ? (
                  <span className="min-w-0 text-[12.5px] text-muted-foreground sm:ml-auto sm:text-right" data-testid="report-due-line">
                    {partly}
                  </span>
                ) : null}
              </div>
              {copies.length ? (
                <div className="mt-4 border-t border-border pt-3.5" data-testid="eod-partners">
                  <div className={cn(PT_ROW, "border-b border-rule pb-1.5")}>
                    <span />
                    <span className="label-caps figure-label">Partner</span>
                    <span className="label-caps figure-label">Gets</span>
                    <span className="label-caps figure-label">Sections</span>
                    <span />
                  </div>
                  {copies.map((c) => {
                    const open = openPartner === c.partner.id;
                    const count = sentSections(c.report).length;
                    const on = ticked(c.partner.id);
                    return (
                      <div key={c.partner.id} className="border-b border-slate-100 last:border-b-0" data-testid="eod-partner" data-partner={c.partner.first} data-open={open ? "1" : "0"} data-on={on ? "1" : "0"}>
                        <div className={cn(PT_ROW, "py-[9px] text-[13px] text-slate-700")}>
                          <input type="checkbox" checked={on} disabled={closed || !!c.sentAt} onChange={(e) => togglePartner(c.partner.id, e.target.checked)} aria-label={`Send today's report to ${c.partner.name}`} className={PARTNER_BOX} data-testid="eod-partner-check" />
                          <Link href={personHref(c.partner.id)} className={cn("min-w-0 text-sm font-semibold break-words hover:underline", on ? "text-slate-900" : "text-slate-400")} data-testid="eod-partner-name">
                            {c.partner.first}
                          </Link>
                          <span className={cn("min-w-0", !on && "text-slate-400")} data-testid="eod-partner-gets">
                            {getsLabel(c.partner.days)}
                          </span>
                          <span className={cn("tabular min-w-0", !on && "text-slate-400")} data-testid="eod-partner-count">
                            {on ? `${count} ${count === 1 ? "section" : "sections"}` : "Skipped today"}
                          </span>
                          <button type="button" onClick={() => setOpenPartner(open ? null : c.partner.id)} aria-expanded={open} className="text-right text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="eod-partner-view">
                            {open ? "Hide" : "View"}
                          </button>
                        </div>
                        {open ? (
                          <p className="pb-[11px] text-[12.5px] leading-[1.55] text-slate-700" data-testid="eod-partner-sections">
                            {includesLine(c.report)}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {state.status === "open" && alsoCount ? (
                    <p className="mt-2.5 text-[12.5px] text-slate-700" data-testid="eod-also-line">
                      Also sending to {alsoNames} with Approve and send (today only).
                    </p>
                  ) : null}
                  <Link href="/work/people?view=people" className="mt-2.5 inline-block text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="eod-manage-partners">
                    Manage partners
                  </Link>
                </div>
              ) : (
                <p className="mt-4 border-t border-border pt-3.5 text-[12.5px] leading-[1.5] text-muted-foreground" data-testid="report-includes">
                  {data.partners.length ? (
                    <>No partner gets the report today. Each partner&apos;s days are on their page under Contacts. To send today&apos;s report anyway, click Send a report above.</>
                  ) : (
                    <>
                      No accountability partner yet. Add a person under{" "}
                      <Link href="/work/people?view=people" className="font-medium text-primary-strong hover:underline">
                        Contacts
                      </Link>{" "}
                      with the role Accountability partner.
                    </>
                  )}
                </p>
              )}
            </div>
          </WorkCard>

          <WorkCard id="eod-tomorrow" title={data.tomorrowLabel === "Tomorrow" ? "What matters tomorrow" : `What matters ${data.tomorrowLabel}`} actions={<AiCardStar context={{ ...page, card: "What matters tomorrow" }} extras={extras} />} testId="eod-tomorrow">
            <div className="px-[22px] pt-3 pb-4">
              <div className="relative">
                <textarea
                  ref={tomorrowRef}
                  rows={2}
                  value={tomorrow}
                  onChange={(e) => setTomorrow(e.target.value)}
                  onFocus={() => setFocused("tomorrow")}
                  onBlur={(e) => {
                    setFocused(null);
                    if (e.target.value !== data.tomorrow) saveLine(e.target.value);
                  }}
                  placeholder="One line about the next working day"
                  disabled={closed}
                  className="block w-full resize-none overflow-hidden rounded-[7px] border border-input bg-white px-3 py-2.5 pr-10 text-sm leading-[1.5] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-600"
                  aria-label="What matters tomorrow"
                  data-testid="tomorrow-input"
                />
                {!closed ? <AiFieldStar context={{ ...page, card: "What matters tomorrow" }} field={{ key: "tomorrow_line", label: "What matters tomorrow", current: tomorrow }} visible={!tomorrow.trim() || focused === "tomorrow"} onUse={useLine} className="top-5 translate-y-0" /> : null}
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground">{data.tomorrowLabel === "Tomorrow" ? "Tomorrow's line. Ends the report and opens Home tomorrow." : `${data.tomorrowLabel}'s line. Ends the report and opens Home on ${data.tomorrowLabel}.`}</p>
            </div>
          </WorkCard>
        </div>
      </div>
      <ReportWindow
        open={!!windowOpen}
        onOpenChange={(o) => setWindowOpen(o ? "view" : false)}
        day={day}
        copies={copies}
        skipped={skippedIds}
        onPartner={closed ? null : togglePartner}
        sel={copy?.partner.id ?? null}
        onSel={setSel}
        title={reportTitle}
        sub={`${kind} · ${data.dateLabel} · ${state.status === "sent" ? `sent at ${state.sentTime}` : state.status === "skipped" ? "not sent today" : `as it will be sent at ${data.eodTime.long}`}`}
        startEditing={windowOpen === "edit"}
        resetKey={resetKey}
        alsoTo={
          state.status === "open" ? (
            <div className="mb-3 rounded-[9px] border border-border bg-background px-3.5 py-2.5" data-testid="report-also">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-700">
                <span className="label-caps figure-label">Also send to</span>
                <span className="min-w-0" data-testid="report-also-names">
                  {alsoCount ? alsoNames : "Nobody else"}
                </span>
                <button type="button" onClick={openAlso} aria-expanded={alsoOpen} className="ml-auto text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="report-also-open">
                  {alsoOpen ? "Done" : alsoCount ? "Change" : "+ Add someone"}
                </button>
              </div>
              {alsoOpen ? (
                <div className="mt-2.5">
                  {alsoPeople ? (
                    <RecipientPicker people={alsoPeople} value={also} onChange={setAlso} exclude={copies.map((c) => c.partner.id)} testId="report-also-picker" />
                  ) : alsoError ? (
                    <p className="text-[12.5px] text-status-missed">{alsoError}</p>
                  ) : (
                    <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Loading your contacts…
                    </p>
                  )}
                </div>
              ) : null}
              <p className="mt-1.5 text-[12px] text-muted-foreground">Today only. They get {copy ? `${copy.partner.first}'s copy (the tab open below)` : "the copy shown below"}, sent with Approve and send.</p>
            </div>
          ) : null
        }
        footerNote={checkBox ?? (state.status === "open" && needs.length ? `${needs.join(" · ")}. Gaps go out as "(still to give)".` : state.status === "open" ? (partly ?? dueLine(data.partners, day)) : state.status === "sent" ? `Sent to ${toNames(copies)} at ${state.sentTime}.` : "Skipped today. Nothing is sent.")}
        sendButton={
          state.status === "open" ? (
            <button type="button" onClick={() => send(false)} disabled={sending || !unsent.length} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-primary-solid bg-primary-solid px-3 text-[13px] font-medium text-white hover:bg-primary-solid-hover disabled:opacity-50" data-testid="report-window-send" data-busy={sending ? "1" : "0"}>
              {sendLabelNow}
            </button>
          ) : null
        }
      />
      {drawer ? <TodayDrawer part={drawer} n={n} threshold={data.threshold} dateLabel={data.dateLabel} onClose={() => setDrawer(null)} /> : null}
    </>
  );
}

/**
 * The line at the top right of End of day (approved 2026-11-05): "Report at 5:30 pm · 1 hr 12 min left" before the
 * End of day time (Settings), "· time passed" after it while the report is neither sent nor skipped, "Report sent 5:41
 * pm" once sent, "Report skipped today" once skipped. A page left open into another day drops the countdown. It starts
 * from the server's clock (no hydration mismatch), then follows the browser's, updated at each new minute.
 */
function EodTimeLine({ data, status, sentTime }: { data: EndOfDayPage; status: EndOfDayPage["state"]; sentTime: string | null }) {
  const [now, setNow] = useState(data.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 0);
    const onShow = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  const at = `Report at ${data.eodTime.long}`;
  let parts: string[];
  let tone: "plain" | "passed" = "plain";
  if (status === "sent") parts = [sentTime ? `Report sent ${sentTime}` : "Report sent"];
  else if (status === "skipped") parts = ["Report skipped today"];
  else {
    const c = eodCountdown(new Date(now), data.tz, data.day, data.eodTime.hhmm);
    parts = c.kind === "left" ? [at, minutesLeftWords(c.minutes)] : c.kind === "passed" ? [at, "time passed"] : [at];
    if (c.kind === "passed") tone = "passed";
  }
  return (
    <span className="min-w-0" data-testid="eod-date" data-state={status} data-tone={tone}>
      {parts.map((p, n) => (
        <span key={p}>
          {n ? " " : ""}
          <span className="whitespace-nowrap">
            {p}
            {n < parts.length - 1 ? " ·" : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

/** The status line on the report card: a dot and the words, green or amber. */
function RStat({ tone, children }: { tone: "green" | "amber"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-[7px] text-[13.5px] font-semibold", tone === "green" ? "text-status-met" : "text-status-soon")} data-testid="report-status-line" data-tone={tone}>
      <i className="block h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/**
 * The Today tiles (hybrid of 2026-11-05, Option A; was the one-line Today strip of Edit batch C, item 10): a white
 * tile per figure (no label above them since 2026-11-05, so their top is level with the report card's), a big number over a small-caps label. Four a row when the column is wide
 * enough (desktop), two on the phone; Next actions done is two tiles wide with its area split under the label ("Deals 2
 * · Rosara 1"; the split wraps between areas, never inside one). A zero is light gray; Waiting is red above 0. Each
 * tile opens the drawer listing its items. The tiles of a row are the same height, so numbers and labels stay level.
 */
function TodayTiles({ parts, onOpen }: { parts: TodayPart[]; onOpen: (p: TodayPart) => void }) {
  return (
    <section className="@container min-w-0" aria-label="Today" data-testid="eod-today">
      <div className="grid grid-cols-2 gap-2 @min-[560px]:grid-cols-4" data-testid="eod-today-tiles">
        {parts.map((p) => {
          const areas = p.key === "done" && p.value && p.detail ? p.detail.split(" · ") : [];
          const alert = p.key === "waits" && p.value > 0;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onOpen(p)}
              aria-label={`${p.value} ${p.words}${p.detail ? `: ${p.detail}` : ""}. Show the list.`}
              className={cn("row-hover flex min-w-0 flex-col items-start rounded-[10px] border border-border bg-white px-3 pt-2.5 pb-[11px] text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-input", p.key === "done" && "col-span-2")}
              data-testid="eod-today-part"
              data-key={p.key}
              data-count={p.value}
              data-alert={alert ? "1" : "0"}
            >
              <b className={cn("tabular text-[22px] leading-[26px]", !p.value ? "font-medium text-slate-400" : alert ? "font-semibold text-status-missed" : "font-semibold text-slate-900")} data-testid="eod-today-value">
                {p.value}
              </b>
              <span className="label-caps figure-label mt-1 max-w-full">
                <span className={alert ? "text-status-missed" : undefined}>{p.words}</span>
              </span>
              {areas.length ? (
                <span className="mt-[3px] text-[12px] leading-[1.35] text-slate-600" data-testid="eod-today-areas">
                  {areas.map((a, n) => (
                    <span key={a}>
                      {n ? " " : ""}
                      <span className="whitespace-nowrap">
                        {a}
                        {n < areas.length - 1 ? " ·" : ""}
                      </span>
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

const DRAWER_TITLE: Record<TodayPart["key"], string> = { screened: "Listings screened today", moved: "Deals moved today", calls: "Calls today", emails: "Emails sent today", done: "Next actions done today", todos: "To-dos done today", waits: "Waiting on someone" };

/**
 * The drawer behind one Today tile: the items it counts, one per row. Edits of Nov 5 (item 4): each row
 * is a link to its record (the listing or deal, the person or the deal an email was on, the record a next action was
 * done on, the To-dos page for a to-do), with the shared row hover; it opens in the same tab.
 */
function TodayDrawer({ part, n, threshold, dateLabel, onClose }: { part: TodayPart; n: DayNumbers; threshold: number; dateLabel: string; onClose: () => void }) {
  type Item = { name: string; detail?: string | null; note?: string | null; tone?: "red" | "green" | "plain"; href?: string | null };
  let items: Item[] = [];
  let empty = "None yet today.";
  if (part.key === "screened") items = n.screenedList.map((x) => ({ name: x.name, detail: x.outcome === "interested" ? "Interested" : `Passed${x.reason ? `: ${x.reason}` : ""}`, tone: x.outcome === "interested" ? "green" : "plain", href: x.href }));
  else if (part.key === "moved") {
    items = n.moves.map((m) => ({ name: m.name, detail: `${m.from ?? "New"} to ${m.to}${m.lane !== "Deals" ? ` · ${m.lane}` : ""}`, note: m.keyFinding ? `Key finding: ${m.keyFinding}` : null, href: m.href }));
    empty = "No stage move today.";
  } else if (part.key === "calls") items = n.contactsList.filter((c) => c.kind === "call").map((c) => ({ name: c.name, detail: c.method === "video" ? "Video call" : c.method === "meeting" ? "Meeting" : "Call", href: c.href }));
  else if (part.key === "emails") items = n.contactsList.filter((c) => c.kind === "email").map((c) => ({ name: c.name, detail: "Email sent", href: c.href }));
  else if (part.key === "done") {
    // Push E2: by area, in the Area selector's order; the area leads each line.
    items = DONE_AREAS.flatMap((area) => n.actionsDoneList.filter((a) => a.area === area).map((a) => ({ name: a.name, detail: a.label ? `${area} · ${a.label}` : area, href: a.href })));
  } else if (part.key === "todos") {
    items = (n.todosDone?.list ?? []).map((t) => ({ name: t || "A to-do", href: "/work/todos" }));
    empty = "No to-do checked off today.";
  } else {
    // Edits of Nov 5 (item 5): one row per wait of 5+ days (a deal with two such waits has two rows).
    items = n.waits.map((w) => ({ name: w.name, detail: `${w.days} days${w.kind === "person" ? " · Contacts" : w.who ? ` · ${w.who}` : ""}`, note: w.what ? `Waiting on: ${w.what}${w.since ? `, since ${w.since}` : ""}` : null, tone: w.days >= threshold * 2 ? "red" : "plain", href: w.href }));
    empty = `Nobody has kept you waiting ${threshold}+ days.`;
  }
  const body = (it: Item) => (
    <>
      <div className="text-sm font-semibold text-slate-900">{it.name}</div>
      {it.detail ? <div className={cn("mt-0.5 text-[13px]", it.tone === "red" ? "font-medium text-status-missed" : it.tone === "green" ? "font-medium text-status-met" : "text-slate-700")}>{it.detail}</div> : null}
      {it.note ? <div className="mt-0.5 text-[12.5px] text-muted-foreground italic">{it.note}</div> : null}
    </>
  );
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={DRAWER_TITLE[part.key]} sub={`${dateLabel} · ${part.value} ${part.words}${part.detail ? `: ${part.detail}` : ""}`} testId="eod-today-drawer">
      {items.length ? (
        <ul className="-mx-7 flex flex-col" data-testid="eod-today-items" data-key={part.key}>
          {items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="border-t border-slate-100 first:border-t-0" data-testid="eod-today-item">
              {it.href ? (
                <Link href={it.href} className="row-hover block px-7 py-2.5" data-testid="eod-today-link">
                  {body(it)}
                </Link>
              ) : (
                <div className="px-7 py-2.5">{body(it)}</div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground" data-testid="eod-today-empty">
          {empty}
        </p>
      )}
      <p className="mt-4 text-[12.5px] text-muted-foreground">Counted from what you did in the app. The report&apos;s Today tiles show the same figures.</p>
    </Drawer>
  );
}
