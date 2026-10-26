import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getGoogleConnection, oauthClient } from "@/lib/google";
import { canSendFromScopes, scopesAfterConnect } from "@/lib/google-scopes";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = await getOwner();
  if (!owner) return NextResponse.redirect(new URL("/login", env.appUrl));
  const jar = await cookies();
  const expected = jar.get("google_oauth_state")?.value;
  jar.delete("google_oauth_state");
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL(`/settings?google=denied`, env.appUrl));
  if (!expected || expected !== url.searchParams.get("state")) return NextResponse.redirect(new URL("/settings?google=state_mismatch", env.appUrl));
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?google=no_code", env.appUrl));
  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    // Reconnect updates the one saved connection row (owner_id is unique): tokens and scopes change, nothing is duplicated.
    const existing = await getGoogleConnection(owner.supabase, owner.ownerId);
    const keepOldToken = !tokens.refresh_token && !!existing?.refresh_token_enc && existing.status !== "disconnected";
    if (!tokens.refresh_token && !keepOldToken) return NextResponse.redirect(new URL("/settings?google=no_refresh_token", env.appUrl));
    let email: string | null = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
      email = ticket.getPayload()?.email ?? null;
    }
    // Kept old access: keep its saved scopes too (new permissions come only with a new refresh token).
    const scopes = keepOldToken ? ((existing?.scopes as string | null) ?? null) : scopesAfterConnect(tokens.scope, existing?.scopes);
    const row = {
      owner_id: owner.ownerId,
      google_email: email ?? existing?.google_email ?? null,
      refresh_token_enc: tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refresh_token_enc,
      scopes,
      status: "connected",
      connected_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      last_error: null,
    };
    const { error } = await owner.supabase.from("google_connections").upsert(row, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    await owner.supabase.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).eq("dedupe_key", "connection:google").eq("status", "open");
    await owner.supabase.from("tasks").update({ status: "done" }).eq("source", "connection").eq("status", "todo").ilike("title", "Reconnect Google%");
    return NextResponse.redirect(new URL(`/settings?google=${canSendFromScopes(scopes) ? "connected" : "connected_no_send"}`, env.appUrl));
  } catch {
    return NextResponse.redirect(new URL("/settings?google=failed", env.appUrl));
  }
}
