import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { EXPORT_TABLES } from "@/lib/resources";
import { readTable, toCsv } from "@/lib/export";

/** CSV export of one table. Example: /api/export/transactions */
export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { table } = await params;
  const name = table.replace(/\.csv$/, "");
  if (!EXPORT_TABLES.includes(name)) return NextResponse.json({ error: "Unknown table" }, { status: 404 });
  const csv = toCsv(await readTable(owner.supabase, name));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
}
