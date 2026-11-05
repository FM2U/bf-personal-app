import JSZip from "jszip";
import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { EXPORT_TABLES, readTable, toCsv } from "@/lib/export";
import { parseMonthSlug } from "@/lib/accountability/monthly";

export const maxDuration = 120;

/**
 * One-click full export: data.json plus one CSV per table, in a zip file. Encrypted tokens are left out. Push D: from a
 * monthly review (?review=2026-10) the download is noted on that review ("Export downloaded Nov 4").
 */
export async function GET(request: Request) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const zip = new JSZip();
  const all: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) {
    try {
      const rows = await readTable(owner.supabase, t);
      all[t] = rows;
      zip.file(`csv/${t}.csv`, toCsv(rows));
    } catch (e) {
      all[t] = [{ export_error: e instanceof Error ? e.message : String(e) }];
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  zip.file("data.json", JSON.stringify({ exported_at: new Date().toISOString(), tables: all }, null, 2));
  zip.file("README.txt", "Full export of BF Personal App. data.json holds every table. The csv folder holds one CSV file per table. Encrypted connection tokens are not included.\n");
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const review = parseMonthSlug(new URL(request.url).searchParams.get("review"));
  if (review) {
    // The review row is made on the first export when the review was not opened before; a failure never stops the download.
    const { data } = await owner.supabase.from("monthly_reviews").select("id").eq("owner_id", owner.ownerId).eq("month", review).maybeSingle();
    const at = new Date().toISOString();
    if (data) await owner.supabase.from("monthly_reviews").update({ exported_at: at }).eq("id", (data as { id: string }).id);
    else await owner.supabase.from("monthly_reviews").insert({ owner_id: owner.ownerId, month: review, exported_at: at });
  }
  const res = new NextResponse(Buffer.from(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="bf-personal-app-export-${stamp}.zip"` },
  });
  return res;
}
