"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { commitImport, previewImport, type PreviewRow } from "@/app/actions/finance";
import type { ImportLayout } from "@/lib/calc/csv";
import {
  EMPTY_LAYOUT,
  fileHeaders,
  layoutSaveNames,
  missingColumns,
  pickLayout,
  type DraftLayout,
  type SavedLayout,
  type WizardLayout,
} from "@/lib/calc/import-layout";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FieldGrid, FormField } from "@/components/ui/form-field";
import { Notice } from "@/components/app/page-header";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { cn } from "@/lib/utils";

type Account = { id: string; name: string; institution: string | null };

const STEPS = ["Choose the account and file", "Match the columns", "Review and import"];
const DRAFT_KEY = (accountId: string) => `csv-import-draft:${accountId}`;

function readDraft(accountId: string): DraftLayout | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(accountId));
    return raw ? (JSON.parse(raw) as DraftLayout) : null;
  } catch {
    return null;
  }
}
function writeDraft(accountId: string, d: DraftLayout | null) {
  try {
    if (d) window.localStorage.setItem(DRAFT_KEY(accountId), JSON.stringify(d));
    else window.localStorage.removeItem(DRAFT_KEY(accountId));
  } catch {
    // Storage blocked: the saved layout per bank still fills the next import.
  }
}

/**
 * CSV import in 3 steps: choose account and file, match the columns (filled from the saved layout for the bank or card,
 * or from the last choices for the account), review, then import. Leaving with a file chosen asks first.
 */
export function ImportWizard({ accounts, layouts, lastLayoutByAccount = {} }: { accounts: Account[]; layouts: SavedLayout[]; lastLayoutByAccount?: Record<string, string> }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [layout, setLayoutState] = useState<WizardLayout>({ ...EMPTY_LAYOUT });
  const [layoutName, setLayoutName] = useState("");
  const [institution, setInstitution] = useState("");
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [includeDup, setIncludeDup] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: number; batchId: string | null } | null>(null);
  const [pending, start] = useTransition();
  const account = accounts.find((a) => a.id === accountId) ?? null;

  // A chosen file that is not imported yet: leaving asks first (the column choices are kept for this account).
  useUnsavedWork(!!fileName && !result, "The import is not finished. Leaving discards the chosen file. Your column choices are kept for this account.");

  const headers = useMemo(() => (rawRows.length ? fileHeaders(rawRows[0], layout.has_header) : []), [rawRows, layout.has_header]);
  const objects = useMemo(() => {
    const body = layout.has_header ? rawRows.slice(1) : rawRows;
    return body.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  }, [rawRows, headers, layout.has_header]);
  const missing = missingColumns(layout);
  const step = !fileName ? 1 : preview ? 3 : 2;

  /** A change the owner made to the column choices: kept for this account until the import is done. */
  const change = (next: Partial<WizardLayout>, names?: { layoutName?: string; institution?: string }) => {
    const l = { ...layout, ...next };
    setLayoutState(l);
    setTouched(true);
    setPreview(null);
    const n = { layoutName: names?.layoutName ?? layoutName, institution: names?.institution ?? institution };
    if (accountId && fileName) writeDraft(accountId, { layout: l, ...n });
  };

  function fill(rows: string[][], forAccount: string) {
    const acct = accounts.find((a) => a.id === forAccount) ?? null;
    const pick = pickLayout({ headers: rows[0] ?? [], account: acct, layouts, lastLayoutId: lastLayoutByAccount[forAccount], draft: readDraft(forAccount) });
    setLayoutState(pick.layout);
    setLayoutName(pick.name);
    setInstitution(pick.institution);
    setFillNote(pick.note);
    setTouched(false);
  }

  function onFile(file: File) {
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    setError(null);
    setShowMissing(false);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as string[][];
        setRawRows(rows);
        fill(rows, accountId);
      },
      error: (e) => setError(`The file could not be read: ${e.message}`),
    });
  }

  function onAccount(id: string) {
    setAccountId(id);
    setPreview(null);
    // The column choices follow the account's bank or card, unless they were changed by hand for this file.
    if (rawRows.length && !touched) fill(rawRows, id);
  }

  const cleanLayout = (): ImportLayout => ({
    ...layout,
    amount_column: layout.amount_column || null,
    debit_column: layout.amount_column ? null : layout.debit_column || null,
    credit_column: layout.amount_column ? null : layout.credit_column || null,
    external_id_column: layout.external_id_column || null,
  });

  function runPreview() {
    setError(null);
    if (missing.length) {
      setShowMissing(true);
      setError(`Choose a column for: ${missing.join(", ")}.`);
      return;
    }
    start(async () => {
      const res = await previewImport(accountId, cleanLayout(), objects);
      if (res.error) setError(res.error);
      else {
        setPreview(res.rows);
        setIncludeDup(new Set());
      }
    });
  }

  function runCommit() {
    start(async () => {
      const names = layoutSaveNames({ layoutName, institution, account });
      const res = await commitImport({ accountId, fileName, institution: names.institution, layoutName: names.layoutName, layout: { ...cleanLayout(), has_header: layout.has_header }, rows: objects, includeDuplicates: [...includeDup] });
      if (res.error) {
        setError(res.error);
        return;
      }
      writeDraft(accountId, null);
      setResult(res);
      setPreview(null);
    });
  }

  const counts = preview ? { new: preview.filter((r) => r.status === "new").length, dup: preview.filter((r) => r.status === "duplicate").length, err: preview.filter((r) => r.status === "error").length } : null;
  const colSelect = (key: keyof ImportLayout, label: string, opts: { optional?: boolean; required?: boolean } = {}) => {
    const empty = showMissing && opts.required && !layout[key];
    return (
      <FormField label={label} htmlFor={`csv_${key}`} required={opts.required} help={empty ? <span className="font-medium text-status-missed">Choose the column.</span> : undefined}>
        <NativeSelect id={`csv_${key}`} value={(layout[key] as string) ?? ""} onChange={(e) => change({ [key]: e.target.value })} className={cn(empty && "border-status-missed-solid")} aria-invalid={empty || undefined}>
          <option value="">{opts.optional ? "Not used" : "Choose a column"}</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </NativeSelect>
      </FormField>
    );
  };

  if (!accounts.length) {
    return <Notice tone="warn">Add an account first (Finance, Accounts and Cash). Each CSV file is imported into one account.</Notice>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Import steps">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = result ? "done" : n < step ? "done" : n === step ? "current" : "next";
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1",
                state === "current" && "border-teal-700 bg-teal-50 font-medium text-teal-900",
                state === "done" && "border-slate-200 bg-white text-slate-600",
                state === "next" && "border-slate-200 bg-white text-muted-foreground",
              )}
            >
              <span className="tabular">Step {n} of 3:</span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <Notice tone="success">
          Imported {result.imported} transactions. Skipped {result.duplicates} duplicates{result.errors ? ` and ${result.errors} rows that could not be read` : ""}. Category rules were applied and recurring charges were checked.{" "}
          <Link href="/finance/expenses" className="font-medium underline">
            Open Expenses
          </Link>
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>1. Choose the account and file</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid cols={1}>
              <FormField label="Account" htmlFor="csv_account" required>
                <NativeSelect id="csv_account" value={accountId} onChange={(e) => onAccount(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.institution ? ` (${a.institution})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="CSV file" htmlFor="csv_file" required help={fileName ? `${fileName}: ${objects.length} rows found.` : undefined}>
                <Input id="csv_file" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </FormField>
            </FieldGrid>
          </CardContent>
          <CardNote>Each file goes into one account. Simplifi by Quicken data can be brought in through its CSV export.</CardNote>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. Match the columns</CardTitle>
            {headers.length && fillNote ? <p className="text-sm text-slate-700" data-testid="csv-fill-note">{fillNote}</p> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {headers.length ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={layout.has_header} onChange={(e) => change({ has_header: e.target.checked })} className="h-4 w-4 accent-teal-700" />
                  The first row has column names
                </label>
                <FieldGrid>
                  {colSelect("date_column", "Date", { required: true })}
                  {colSelect("description_column", "Description", { required: true })}
                  {colSelect("amount_column", "Amount (one column for money in and out)", { optional: true })}
                  {colSelect("external_id_column", "Bank transaction ID", { optional: true })}
                  {!layout.amount_column ? colSelect("debit_column", "Money out column", { optional: true }) : null}
                  {!layout.amount_column ? colSelect("credit_column", "Money in column", { optional: true }) : null}
                  <FormField label="Amount sign" htmlFor="csv_sign">
                    <NativeSelect id="csv_sign" value={layout.amount_sign} onChange={(e) => change({ amount_sign: e.target.value as ImportLayout["amount_sign"] })}>
                      <option value="negative_is_outflow">Negative = money out</option>
                      <option value="positive_is_outflow">Positive = money out (most credit cards)</option>
                    </NativeSelect>
                  </FormField>
                  <FormField label="Date format" htmlFor="csv_date_format">
                    <NativeSelect id="csv_date_format" value={layout.date_format} onChange={(e) => change({ date_format: e.target.value as ImportLayout["date_format"] })}>
                      <option value="auto">Detect automatically</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </NativeSelect>
                  </FormField>
                  <FormField label="Bank or card" htmlFor="csv_institution">
                    <Input
                      id="csv_institution"
                      value={institution}
                      onChange={(e) => {
                        setInstitution(e.target.value);
                        change({}, { institution: e.target.value });
                      }}
                      placeholder="Example: Chase"
                    />
                  </FormField>
                  <FormField label="Save these choices as" htmlFor="csv_layout_name">
                    <Input
                      id="csv_layout_name"
                      value={layoutName}
                      onChange={(e) => {
                        setLayoutName(e.target.value);
                        change({}, { layoutName: e.target.value });
                      }}
                      placeholder="Example: Chase checking CSV"
                    />
                  </FormField>
                </FieldGrid>
                {layouts.length ? (
                  <FieldGrid>
                    <FormField label="Or use a saved layout" htmlFor="csv_saved">
                      <NativeSelect
                        id="csv_saved"
                        value=""
                        onChange={(e) => {
                          const l = layouts.find((x) => x.id === e.target.value);
                          if (!l) return;
                          setLayoutName(l.name);
                          setInstitution(l.institution);
                          setFillNote(`Columns filled from the saved layout ${l.name}.`);
                          change(
                            {
                              has_header: l.has_header,
                              date_column: l.date_column,
                              description_column: l.description_column,
                              amount_column: l.amount_column ?? "",
                              debit_column: l.debit_column ?? "",
                              credit_column: l.credit_column ?? "",
                              external_id_column: l.external_id_column ?? "",
                              amount_sign: l.amount_sign,
                              date_format: l.date_format,
                            },
                            { layoutName: l.name, institution: l.institution },
                          );
                        }}
                      >
                        <option value="">Choose a saved layout</option>
                        {layouts.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                  </FieldGrid>
                ) : null}
                <Button onClick={runPreview} disabled={pending || !objects.length} className="self-start">
                  {pending && !preview ? "Checking..." : "Review the rows"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Choose a file in step 1 to match its columns.</p>
            )}
          </CardContent>
          <CardNote>The column choices are saved per bank or card when you import, so the next file from the same place fills them.</CardNote>
        </Card>
      </div>
      {preview && counts ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>3. Review and import</CardTitle>
              <p className="mt-1 text-sm text-slate-700">
                {counts.new} new, {counts.dup} duplicates (already imported; tick one to add it anyway), {counts.err} rows that cannot be read.
              </p>
            </div>
            <Button onClick={runCommit} disabled={pending || counts.new + includeDup.size === 0}>
              {pending ? "Importing..." : `Import ${counts.new + includeDup.size} transactions`}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[44rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Row</TH>
                    <TH>Status</TH>
                    <TH>Date</TH>
                    <TH>Description</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Category from rules</TH>
                  </TR>
                </THead>
                <TBody>
                  {preview.slice(0, 500).map((r) => (
                    <TR key={r.rowNumber}>
                      <TD className="text-xs text-muted-foreground">{r.rowNumber}</TD>
                      <TD>
                        {r.status === "new" ? (
                          <Badge variant="success">New</Badge>
                        ) : r.status === "duplicate" ? (
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={includeDup.has(r.rowNumber)}
                              onChange={(e) => {
                                const n = new Set(includeDup);
                                if (e.target.checked) n.add(r.rowNumber);
                                else n.delete(r.rowNumber);
                                setIncludeDup(n);
                              }}
                              className="h-3.5 w-3.5 accent-teal-700"
                            />
                            <Badge variant="warning">Duplicate</Badge>
                          </label>
                        ) : (
                          <Badge variant="danger">{r.error}</Badge>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{r.date ?? ""}</TD>
                      <TD className="max-w-xs">
                        <span className="clamp-1">{r.description}</span>
                      </TD>
                      <TD className={`tabular text-right ${r.amount !== null && r.amount < 0 ? "" : "text-status-met"}`}>{r.amount !== null ? r.amount.toFixed(2) : ""}</TD>
                      <TD className="text-xs">{r.category ?? <span className="text-muted-foreground">None</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {preview.length > 500 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first 500 rows. All rows are imported.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
