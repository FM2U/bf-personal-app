/**
 * CSV import wizard: which column layout fills the column choices when a file is chosen, and what is missing.
 * Pure functions (tested). The wizard is src/app/(app)/finance/import/import-wizard.tsx.
 */
import type { ImportLayout } from "./csv";

export type WizardLayout = ImportLayout & { has_header: boolean };
export type SavedLayout = WizardLayout & { id: string; name: string; institution: string };
/** Column choices made in this browser for an account but not imported yet (kept so a restarted import fills them). */
export type DraftLayout = { layout: WizardLayout; institution: string; layoutName: string };

export const EMPTY_LAYOUT: WizardLayout = {
  has_header: true,
  date_column: "",
  description_column: "",
  amount_column: "",
  debit_column: "",
  credit_column: "",
  external_id_column: "",
  amount_sign: "negative_is_outflow",
  date_format: "auto",
};

/** Column names of the file: the first row, or "Column 1", "Column 2", ... when the file has no header row. */
export function fileHeaders(firstRow: string[], hasHeader: boolean): string[] {
  return hasHeader ? firstRow.map((h, i) => h.trim() || `Column ${i + 1}`) : firstRow.map((_, i) => `Column ${i + 1}`);
}

/** True when every column the layout uses exists in the file. */
export function layoutFits(l: WizardLayout, headers: string[]): boolean {
  const used = [l.date_column, l.description_column, l.amount_column, l.debit_column, l.credit_column, l.external_id_column].filter(Boolean) as string[];
  return used.length > 0 && used.every((c) => headers.includes(c));
}

/** Required choices that are missing, in plain words (empty when the layout can be used). */
export function missingColumns(l: WizardLayout): string[] {
  const out: string[] = [];
  if (!l.date_column) out.push("Date");
  if (!l.description_column) out.push("Description");
  if (!l.amount_column && !l.debit_column && !l.credit_column) out.push("Amount (or the Money out and Money in columns)");
  return out;
}

function guess(headers: string[], words: string[]): string {
  return headers.find((h) => words.some((w) => h.toLowerCase().includes(w))) ?? "";
}

/** Column choices guessed from the column names (Date, Description, Amount, Debit, Credit). */
export function guessLayout(headers: string[]): WizardLayout {
  return {
    ...EMPTY_LAYOUT,
    date_column: guess(headers, ["date", "posted"]),
    description_column: guess(headers, ["description", "payee", "merchant", "name", "memo"]),
    amount_column: guess(headers, ["amount"]),
    debit_column: guess(headers, ["debit", "withdrawal"]),
    credit_column: guess(headers, ["credit", "deposit"]),
  };
}

export type LayoutPick = { layout: WizardLayout; name: string; institution: string; source: "draft" | "last_used" | "bank" | "matching" | "guess"; note: string };

/**
 * The layout that fills the column choices for a new file, first match wins:
 * 1. this account's choices from an import that was started here but not finished (draft),
 * 2. the layout used by the last import into this account,
 * 3. the saved layout for the account's bank or card,
 * 4. a saved layout whose columns all exist in the file,
 * 5. a guess from the column names.
 * A saved layout is used only when its columns exist in the file (the first row is read as column names for this check).
 */
export function pickLayout(p: {
  headers: string[];
  account: { name: string; institution: string | null } | null;
  layouts: SavedLayout[];
  lastLayoutId?: string | null;
  draft?: DraftLayout | null;
}): LayoutPick {
  const fits = (l: WizardLayout) => layoutFits(l, l.has_header ? p.headers : p.headers.map((_, i) => `Column ${i + 1}`));
  const saved = (l: SavedLayout, source: LayoutPick["source"], note: string): LayoutPick => ({ layout: toWizard(l), name: l.name, institution: l.institution, source, note });
  if (p.draft && fits(p.draft.layout)) {
    return { layout: p.draft.layout, name: p.draft.layoutName, institution: p.draft.institution, source: "draft", note: "Columns filled from your last choices for this account (that import was not finished)." };
  }
  const last = p.lastLayoutId ? p.layouts.find((l) => l.id === p.lastLayoutId) : undefined;
  if (last && fits(last)) return saved(last, "last_used", `Columns filled from the layout used last time for this account: ${last.name}.`);
  const bank = p.account?.institution?.trim().toLowerCase();
  const byBank = bank ? p.layouts.find((l) => l.institution.trim().toLowerCase() === bank) : undefined;
  if (byBank && fits(byBank)) return saved(byBank, "bank", `Columns filled from the saved layout for ${byBank.institution}: ${byBank.name}.`);
  const matching = p.layouts.find((l) => fits(l));
  if (matching) return saved(matching, "matching", `Columns filled from a saved layout whose columns match this file: ${matching.name}. Check them before reviewing.`);
  const institution = p.account?.institution?.trim() || "";
  const label = institution || p.account?.name || "";
  return {
    layout: guessLayout(p.headers),
    name: label ? `${label} CSV` : "",
    institution,
    source: "guess",
    note: byBank ? `The saved layout for ${byBank.institution} does not match this file's columns. Columns were guessed from their names; check them.` : "Columns were guessed from their names. Check them; they are saved for the next file from this bank or card.",
  };
}

function toWizard(l: SavedLayout): WizardLayout {
  return {
    has_header: l.has_header,
    date_column: l.date_column,
    description_column: l.description_column,
    amount_column: l.amount_column ?? "",
    debit_column: l.debit_column ?? "",
    credit_column: l.credit_column ?? "",
    external_id_column: l.external_id_column ?? "",
    amount_sign: l.amount_sign,
    date_format: l.date_format,
  };
}

/** Name and bank saved with the layout: what was typed, else the account's bank or card, else the account name. */
export function layoutSaveNames(p: { layoutName: string; institution: string; account: { name: string; institution: string | null } | null }): { layoutName: string; institution: string } {
  const institution = p.institution.trim() || p.account?.institution?.trim() || p.account?.name || "";
  const layoutName = p.layoutName.trim() || (institution ? `${institution} CSV` : "");
  return { layoutName, institution };
}
