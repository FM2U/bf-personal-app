import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { isPlaidConfigured } from "@/lib/env";
import { createLinkToken } from "@/lib/plaid";

export async function POST() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!isPlaidConfigured()) return NextResponse.json({ error: "Plaid is not connected yet. Add PLAID_CLIENT_ID and PLAID_SECRET in Vercel." }, { status: 400 });
  try {
    return NextResponse.json({ link_token: await createLinkToken(owner.ownerId) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Plaid request failed" }, { status: 500 });
  }
}
