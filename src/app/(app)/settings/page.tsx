import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { env, isAIConfigured, isGoogleConfigured, isPlaidConfigured } from "@/lib/env";
import { aiBudget } from "@/lib/ai/claude";
import { getGoogleConnection } from "@/lib/google";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DetailGrid, Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { PlaidLinkButton } from "@/components/app/plaid-link-button";
import { disconnectGoogle, disconnectPlaidItem, plaidSyncNow, runEveningNow, runMorningNow } from "@/app/actions/settings";
import { dateTime, money } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Connections" };

const GOOGLE_MESSAGES: Record<string, string> = {
  connected: "Google is connected.",
  denied: "Google access was not granted.",
  state_mismatch: "The Google sign-in could not be verified. Try again.",
  no_refresh_token: "Google did not return offline access. Remove the app in your Google account permissions, then connect again.",
  failed: "The Google connection failed. Try again.",
  not_configured: "Google is not set up on the server yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and TOKEN_ENCRYPTION_KEY in Vercel.",
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const [google, budget, { data: items }] = await Promise.all([getGoogleConnection(supabase, ownerId), aiBudget(supabase, ownerId), supabase.from("plaid_items").select("*").order("created_at")]);
  const plaidItems = (items ?? []) as Row[];
  const gStatus = google?.status ?? "disconnected";
  return (
    <div>
      <PageHeader title="Connections" description="Google (Gmail and Calendar), Plaid, and the Anthropic API. Connections are checked every day; a failure creates an alert and a reconnect task." />
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
            <CardDescription>Creates Gmail drafts (you press send), adds calendar events, and reads today&apos;s meetings.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DetailGrid
              items={[
                { label: "Account", value: google?.google_email ?? "None" },
                { label: "Last checked", value: google?.last_checked_at ? dateTime(google.last_checked_at) : "Never" },
                ...(google?.last_error ? [{ label: "Last error", value: <span className="text-red-700">{google.last_error}</span> }] : []),
              ]}
            />
            {!isGoogleConfigured() ? <Notice tone="warn">Not set up on the server yet. See docs/SETUP-CHECKLIST.md, step Google.</Notice> : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" disabled={!isGoogleConfigured()}>
                <a href="/api/google/connect">{gStatus === "disconnected" ? "Connect Google" : "Reconnect Google"}</a>
              </Button>
              {gStatus !== "disconnected" ? (
                <form action={disconnectGoogle}>
                  <SubmitButton size="sm" variant="outline">
                    Disconnect
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Plaid (bank feed){" "}
              <Badge variant={!isPlaidConfigured() ? "neutral" : plaidItems.some((i) => i.status === "error") ? "danger" : plaidItems.length ? "success" : "neutral"}>
                {!isPlaidConfigured() ? "Not connected yet" : plaidItems.length ? `${plaidItems.filter((i) => i.status !== "disconnected").length} connected` : "No institutions"}
              </Badge>
            </CardTitle>
            <CardDescription>Imports transactions automatically each morning, before the morning plan. Rows matching CSV imports are merged, not added twice.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!isPlaidConfigured() ? (
              <Notice>Not connected yet. Plaid is planned after the first week of use. Add PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV in Vercel to turn it on.</Notice>
            ) : (
              <>
                {plaidItems.length ? (
                  <ul className="flex flex-col gap-2">
                    {plaidItems.map((i) => (
                      <li key={i.id} className="flex items-start justify-between gap-2 rounded-md border border-border p-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">{i.institution_name ?? "Institution"}</p>
                          <p className="text-xs text-muted-foreground">
                            {i.status}. Last sync {i.last_synced_at ? dateTime(i.last_synced_at) : "never"}.{i.last_error ? ` Error: ${i.last_error}` : ""}
                          </p>
                        </div>
                        {i.status !== "disconnected" ? (
                          <form action={disconnectPlaidItem}>
                            <input type="hidden" name="id" value={i.id} />
                            <SubmitButton size="sm" variant="ghost">
                              Stop syncing
                            </SubmitButton>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <PlaidLinkButton />
                {plaidItems.length ? (
                  <form action={plaidSyncNow}>
                    <SubmitButton size="sm" variant="outline" pendingText="Syncing...">
                      Sync now
                    </SubmitButton>
                  </form>
                ) : null}
              </>
            )}
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
                <Link href="/settings/ai">Usage and proposals</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/plan/inputs">Change the cap</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2 xl:col-span-3">
          <CardHeader>
            <CardTitle>Scheduled jobs</CardTitle>
            <CardDescription>
              Vercel runs the morning job and the evening job once a day (see README, Cron). The morning job syncs Plaid, applies category rules, finds recurring charges, checks connections, creates recurring and pipeline tasks and follow-ups, checks commitments, milestones, and decision conditions, drafts due reviews and partner reports, adds calendar time blocks, and writes the morning plan. The evening job drafts the daily close, checks the day&apos;s commitments, and checks decision conditions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <form action={runMorningNow}>
              <SubmitButton size="sm" variant="outline" pendingText="Running morning job...">
                Run the morning job now
              </SubmitButton>
            </form>
            <form action={runEveningNow}>
              <SubmitButton size="sm" variant="outline" pendingText="Running evening job...">
                Run the evening job now
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
