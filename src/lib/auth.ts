import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

type OwnerContext = { supabase: SupabaseClient; user: User; ownerId: string };

/**
 * Every app page and action calls this. It requires a signed-in owner who has passed the
 * authenticator-app step (assurance level aal2). Otherwise it sends the person to sign in or to the second step.
 */
export const requireOwner = cache(checkOwner);

/**
 * Page speed (2026-11-06): one sign-in check per page build. The layout, the page and its parts all ask; they share
 * the first answer. Outside a page build (a server action) every call checks, as before.
 */
async function checkOwner(): Promise<OwnerContext> {
  const supabase = await createClient();
  // One sign-in check per click (speed plan, 2026-11-07): the proxy (src/proxy.ts) already confirmed the session for
  // this request and passed who it is; without that, ask Supabase as before.
  const checked = await fromProxy();
  if (checked) {
    if (env.ownerEmail && checked.email?.toLowerCase() !== env.ownerEmail) {
      await supabase.auth.signOut();
      redirect("/login?error=not_owner");
    }
    if (checked.aal !== "aal2") redirect("/mfa");
    return { supabase, user: { id: checked.id, email: checked.email ?? undefined } as User, ownerId: checked.id };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (env.ownerEmail && data.user.email?.toLowerCase() !== env.ownerEmail) {
    await supabase.auth.signOut();
    redirect("/login?error=not_owner");
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/mfa");
  return { supabase, user: data.user, ownerId: data.user.id };
}

/** Who the proxy confirmed for this request (src/proxy.ts sets the header and removes any copy a browser sent). */
async function fromProxy(): Promise<{ id: string; email: string | null; aal: string | null } | null> {
  try {
    const raw = (await headers()).get("x-bf-owner");
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; email?: unknown; aal?: unknown };
    return typeof v.id === "string" && v.id ? { id: v.id, email: typeof v.email === "string" ? v.email : null, aal: typeof v.aal === "string" ? v.aal : null } : null;
  } catch {
    return null;
  }
}

/** For API routes: returns null instead of redirecting. */
export async function getOwner(): Promise<OwnerContext | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  if (env.ownerEmail && data.user.email?.toLowerCase() !== env.ownerEmail) return null;
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return null;
  return { supabase, user: data.user, ownerId: data.user.id };
}
