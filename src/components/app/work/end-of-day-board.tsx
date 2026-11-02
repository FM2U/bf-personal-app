"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndSend, saveReasons, saveReportEdit, saveTomorrow, skipToday, putShortReport } from "@/app/actions/accountability";
import type { ReasonDraft } from "@/lib/accountability/ask-ai";
import type { EndOfDayPage } from "@/lib/accountability/data";
import { END_OF_DAY_TIME, judgedMark, MARK_WORD, owedReasons, statusItems, todayStrip, type DayNumbers, type Judged, type TodayPart } from "@/lib/accountability/targets";
import type { AskContext } from "@/lib/work/ask-ai";
import { AccountabilityTabs, type EodBadge } from "@/components/app/nav-links";
import { AiCardStar, AiFieldStar, AskAiPill, type EodExtras } from "@/components/app/work/ask-ai";
import { StatusMark } from "@/components/app/work/targets-ui";
import { Drawer } from "@/components/app/work/drawer";
import { Confirm, Figure, Line1, Line2, Name, Pill, PinnedBlock, ROW_GRIDS, RowButton, Rows, WorkCard, WorkHeader } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * End of day (batch C, approved 2026-10-31; decisions on v3 and v4; Edit batch C items 9 to 12): the status line
 * with the three things to do before sending (each a link to its card, the state live). Two equal columns at desktop
 * width (stacked on the phone). Left, what Bram does: the one-line Today strip ("Today: 4 screened · 0 moved · ..."),
 * each figure opening a small drawer with the items behind it; the Targets card with the status mark left of the
 * figure after a reserved 32px gap, the Commitment pill, and a one-line reason box on each missed Commitment (the
 * field star drafts it; "Same reason for all" fills every box), with reasons owed from a skipped day under their own
 * small heading "Owed from Fri Oct 30"; "What matters tomorrow" as a three-line box that grows. Right: the "Report to
 * <partner>" card with the email exactly as it will be sent, Edit in place, Approve and send (with "N commitments
 * have no reason yet", Give them or Send anyway), then "Sent 5:41 pm", and Skip today with a reason. Weekday targets
 * are judged daily; weekly ones on Friday.
 */
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const FIG = "w-[82px]";
const GRID = ROW_GRIDS.eodTarget;

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

export function EndOfDayBoard({ data }: { data: EndOfDayPage }) {
  const router = useRouter();
  const { day, partner } = data;
  const first = partner?.first ?? "your partner";
  const [reasons, setReasons] = useState<Record<string, string>>(data.reasons);
  const [tomorrow, setTomorrow] = useState(data.tomorrow);
  const [state, setState] = useState<{ status: EndOfDayPage["state"]; sentTime: string | null; skipReason: string | null }>({ status: data.state, sentTime: data.sentTime, skipReason: data.skipReason });
  const [html, setHtml] = useState(data.reportHtml);
  const [edited, setEdited] = useState(data.reportEdited);
  const [editing, setEditing] = useState(false);
  // The preview follows the data after every save (reasons, the tomorrow line) unless Bram is editing it by hand.
  const [prevHtml, setPrevHtml] = useState(data.reportHtml);
  if (prevHtml !== data.reportHtml) {
    setPrevHtml(data.reportHtml);
    if (!editing) {
      setHtml(data.reportHtml);
      setEdited(data.reportEdited);
    }
  }
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
  const previewRef = useRef<HTMLDivElement>(null);
  const tomorrowRef = useRef<HTMLTextAreaElement>(null);
  const closed = state.status !== "open";
  const judged = data.judged;
  const asked = useMemo(() => judged.filter((j) => j.judged && !j.met && j.commitment), [judged]);
  const owedPrev = data.owed;
  const owedKey = (j: Judged) => `owed:${owedPrev!.day}:${j.targetId}`;
  const owedLeft = owedReasons(judged, reasons).length + (owedPrev ? owedPrev.items.filter((j) => !String(reasons[owedKey(j)] ?? "").trim()).length : 0);
  const met = judged.filter((j) => j.judged && j.met).length;
  const judgedCount = judged.filter((j) => j.judged).length;
  const badge: EodBadge = state.status === "sent" ? "Sent" : state.status === "skipped" ? "Skipped" : "5:30";
  const items = statusItems(owedLeft, tomorrow, state.status, state.sentTime);
  const page: AskContext = { page: "end_of_day", label: `End of day, ${data.dateLabel}` };

  // The tomorrow box starts at three lines and grows with wrapped text.
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
  const toggleEdit = () => {
    if (!editing) {
      setEditing(true);
      setTimeout(() => previewRef.current?.focus(), 0);
      return;
    }
    const current = previewRef.current?.innerHTML ?? html;
    setEditing(false);
    start(async () => {
      setError(null);
      const r = await saveReportEdit(day, current);
      if (!r.ok) return setError(r.error);
      setHtml(r.html);
      setEdited(true);
    });
  };
  const resetEdit = () =>
    start(async () => {
      const r = await saveReportEdit(day, null);
      if (!r.ok) return setError(r.error);
      setHtml(r.html);
      setEdited(false);
      setEditing(false);
    });
  const applyShort = async () => {
    const r = await putShortReport(day);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setHtml(r.html);
    setEdited(true);
    setEditing(false);
    return r.html;
  };
  const send = (force = false) =>
    startSend(async () => {
      setError(null);
      setCheck(null);
      if (editing) {
        const current = previewRef.current?.innerHTML ?? html;
        setEditing(false);
        const e = await saveReportEdit(day, current);
        if (!e.ok) return setError(e.error);
        setHtml(e.html);
        setEdited(true);
      }
      const r = await approveAndSend(day, requestId.current, force);
      if (!r.ok) {
        if (r.reason === "reasons") return setCheck(r.error);
        return setError(r.error);
      }
      setState({ status: "sent", sentTime: r.sentTime, skipReason: null });
      setNote(r.alreadySent ? "This report was already sent." : null);
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
    const el = document.querySelector<HTMLInputElement>("[data-testid=reason-input]");
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const goCard = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const pad = (document.querySelector<HTMLElement>("[data-testid=eod-sticky]")?.offsetHeight ?? 0) + 16;
    const top = id === "report-acts" ? el.getBoundingClientRect().top + window.scrollY - (window.innerHeight - el.offsetHeight) / 2 : el.getBoundingClientRect().top + window.scrollY - pad;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };
  const extras: EodExtras = { day, tomorrow, closed: closed ? (state.status as "sent" | "skipped") : null, onUseReasons: useDrafts, onUseTomorrow: useLine, onUseShort: applyShort };
  const n = data.numbers;
  const cardIds = { reasons: "eod-targets", tomorrow: "eod-tomorrow", send: "report-acts" };

  return (
    <>
      <PinnedBlock testId="eod-sticky">
        <WorkHeader
          title="End of day"
          right={
            <>
              <span data-testid="eod-date">
                {data.dateLabel} · report at {END_OF_DAY_TIME} pm
              </span>
              <AskAiPill context={page} extras={extras} />
            </>
          }
        />
        <AccountabilityTabs eodBadge={badge} tight />
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground" data-testid="eod-status" data-owed={owedLeft} data-state={state.status}>
          <span className="whitespace-nowrap">Before you send:</span>
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {items.map((it, i) => (
              <span key={it.key} className="inline-flex items-center gap-2 whitespace-nowrap" data-testid={`eod-step-${it.key}`} data-word={it.word ?? ""}>
                {i ? <span className="hidden text-slate-400 sm:inline">·</span> : null}
                <button type="button" onClick={() => goCard(cardIds[it.key])} className="font-medium text-primary-strong hover:underline">
                  {it.label}
                </button>
                {it.word ? <em className={cn("not-italic", it.tone === "left" ? "font-medium text-status-soon" : it.tone === "done" ? "font-medium text-status-met" : "text-muted-foreground")}>({it.word})</em> : null}
              </span>
            ))}
          </span>
        </div>
      </PinnedBlock>

      {error ? (
        <p className="mb-3 rounded-lg border border-status-missed-border bg-status-missed-bg px-3.5 py-2.5 text-[13px] text-status-missed" role="alert" data-testid="eod-error">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2" data-testid="eod-columns">
        <div className="flex min-w-0 flex-col gap-4" data-testid="eod-left">
          <TodayStrip parts={todayStrip(n, data.threshold)} onOpen={setDrawer} />

          <WorkCard
            id="eod-targets"
            title="Targets"
            count={null}
            actions={
              <>
                <span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral" data-testid="eod-met-count">
                  {met} of {judgedCount} met
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
                    {(ask || (closed && j.judged && !j.met && j.commitment)) ? (
                      <div className="col-span-3 mt-0.5 flex flex-wrap items-center gap-2.5">
                        <span className="text-[12.5px] font-medium whitespace-nowrap text-status-missed">Why missed, one line</span>
                        <div className="relative min-w-0 flex-1 basis-[240px]">
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
                      <div className="col-span-3 mt-0.5 flex flex-wrap items-center gap-2.5">
                        <span className="text-[12.5px] font-medium whitespace-nowrap text-status-missed">Why missed, one line</span>
                        <input value={reasons[owedKey(j)] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [owedKey(j)]: e.target.value }))} onBlur={(e) => saveReason({ [owedKey(j)]: e.target.value })} placeholder="The reason still owed from the skipped day" disabled={closed} className={cn(INPUT, "flex-1 basis-[240px]")} data-testid="reason-input" data-target={j.name} />
                      </div>
                    </div>
                  ))}
                </Rows>
              </div>
            ) : null}
            <p className="px-[22px] pt-1 pb-4 text-[12.5px] text-muted-foreground" data-testid="eod-targets-note">
              {data.friday ? "It is Friday, so the per-week targets are judged today. " : data.weekday ? "The per-week targets are judged on Friday; today judges the per-weekday ones. " : "No targets are judged on a weekend. "}
              Only commitments ask for a reason; the reason goes into the report as written.
            </p>
          </WorkCard>

          <WorkCard id="eod-tomorrow" title="What matters tomorrow" actions={<AiCardStar context={{ ...page, card: "What matters tomorrow" }} extras={extras} />} testId="eod-tomorrow">
            <div className="px-[22px] pt-3 pb-5">
              <div className="relative">
                <textarea
                  ref={tomorrowRef}
                  rows={3}
                  value={tomorrow}
                  onChange={(e) => setTomorrow(e.target.value)}
                  onFocus={() => setFocused("tomorrow")}
                  onBlur={(e) => {
                    setFocused(null);
                    if (e.target.value !== data.tomorrow) saveLine(e.target.value);
                  }}
                  placeholder="One line about the next working day"
                  disabled={closed}
                  className="block w-full resize-none overflow-hidden rounded-[7px] border border-input bg-white px-4 py-3.5 pr-10 text-sm leading-[1.5] font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-600"
                  aria-label="What matters tomorrow"
                  data-testid="tomorrow-input"
                />
                {!closed ? <AiFieldStar context={{ ...page, card: "What matters tomorrow" }} field={{ key: "tomorrow_line", label: "What matters tomorrow", current: tomorrow }} visible={!tomorrow.trim() || focused === "tomorrow"} onUse={useLine} className="top-5 translate-y-0" /> : null}
              </div>
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">{data.tomorrowLabel === "Monday" ? "Monday's line. Ends the report and opens Home on Monday." : "Tomorrow's line. Ends the report and opens Home tomorrow."}</p>
            </div>
          </WorkCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4" data-testid="eod-right">
          <WorkCard
            id="report-card"
            title={`Report to ${first}`}
            actions={
              <>
                <span className="text-[13px] text-muted-foreground" data-testid="report-hint">
                  {state.status === "sent" ? "As sent" : state.status === "skipped" ? "Not sent" : edited ? "As it will be sent, edited" : "As it will be sent"}
                </span>
                <AiCardStar context={{ ...page, card: "Report" }} extras={extras} />
              </>
            }
            testId="report-card"
          >
            <p className="px-[22px] pt-2.5 pb-1 text-[12.5px] text-muted-foreground" data-testid="report-meta">
              {partner ? `To ${partner.name}${partner.email ? ` (${partner.email})` : ", no email address yet"}` : "No accountability partner yet: add one under More, Partners"} · {data.friday ? "Friday" : "weekday"} {END_OF_DAY_TIME} pm
            </p>
            <div className="px-[22px] pt-1 pb-3">
              <div
                ref={previewRef}
                contentEditable={editing}
                suppressContentEditableWarning
                className={cn("report-preview min-w-0 overflow-x-auto rounded-[10px] text-[13.5px] leading-normal text-slate-900 focus:outline-none", editing && "bg-[#fbfcff] shadow-[0_0_0_2px_var(--primary-border)]")}
                dangerouslySetInnerHTML={{ __html: html }}
                data-testid="report-preview"
                data-editing={editing ? "1" : "0"}
                data-edited={edited ? "1" : "0"}
              />
            </div>
            {check ? (
              <div className="mx-[22px] mb-3">
                <Confirm tone="warn" testId="send-check">
                  <span>{check}</span>
                  <RowButton onClick={focusFirstReason} data-testid="send-check-give">
                    Give them
                  </RowButton>
                  <RowButton tone="primary" onClick={() => send(true)} disabled={sending} data-testid="send-check-anyway">
                    Send anyway
                  </RowButton>
                </Confirm>
              </div>
            ) : null}
            {state.status === "open" ? (
              <div id="report-acts" className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-[22px] py-3" data-testid="report-acts">
                <RowButton onClick={toggleEdit} disabled={pending || sending} data-testid="report-edit">
                  {editing ? "Done editing" : "Edit"}
                </RowButton>
                {edited && !editing ? (
                  <button type="button" onClick={resetEdit} className="text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="report-reset">
                    Back to the built report
                  </button>
                ) : null}
                <RowButton tone="primary" onClick={() => send(false)} disabled={sending} data-testid="report-send">
                  {sending ? "Sending..." : "Approve and send"}
                </RowButton>
                <span className="text-[12.5px] text-muted-foreground sm:ml-auto">Sends on weekdays. Friday adds the week.</span>
              </div>
            ) : state.status === "sent" ? (
              <div id="report-acts" className="border-t border-slate-100 px-[22px] py-3 text-[12.5px] text-muted-foreground" data-testid="sent-line">
                <b className="font-semibold text-status-met">Sent {state.sentTime}</b> · approved by you · to {first} by email · kept under Reports, Sent reports
                {note ? ` · ${note}` : ""}
              </div>
            ) : (
              <div id="report-acts" className="border-t border-slate-100 px-[22px] py-3 text-[12.5px] text-muted-foreground" data-testid="skipped-line">
                <b className="font-semibold text-status-neutral">Skipped</b> · reason: {state.skipReason} · {first} gets nothing today; any reason still owed is asked on the next End of day
              </div>
            )}
            {state.status === "open" ? (
              skipOpen ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-[22px] py-3" data-testid="skip-box">
                  <span className="text-[12.5px] whitespace-nowrap text-muted-foreground">Why skip, one line</span>
                  <input value={skipWhy} onChange={(e) => setSkipWhy(e.target.value)} placeholder="For example: travel day" className={cn(INPUT, "h-[30px] flex-1 basis-[200px]")} data-testid="skip-reason" />
                  <RowButton onClick={skip} disabled={pending} data-testid="skip-confirm">
                    Skip
                  </RowButton>
                  <RowButton onClick={() => setSkipOpen(false)}>Cancel</RowButton>
                </div>
              ) : (
                <div className="px-[22px] pb-3.5">
                  <button type="button" onClick={() => setSkipOpen(true)} className="text-[12.5px] text-muted-foreground underline decoration-border hover:text-slate-900" data-testid="skip-today">
                    Skip today
                  </button>
                </div>
              )
            ) : null}
          </WorkCard>
        </div>
      </div>
      {drawer ? <TodayDrawer part={drawer} n={n} threshold={data.threshold} dateLabel={data.dateLabel} onClose={() => setDrawer(null)} /> : null}
    </>
  );
}

/** The one-line Today strip (Edit batch C, item 10): each figure is a link that opens the drawer listing its items. */
function TodayStrip({ parts, onOpen }: { parts: TodayPart[]; onOpen: (p: TodayPart) => void }) {
  return (
    <section className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-white px-[22px] py-3 text-[13px] text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="eod-today">
      <span className="font-semibold text-slate-900">Today:</span>
      {parts.map((p, i) => (
        // The dot follows its figure, so a wrapped second line never starts with one.
        <span key={p.key} className="inline-flex items-center gap-2 whitespace-nowrap">
          <button type="button" onClick={() => onOpen(p)} className={cn("font-medium hover:underline", p.key === "waits" && p.value ? "text-status-missed" : "text-primary-strong")} data-testid="eod-today-part" data-key={p.key} data-count={p.value}>
            <span className="tabular">{p.value}</span> {p.words}
          </button>
          {i < parts.length - 1 ? <span className="text-slate-400" aria-hidden>·</span> : null}
        </span>
      ))}
    </section>
  );
}

const DRAWER_TITLE: Record<TodayPart["key"], string> = { screened: "Listings screened today", moved: "Deals moved today", calls: "Calls today", emails: "Emails sent today", done: "Next actions done today", waits: "Waiting on someone" };

/** The drawer behind one figure of the Today strip: the items it counts, one per row. */
function TodayDrawer({ part, n, threshold, dateLabel, onClose }: { part: TodayPart; n: DayNumbers; threshold: number; dateLabel: string; onClose: () => void }) {
  type Item = { name: string; detail?: string | null; note?: string | null; tone?: "red" | "green" | "plain" };
  let items: Item[] = [];
  let empty = "None yet today.";
  if (part.key === "screened") items = n.screenedList.map((x) => ({ name: x.name, detail: x.outcome === "interested" ? "Interested" : `Passed${x.reason ? `: ${x.reason}` : ""}`, tone: x.outcome === "interested" ? "green" : "plain" }));
  else if (part.key === "moved") {
    items = n.moves.map((m) => ({ name: m.name, detail: `${m.from ?? "New"} to ${m.to}${m.lane !== "Deals" ? ` · ${m.lane}` : ""}`, note: m.keyFinding ? `Key finding: ${m.keyFinding}` : null }));
    empty = "No stage move today.";
  } else if (part.key === "calls") items = n.contactsList.filter((c) => c.kind === "call").map((c) => ({ name: c.name, detail: c.method === "video" ? "Video call" : c.method === "meeting" ? "Meeting" : "Call" }));
  else if (part.key === "emails") items = n.contactsList.filter((c) => c.kind === "email").map((c) => ({ name: c.name, detail: "Email sent" }));
  else if (part.key === "done") items = n.actionsDoneList.map((a) => ({ name: a.name, detail: a.label || null }));
  else {
    items = n.waits.map((w) => ({ name: w.name, detail: `${w.days} days${w.who ? ` · ${w.who}` : ""}`, note: w.what ? `Waiting on: ${w.what}${w.since ? `, since ${w.since}` : ""}` : null, tone: w.days >= threshold * 2 ? "red" : "plain" }));
    empty = `Nobody has kept you waiting over ${threshold} days.`;
  }
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={DRAWER_TITLE[part.key]} sub={`${dateLabel} · ${part.value} ${part.words}`} testId="eod-today-drawer">
      {items.length ? (
        <ul className="-mx-7 flex flex-col" data-testid="eod-today-items" data-key={part.key}>
          {items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="border-t border-slate-100 px-7 py-2.5 first:border-t-0" data-testid="eod-today-item">
              <div className="text-sm font-semibold text-slate-900">{it.name}</div>
              {it.detail ? <div className={cn("mt-0.5 text-[13px]", it.tone === "red" ? "font-medium text-status-missed" : it.tone === "green" ? "font-medium text-status-met" : "text-slate-700")}>{it.detail}</div> : null}
              {it.note ? <div className="mt-0.5 text-[12.5px] text-muted-foreground italic">{it.note}</div> : null}
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
