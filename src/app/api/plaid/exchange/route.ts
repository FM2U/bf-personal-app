import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { isPlaidConfigured } from "@/lib/env";
import { exchangePublicToken, syncPlaidItem } from "@/lib/plaid";
import { applyCategoryRules, detectAndSaveRecurring } from "@/lib/engine/finance-jobs";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";

export const maxDuration = 60;

/** Exchanges the one-time token from Plaid Link, stores the encrypted access token, and runs the first sync. */
export async function POST(req: Request) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isPlaidConfigured()) return NextResponse.json({ error: "Plaid is not connected yet." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { public_token?: string; institution?: string | null };
  if (!body.public_token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  try {
    const itemId = await exchangePublicToken(owner.supabase, owner.ownerId, body.public_token, body.institution ?? null);
    const { data: item } = await owner.supabase.from("plaid_items").select("*").eq("item_id", itemId).single();
    const result = item ? await syncPlaidItem(owner.supabase, owner.ownerId, item) : null;
    const ctx = await loadCtx(owner.supabase, owner.ownerId);
    await applyCategoryRules(owner.supabase, owner.ownerId);
    await detectAndSaveRecurring(owner.supabase, owner.ownerId, ctx.today);
    await evaluateConditions(ctx);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Plaid request failed" }, { status: 500 });
  }
}
