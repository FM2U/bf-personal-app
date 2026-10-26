import JSZip from "jszip";
import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { EXPORT_TABLES } from "@/lib/resources";
import { readTable, toCsv } from "@/lib/export";

export const maxDuration = 120;

/** One-click full export: data.json plus one CSV per table, in a zip file. Encrypted tokens are left out. */
export async function GET() {
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
  await owner.supabase.from("tasks").update({ status: "done" }).eq("status", "todo").ilike("title", "%full data export%");
  return new NextResponse(Buffer.from(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="bf-personal-app-export-${stamp}.zip"` },
  });
}
