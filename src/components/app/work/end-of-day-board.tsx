"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndSend, saveReasons, saveReportEdit, saveTomorrow, skipToday, putShortReport } from "@/app/actions/accountability";
import type { ReasonDraft } from "@/lib/accountability/ask-ai";
import type { EndOfDayPage } from "@/lib/accountability/data";
import { END_OF_DAY_TIME, owedReasons, statusItems, type Judged } from "@/lib/accountability/targets";
import type { AskContext } from "@/lib/work/ask-ai";
import { AccountabilityTabs, type EodBadge } from "@/components/app/nav-links";
import { AiCardStar, AiFieldStar, AskAiPill, type EodExtras } from "@/components/app/work/ask-ai";
import { StatusMark } from "@/components/app/work/targets-ui";
import { Confirm, Figure, Line1, Line2, Line3, Name, Pill, PinnedBlock, RowButton, Rows, WorkCard, WorkHeader } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * End of day (batch C, approved 2026-10-31; decisions on v3 and v4): the status line with the three things to do
 * before sending (each a link to its card, the state live); "Today, counted" from the app's data; the Targets card
 * with the status mark left of the figure, the Commitment pill, and a one-line reason box on each missed Commitment
 * (the field star drafts it; "Same reason for all" fills every box); "What matters tomorrow" as a three-line box
 * that grows, with the star and the muted line under it; the "Report to <partner>" card with the email exactly as it
 * will be sent, Edit in place, Approve and send (with "N commitments have no reason yet", Give them or Send anyway),
 * then "Sent 5:41 pm", and Skip today with a reason. Weekday targets are judged daily; weekly ones on Friday.
 */
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const FIG = "w-[82px]";

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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px] min-[1400px]:grid-cols-[minmax(0,1fr)_460px]">
        <div className="flex flex-col gap-4">
          <WorkCard title="Today, counted" hint="From what you did in the app" testId="eod-counted">
            <Rows>
              <CountedRow name="Listings screened" line={n.screened.detail || "None screened yet"} figures={[{ value: String(n.screened.value), label: "Screened" }]} />
              <CountedRow
                name="Deals moved"
                what={n.moves.length ? n.moves.map((m) => `${m.name}, ${m.from ?? "new"} to ${m.to}`).join(" · ") : undefined}
                line={n.moves.length ? undefined : "No stage move today"}
                finding={n.moves.find((m) => m.keyFinding)?.keyFinding ? `Key finding: ${n.moves.find((m) => m.keyFinding)!.keyFinding}` : undefined}
                figures={[{ value: String(n.moves.length), label: "Moved" }]}
              />
              <CountedRow name="Calls and emails" line={[n.calls.detail ? `Calls: ${n.calls.detail}` : "", n.emails.detail ? `Emails: ${n.emails.detail}` : ""].filter(Boolean).join(" · ") || (n.calls.value + n.emails.value ? `${n.outreachToday.value} on Outreach` : "None logged yet")} figures={[{ value: String(n.calls.value), label: "Calls" }, { value: String(n.emails.value), label: "Emails" }]} />
              <CountedRow name="Next actions done" line={n.actionsDone.detail || "None marked Done yet"} figures={[{ value: String(n.actionsDone.value), label: "Done" }]} />
              <CountedRow name="Waiting on brokers" line={n.allWaits.length ? n.allWaits.map((w) => `${w.name} ${w.days} ${w.days === 1 ? "day" : "days"}${w.who ? ` (${w.who})` : ""}`).join(" · ") : "Nobody is keeping you waiting"} figures={[{ value: String(n.waits.length), label: `Over ${data.threshold} days`, tone: n.waits.length ? "over" : "plain" }]} />
            </Rows>
          </WorkCard>

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
                  <div key={j.targetId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0 sm:gap-x-4" data-testid="eod-target" data-target={j.name} data-met={j.judged ? (j.met ? "1" : "0") : "now"} data-asks={ask ? "1" : "0"}>
                    <div className="min-w-0">
                      <Line1>
                        <Name>{j.name}</Name>
                        {j.commitment ? <Pill tone="blue">Commitment</Pill> : null}
                      </Line1>
                      <Line2>{j.line}</Line2>
                    </div>
                    <StatusMark mark={!j.judged ? "now" : j.met ? "met" : "missed"} />
                    <Figure value={j.figure} label={!j.judged ? "Under way" : j.met ? "Met" : "Missed"} tone={!j.judged ? "plain" : j.met ? "plain" : "red"} className={cn(FIG, j.judged && j.met && "[&>b]:text-status-met")} testId="eod-figure" />
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
              {owedPrev
                ? owedPrev.items.map((j) => (
                    <div key={owedKey(j)} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] sm:gap-x-4" data-testid="eod-owed" data-target={j.name}>
                      <div className="min-w-0">
                        <Line1>
                          <Name>{j.name}</Name>
                          <Pill tone="blue">Commitment</Pill>
                          <Pill tone="amber">Owed from {owedPrev.dayLabel}</Pill>
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
                  ))
                : null}
            </Rows>
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

        <div className="flex flex-col gap-4">
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
    </>
  );
}

function CountedRow({ name, what, line, finding, figures }: { name: string; what?: string; line?: string; finding?: string; figures: { value: string; label: string; tone?: "plain" | "over" }[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0 sm:gap-x-[18px]" data-testid="counted-row" data-name={name}>
      <div className="min-w-0">
        <Line1>
          <Name>{name}</Name>
          {what ? <span className="min-w-0 text-[13px] text-muted-foreground">{what}</span> : null}
        </Line1>
        {line ? <Line2>{line}</Line2> : null}
        {finding ? <Line3>{finding}</Line3> : null}
      </div>
      <div className="flex items-end gap-x-4 whitespace-nowrap sm:gap-x-5" data-row-right>
        {figures.map((f) => (
          <Figure key={f.label} value={f.value} label={f.label} tone={f.tone ?? "plain"} className="w-[88px] items-end sm:w-[96px]" testId="counted-figure" />
        ))}
      </div>
    </div>
  );
}

