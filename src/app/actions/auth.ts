"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type AuthState = { error?: string; message?: string } | null;

export async function signIn(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (env.ownerEmail && email !== env.ownerEmail) return { error: "This app has one owner account. That email cannot sign in." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email or password is not correct." };
  redirect("/mfa");
}

/** Sign-up is limited to the single owner email set in OWNER_EMAIL. The database also blocks a second account. */
export async function signUp(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!env.ownerEmail) return { error: "OWNER_EMAIL is not set on the server. Add it in Vercel first." };
  if (email !== env.ownerEmail) return { error: "Only the owner email set on the server can create the account." };
  if (password.length < 12) return { error: "Use a password of at least 12 characters." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${env.appUrl}/mfa` } });
  if (error) return { error: error.message };
  return { message: "Account created. If Supabase asks you to confirm your email, open the confirmation email first. Then sign in." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
