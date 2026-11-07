import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
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
