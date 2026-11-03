import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { env, isAIConfigured, isGoogleConfigured } from "@/lib/env";
import { aiBudget } from "@/lib/ai/claude";
import { aiSpendLine, nearCap } from "@/lib/ai/spend";
import { getGoogleConnection } from "@/lib/google";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DetailGrid, Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { disconnectGoogle, runChecksNow } from "@/app/actions/settings";
import { dateTime, money } from "@/lib/format";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { ReconnectGoogle } from "@/components/app/send-email";
import { reconnectMessage, replyPermission, sendPermission, signaturePermission } from "@/lib/google-scopes";
import { StatusText } from "@/components/ui/badge";

export const metadata = { title: "Connections" };

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

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const [google, budget] = await Promise.all([getGoogleConnection(supabase, ownerId), aiBudget(supabase, ownerId)]);
  const gStatus = google?.status ?? "disconnected";
  const sendPerm = isGoogleConfigured() ? sendPermission(google) : "not_connected";
  const sigPerm = isGoogleConfigured() ? signaturePermission(google) : "not_connected";
  const replyPerm = isGoogleConfigured() ? replyPermission(google) : "not_connected";
  const reconnect = reconnectMessage(sendPerm, sigPerm, replyPerm);
  return (
    <div>
      <PageHeader title="Connections" description="Google (Gmail and Calendar) and the Anthropic API. Both are checked every morning; a problem shows as a to-do on Home." />
      {sp.google ? (
        <div className="mb-4">
          <Notice tone={sp.google === "connected" ? "success" : "warn"}>{GOOGLE_MESSAGES[sp.google] ?? sp.google}</Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Google <Badge variant={gStatus === "connected" ? "success" : gStatus === "error" ? "danger" : "neutral"}>{gStatus === "connected" ? "Connected" : gStatus === "error" ? "Failed" : "Not connected"}</Badge>
            </CardTitle>
            <CardDescription>Sends an email only after you confirm it, creates Gmail drafts, adds calendar events, reads today&apos;s meetings, and reads replies in the threads of what the app sent (no other mail).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DetailGrid
              items={[
                { label: "Account", value: google?.google_email ?? "None" },
                { label: "Last checked", value: google?.last_checked_at ? dateTime(google.last_checked_at) : "Never" },
                ...(sendPerm === "allowed" ? [{ label: "Sending from the app", value: <StatusText status="met">Allowed</StatusText> }] : []),
                ...(sigPerm === "allowed" ? [{ label: "Gmail signature", value: <StatusText status="met">Can be copied</StatusText> }] : []),
                ...(replyPerm === "allowed" ? [{ label: "Replies", value: <StatusText status="met">Read from the threads the app sent</StatusText> }] : []),
                ...(google?.last_error ? [{ label: "Last error", value: <span className="text-status-missed">{google.last_error}</span> }] : []),
              ]}
            />
            {!isGoogleConfigured() ? <Notice tone="warn">Not set up on the server yet. See docs/SETUP-CHECKLIST.md, step Google.</Notice> : null}
            {reconnect ? <ReconnectGoogle stacked message={reconnect} /> : null}
            <div className="flex flex-wrap gap-2">
              {reconnect ? null : (
                <Button asChild size="sm" disabled={!isGoogleConfigured()}>
                  { }
                  <a href="/api/google/connect">{gStatus === "disconnected" ? "Connect Google" : "Reconnect Google"}</a>
                </Button>
              )}
              {gStatus !== "disconnected" ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/settings/email">Email signature</Link>
                </Button>
              ) : null}
              {gStatus !== "disconnected" ? (
                <GuardedForm action={disconnectGoogle}>
                  <SubmitButton size="sm" variant="outline">
                    Disconnect
                  </SubmitButton>
                </GuardedForm>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Anthropic API (AI) <Badge variant={isAIConfigured() ? (budget.blocked ? "danger" : "success") : "neutral"}>{isAIConfigured() ? (budget.blocked ? "Cap reached" : "Set up") : "Not set up"}</Badge>
            </CardTitle>
            <CardDescription>The AI stops when the monthly cap is reached.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className={nearCap(budget.spent, budget.cap) || budget.blocked ? "tabular text-sm font-medium text-status-soon" : "tabular text-sm font-medium text-slate-900"} data-testid="ai-spend-line">
              {aiSpendLine(budget.spent, budget.cap)}
            </p>
            <DetailGrid
              items={[
                { label: "Model", value: env.anthropicModel },
                { label: "Spent this month", value: money(budget.spent, true) },
                { label: "Monthly cap", value: money(budget.cap, true) },
                { label: "Remaining", value: money(budget.remaining, true) },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/settings/ai">Usage and cap</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Daily checks</CardTitle>
            <CardDescription>Each morning the app checks the Google connection and the Anthropic key. A problem shows as a to-do on Home.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <GuardedForm action={runChecksNow}>
              <SubmitButton size="sm" variant="outline" pendingText="Checking...">
                Run the checks now
              </SubmitButton>
            </GuardedForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
