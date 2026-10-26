import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";

/** Opens an uploaded document through a short-lived signed link. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const { data: doc } = await owner.supabase.from("documents").select("storage_path,file_name").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await owner.supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not open the file" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
