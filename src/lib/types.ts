/** A database row. Columns are described in supabase/migrations and in src/lib/resources.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = { [column: string]: any };

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };
