import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { env, isGoogleConfigured } from "@/lib/env";
import { GOOGLE_SCOPES, oauthClient } from "@/lib/google";

/** Starts "Connect Google": offline access so the app can create Gmail drafts and calendar events without Bram signing in each time. */
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.redirect(new URL("/login", env.appUrl));
  if (!isGoogleConfigured()) return NextResponse.redirect(new URL("/settings?google=not_configured", env.appUrl));
  const state = randomToken(16);
  (await cookies()).set("google_oauth_state", state, { httpOnly: true, secure: env.appUrl.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  const url = oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES, state, include_granted_scopes: true });
  return NextResponse.redirect(url);
}
