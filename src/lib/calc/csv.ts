import { createHash } from "node:crypto";

/** Lowercase, remove card numbers, dates, reference numbers, and extra spaces, so the same merchant matches. */
export function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(pos|debit|credit|purchase|card|recurring|payment|ach|online|web|id|ref|trn|txn)\b/g, " ")
    .replace(/#?\d{3,}/g, " ")
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Merchant name for display: first words of the normalized description, capitalized. */
export function merchantFromDescription(s: string): string {
  const n = normalizeDescription(s);
  const words = n.split(" ").filter(Boolean).slice(0, 3);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || s.trim().slice(0, 40);
}

/**
 * Duplicate check key: account + date + amount in cents + normalized description.
 * The same purchase imported twice (from two CSV files, or from CSV and Plaid) gets the same key.
 */
export function dedupeHash(accountId: string, date: string, amount: number, description: string): string {
  const cents = Math.round(amount * 100);
  return createHash("sha256")
    .update(`${accountId}|${date}|${cents}|${normalizeDescription(description)}`)
    .digest("hex");
}

/** Parse "$1,234.56", "-12.00", "(12.00)" and "12.00 CR" style amounts. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bCR$/i.test(s)) s = s.replace(/\s*CR$/i, "");
  if (/\bDR$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*DR$/i, "");
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export type DateFormat = "auto" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD/MM/YYYY";

/** Parse a CSV date into YYYY-MM-DD. Returns null when the date cannot be read. */
export function parseCsvDate(raw: string, fmt: DateFormat = "auto"): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso && (fmt === "auto" || fmt === "YYYY-MM-DD")) return valid(+iso[1], +iso[2], +iso[3]);
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (slash) {
    const a = +slash[1];
    const b = +slash[2];
    const y = +slash[3];
    if (fmt === "DD/MM/YYYY") return valid(y, b, a);
    return valid(y, a, b);
  }
  return null;
}

export type ImportLayout = {
  date_column: string;
  description_column: string;
  amount_column?: string | null;
  debit_column?: string | null;
  credit_column?: string | null;
  external_id_column?: string | null;
  amount_sign: "negative_is_outflow" | "positive_is_outflow";
  date_format: DateFormat;
};

export type ParsedRow = {
  rowNumber: number;
  date: string | null;
  amount: number | null;
  description: string;
  externalId: string | null;
  error: string | null;
};

/** Convert one CSV row (column name to value) into a transaction using the saved column layout. */
export function parseRow(row: Record<string, string>, layout: ImportLayout, rowNumber: number): ParsedRow {
  const date = parseCsvDate(row[layout.date_column] ?? "", layout.date_format);
  let amount: number | null = null;
  if (layout.amount_column) {
    const a = parseAmount(row[layout.amount_column]);
    if (a !== null) amount = layout.amount_sign === "positive_is_outflow" ? -a : a;
  } else if (layout.debit_column || layout.credit_column) {
    const debit = layout.debit_column ? parseAmount(row[layout.debit_column]) : null;
    const credit = layout.credit_column ? parseAmount(row[layout.credit_column]) : null;
    if (debit !== null || credit !== null) amount = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
  }
  const description = (row[layout.description_column] ?? "").trim();
  const externalId = layout.external_id_column ? (row[layout.external_id_column] ?? "").trim() || null : null;
  let error: string | null = null;
  if (!date) error = "Date could not be read";
  else if (amount === null) error = "Amount could not be read";
  return { rowNumber, date, amount, description, externalId, error };
}

export type ExistingTxn = { id: string; external_id: string | null; dedupe_hash: string | null; source: string };

/**
 * Classify incoming rows: "duplicate" when the bank's transaction ID or the duplicate check key
 * already exists (in the database or earlier in the same file), otherwise "new".
 */
export function classifyRows<T extends { externalId: string | null; hash: string }>(
  rows: T[],
  existing: ExistingTxn[],
): (T & { status: "new" | "duplicate"; matchId: string | null })[] {
  const byExt = new Map(existing.filter((e) => e.external_id).map((e) => [e.external_id as string, e.id]));
  const byHash = new Map(existing.filter((e) => e.dedupe_hash).map((e) => [e.dedupe_hash as string, e.id]));
  const seenHash = new Set<string>();
  const seenExt = new Set<string>();
  return rows.map((r) => {
    const extMatch = r.externalId ? byExt.get(r.externalId) : undefined;
    const hashMatch = byHash.get(r.hash);
    const inFile = (r.externalId && seenExt.has(r.externalId)) || seenHash.has(r.hash);
    if (r.externalId) seenExt.add(r.externalId);
    seenHash.add(r.hash);
    const matchId = extMatch ?? hashMatch ?? null;
    return { ...r, status: matchId || inFile ? "duplicate" : "new", matchId };
  });
}

/**
 * Plaid merge rule: a Plaid row with a known Plaid transaction ID updates that row. Otherwise, a CSV row
 * with the same duplicate check key and no Plaid ID is merged (gets the Plaid ID) instead of adding a second row.
 */
export function plaidMergeTarget(
  plaidTxnId: string,
  hash: string,
  existing: ExistingTxn[],
): { action: "update"; id: string } | { action: "merge"; id: string } | { action: "insert" } {
  const byExt = existing.find((e) => e.external_id === plaidTxnId);
  if (byExt) return { action: "update", id: byExt.id };
  const csv = existing.find((e) => e.dedupe_hash === hash && e.source !== "plaid" && !e.external_id);
  if (csv) return { action: "merge", id: csv.id };
  return { action: "insert" };
}
