import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { env, isAIConfigured, isGoogleConfigured } from "@/lib/env";
import { aiBudget } from "@/lib/ai/claude";
import { aiSpendLine, nearCap } from "@/lib/ai/spend";
import { getGoogleConnection } from "@/lib/google";
import { Notice } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { disconnectGoogle, runChecksNow } from "@/app/actions/settings";
import { date as fmtDate, formatInZone } from "@/lib/format";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { ReconnectGoogle } from "@/components/app/send-email";
import { calendarPermission, reconnectMessage, replyPermission, sendPermission, signaturePermission, type SendPermission } from "@/lib/google-scopes";
import { readSignatureRow } from "@/lib/signature-store";
import { loadCtx } from "@/lib/engine/helpers";
import { todayInTz } from "@/lib/calc/dates";
import { loadPipelineOfKind, loadWorkCtx } from "@/lib/work/data";
import { loadBuyBoxSettings } from "@/lib/work/buy-box-data";
import { amountWords, regionWords } from "@/lib/work/buy-box";
import { PHASES } from "@/lib/work/phases";
import { JOB_PHASES } from "@/lib/work/pipelines";
import { DEFAULT_BLOCK_MINUTES } from "@/lib/work/time-blocks";
import { WorkShell } from "@/components/app/work/shell";
import { Pill, PinnedBlock, RowLink, WorkCard, WorkHeader, type PillTone } from "@/components/app/work/ui";
import { AiCapInput, KV, PipelinesCard, SettingsSectionNav, WorkSettingsCard, type SettingsPipeline } from "@/components/app/settings-board";
import type { Row } from "@/lib/types";

export const metadata = { title: "Settings" };

const GOOGLE_MESSAGES: Record<string, string> = {
  connected: "Google is connected. Sending from the app is allowed.",
  connected_no_send: "Google is connected, but sending from the app was not allowed on Google's screen. Press Reconnect Google and leave \"Send email on your behalf\" checked.",
  connected_no_signature: "Google is connected and sending is allowed, but reading your Gmail signature was not allowed on Google's screen. Press Reconnect Google and keep every box checked.",
  connected_no_replies: "Google is connected and sending is allowed, but reading replies was not allowed on Google's screen. Press Reconnect Google and keep every box checked.",
  denied: "Google access was not granted.",
  state_mismatch: "The Google sign-in could not be verified. Try again.",
  no_refresh_token: "Google did not return offline access. Remove the app in your Google account permissions, then connect again.",
  failed: "The Google connection failed. Try again.",
  not_configured: "Google is not set up on the server yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and TOKEN_ENCRYPTION_KEY in Vercel.",
};

const SECTIONS = [
  ["s-conn", "Gmail and Google Calendar"],
  ["s-work", "Work settings"],
  ["s-pipe", "Pipelines and stage defaults"],
  ["s-buy", "Buy box"],
  ["s-ai", "AI"],
  ["s-prof", "Profile and export"],
] as const;

const PERM_PILL: Record<SendPermission, { tone: PillTone; text: string }> = {
  allowed: { tone: "green", text: "Connected" },
  reconnect: { tone: "amber", text: "Reconnect needed" },
  not_connected: { tone: "gray", text: "Not connected" },
};

const BTN = "inline-flex h-7 items-center rounded-[7px] border border-input bg-white px-2.5 text-xs font-medium whitespace-nowrap text-slate-800 hover:bg-slate-50";

/**
 * Settings, one page (push D, approved mockup 2026-11-02 V.setup): the title with the section chips (each jumps to its
 * card), then Gmail and Google Calendar beside Work settings, Pipelines and stage defaults across the page (a table
 * per pipeline), and Buy box, AI, Profile and export side by side. The longer screens stay one click away: Email
 * signature, Buy box, AI usage, Profile and security (the sign-in second step), Export, and Sample data.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [google, budget, signature, wctx, acq, job, con, buyBox, { data: profile }, { data: outreachRow }] = await Promise.all([
    getGoogleConnection(supabase, ownerId),
    aiBudget(supabase, ownerId),
    readSignatureRow(supabase, ownerId),
    loadWorkCtx(supabase, ownerId),
    loadPipelineOfKind(supabase, ownerId, "acquisition"),
    loadPipelineOfKind(supabase, ownerId, "job"),
    loadPipelineOfKind(supabase, ownerId, "consulting"),
    loadBuyBoxSettings(supabase, ownerId),
    supabase.from("owner_profile").select("display_name,timezone,default_block_minutes").eq("owner_id", ownerId).maybeSingle(),
    supabase.from("inputs").select("value_number").eq("owner_id", ownerId).eq("key", "outreach_weekly_target").maybeSingle(),
  ]);
  const configured = isGoogleConfigured();
  const gStatus = google?.status ?? "disconnected";
  const sendPerm = configured ? sendPermission(google) : "not_connected";
  const sigPerm = configured ? signaturePermission(google) : "not_connected";
  const replyPerm = configured ? replyPermission(google) : "not_connected";
  const calPerm = configured ? calendarPermission(google) : "not_connected";
  const gmailPerm: SendPermission = sendPerm === "not_connected" ? "not_connected" : sendPerm === "allowed" && sigPerm === "allowed" && replyPerm === "allowed" ? "allowed" : "reconnect";
  const reconnect = reconnectMessage(sendPerm, sigPerm, replyPerm);
  const checked = google?.last_checked_at ? `checked ${todayInTz(ctx.tz, new Date(String(google.last_checked_at))) === ctx.today ? "today" : fmtDate(todayInTz(ctx.tz, new Date(String(google.last_checked_at))), "MMM d")} ${formatInZone(String(google.last_checked_at), "h:mm a", ctx.tz).toLowerCase()}` : "not checked yet";
  const p = (profile as Row | null) ?? {};
  const outreach = Number((outreachRow as Row | null)?.value_number);
  const blockMinutes = Number(p.default_block_minutes);
  const stageGroups = (pipe: Awaited<ReturnType<typeof loadPipelineOfKind>>, phases: readonly { name: string; stages: readonly string[] }[] | null): SettingsPipeline["groups"] => {
    if (!pipe) return [];
    const open = pipe.stages.filter((s) => s.outcome === "open");
    const row = (s: (typeof open)[number]) => ({ id: s.id, name: s.name, title: s.defaultTitle ?? "", dueInDays: s.defaultDueInDays });
    if (!phases) return [{ name: null, stages: open.map(row) }];
    const used = new Set<string>();
    const groups = phases.map((ph) => ({ name: ph.name, stages: ph.stages.map((n) => open.find((s) => s.name === n)).filter((s): s is (typeof open)[number] => !!s).map((s) => (used.add(s.id), row(s))) }));
    const rest = open.filter((s) => !used.has(s.id));
    return [...groups.filter((g) => g.stages.length), ...(rest.length ? [{ name: "Other", stages: rest.map(row) }] : [])];
  };
  const pipelines: SettingsPipeline[] = [
    acq ? { id: acq.id, kind: "acquisition" as const, label: "Acquisition", groups: stageGroups(acq, PHASES) } : null,
    job ? { id: job.id, kind: "job" as const, label: "Job search", groups: stageGroups(job, JOB_PHASES) } : null,
    con ? { id: con.id, kind: "consulting" as const, label: "Consulting", groups: stageGroups(con, null) } : null,
  ].filter((x): x is SettingsPipeline => !!x);
  const regions = regionWords(buyBox);

  return (
    <WorkShell testId="settings-page">
      <PinnedBlock testId="settings-sticky">
        <WorkHeader title="Settings" />
        <SettingsSectionNav sections={SECTIONS} />
      </PinnedBlock>

      {sp.google ? (
        <div className="mb-4">
          <Notice tone={sp.google === "connected" ? "success" : "warn"}>{GOOGLE_MESSAGES[sp.google] ?? sp.google}</Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1000px]:grid-cols-2">
        <WorkCard
          id="s-conn"
          title="Gmail and Google Calendar"
          sub={gStatus === "disconnected" ? "Not connected" : `${google?.google_email ? String(google.google_email) : "Connected"} · ${checked}`}
          actions={
            gStatus !== "disconnected" ? (
              <GuardedForm action={disconnectGoogle}>
                <SubmitButton size="sm" variant="outline" pendingText="Disconnecting..." className="h-7 px-2.5 text-xs" data-testid="google-disconnect">
                  Disconnect
                </SubmitButton>
              </GuardedForm>
            ) : (
              // Google's own sign-in page: a plain link is correct here.
              <a href="/api/google/connect" className={BTN} data-testid="google-connect">
                Connect Google
              </a>
            )
          }
          headerClassName="min-h-[76px]"
          testId="google-card"
        >
          <div className="flex flex-col px-[22px] pt-1 pb-4">
            <ConnRow name="Gmail" perm={configured ? gmailPerm : "not_connected"} line="Sends your emails and reports, reads replies to them, reads your signature" connected={gStatus !== "disconnected"} testId="conn-gmail" />
            <ConnRow name="Google Calendar" perm={calPerm} line="Shows your events, adds the time you block" connected={gStatus !== "disconnected"} testId="conn-calendar" />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-slate-100 py-2.5" data-testid="conn-signature">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Email signature</div>
                <div className="text-[12.5px] text-muted-foreground">{signature.html && signature.updatedAt ? `Saved ${fmtDate(todayInTz(ctx.tz, new Date(signature.updatedAt)), "MMM d")} from Gmail${signature.enabled === false ? " · off" : ""}` : "Not saved yet"}</div>
              </div>
              <Link href="/settings/email" className={BTN} data-testid="open-signature">
                Email signature
              </Link>
            </div>
            {sendPerm === "allowed" ? <p className="border-t border-slate-100 pt-2.5 text-[12.5px] text-muted-foreground" data-testid="conn-allowed">Sending from the app: <span className="font-medium text-status-met">Allowed</span>{sigPerm === "allowed" ? <> · Gmail signature: <span className="font-medium text-status-met">Can be copied</span></> : null}</p> : null}
            {google?.last_error ? <p className="pt-2 text-[12.5px] text-status-missed">Last error: {String(google.last_error)}</p> : null}
            {!configured ? (
              <div className="pt-2">
                <Notice tone="warn">Not set up on the server yet. See docs/SETUP-CHECKLIST.md, step Google.</Notice>
              </div>
            ) : null}
            {reconnect ? (
              <div className="pt-2.5">
                <ReconnectGoogle stacked message={reconnect} />
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <GuardedForm action={runChecksNow}>
                <SubmitButton size="sm" variant="outline" pendingText="Checking...">
                  Run the checks now
                </SubmitButton>
              </GuardedForm>
              <span className="text-[12.5px] text-muted-foreground">Checked every morning; a problem shows as a to-do on Home.</span>
            </div>
          </div>
        </WorkCard>

        <WorkSettingsCard initial={{ threshold: wctx.threshold, noReply: wctx.noReplyDays, outreach: Number.isFinite(outreach) && outreach > 0 ? Math.round(outreach) : 10, eodTime: wctx.eodTime, blockMinutes: Number.isFinite(blockMinutes) && blockMinutes >= 5 ? blockMinutes : DEFAULT_BLOCK_MINUTES }} />
      </div>

      <div className="mt-4">
        <PipelinesCard pipelines={pipelines} />
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 md:grid-cols-3">
        <WorkCard id="s-buy" title="Buy box" actions={<RowLink href="/settings/buy-box" className="h-7 px-2.5 text-xs" data-testid="open-buy-box">Open</RowLink>} testId="settings-buy-box">
          <div className="px-[22px] pt-1 pb-3">
            <KV label="Core size">
              {amountWords(buyBox.coreMin)} to {amountWords(buyBox.coreMax)}
            </KV>
            <KV label="Regions">{regions.length ? regions.join(", ") : "Any US region"}</KV>
            <KV label="Owner-operator">{buyBox.ownerOperator ? "Yes" : "No"}</KV>
          </div>
        </WorkCard>
        <WorkCard id="s-ai" title="AI" actions={<RowLink href="/settings/ai" className="h-7 px-2.5 text-xs" data-testid="open-ai-usage">Usage</RowLink>} testId="settings-ai">
          <div className="px-[22px] pt-1 pb-3">
            <p className={nearCap(budget.spent, budget.cap) || budget.blocked ? "tabular border-b border-slate-100 py-2.5 text-[13px] font-medium text-status-soon" : "tabular border-b border-slate-100 py-2.5 text-[13px] font-medium text-slate-900"} data-testid="ai-spend-line">
              {aiSpendLine(budget.spent, budget.cap)}
            </p>
            <KV label="Monthly cap">
              <AiCapInput cap={budget.cap} />
            </KV>
            <KV label="Model">
              <span className="truncate">{env.anthropicModel}</span>
            </KV>
            <KV label="Status">{isAIConfigured() ? (budget.blocked ? "Cap reached" : "Set up") : "Not set up"}</KV>
          </div>
        </WorkCard>
        <WorkCard id="s-prof" title="Profile and export" actions={<RowLink href="/settings/profile" className="h-7 px-2.5 text-xs" data-testid="open-profile">Edit</RowLink>} testId="settings-profile">
          <div className="px-[22px] pt-1 pb-3">
            <KV label="Name">{String(p.display_name ?? "") || "Not set"}</KV>
            <KV label="Time zone">{String(p.timezone ?? ctx.tz).replace(/_/g, " ")}</KV>
            <KV label="Export">
              {/* A file download, not a page: a plain link is correct here. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/export/full" className={BTN} data-testid="export-all">
                Download all
              </a>
              <Link href="/settings/export" className="text-[12.5px] font-medium text-primary-strong hover:underline">
                One list
              </Link>
            </KV>
            <KV label="Sample data">
              <Link href="/settings/data" className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="open-sample-data">
                Load or remove
              </Link>
            </KV>
          </div>
        </WorkCard>
      </div>
    </WorkShell>
  );
}

/** One connection line: the name with its state pill, what it does, and Connect or Reconnect. */
function ConnRow({ name, perm, line, connected, testId }: { name: string; perm: SendPermission; line: string; connected: boolean; testId: string }) {
  const pill = PERM_PILL[perm];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-slate-100 py-2.5 first:border-t-0" data-testid={testId} data-perm={perm}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{name}</span>
          <Pill tone={pill.tone}>{pill.text}</Pill>
        </div>
        <div className="text-[12.5px] text-muted-foreground">{line}</div>
      </div>
      {/* Google's own sign-in page: a plain link is correct here. */}
      <a href="/api/google/connect" className={BTN} data-testid={`${testId}-connect`}>
        {connected ? "Reconnect" : "Connect"}
      </a>
    </div>
  );
}
