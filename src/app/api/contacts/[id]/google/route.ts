import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadContactExtras } from "@/lib/work/contact-google";

/** A contact's calendar meetings and Gmail threads for the timeline (release 3c). ?all=1 for 50 threads; ?only=gmail skips the calendar. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const ctx = await loadCtx(owner.supabase, owner.ownerId);
  const r = await loadContactExtras(owner.supabase, owner.ownerId, ctx.tz, id, { all: url.searchParams.get("all") === "1", gmailOnly: url.searchParams.get("only") === "gmail" });
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
