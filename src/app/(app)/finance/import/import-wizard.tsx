"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { commitImport, previewImport, type PreviewRow } from "@/app/actions/finance";
import type { ImportLayout } from "@/lib/calc/csv";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Notice } from "@/components/app/page-header";

type Account = { id: string; name: string; institution: string | null };
type SavedLayout = ImportLayout & { id: string; name: string; institution: string; has_header: boolean };

const EMPTY: ImportLayout & { has_header: boolean } = {
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

function guess(headers: string[], words: string[]): string {
  return headers.find((h) => words.some((w) => h.toLowerCase().includes(w))) ?? "";
}

/** CSV import: choose account and file, map columns (saved per bank or card), review, then import. */
export function ImportWizard({ accounts, layouts }: { accounts: Account[]; layouts: SavedLayout[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [layout, setLayout] = useState({ ...EMPTY });
  const [layoutName, setLayoutName] = useState("");
  const [institution, setInstitution] = useState("");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [includeDup, setIncludeDup] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: number; batchId: string | null } | null>(null);
  const [pending, start] = useTransition();

  const headers = useMemo(() => {
    if (!rawRows.length) return [];
    return layout.has_header ? rawRows[0].map((h, i) => h.trim() || `Column ${i + 1}`) : rawRows[0].map((_, i) => `Column ${i + 1}`);
  }, [rawRows, layout.has_header]);

  const objects = useMemo(() => {
    const body = layout.has_header ? rawRows.slice(1) : rawRows;
    return body.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  }, [rawRows, headers, layout.has_header]);

  function onFile(file: File) {
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    setError(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as string[][];
        setRawRows(rows);
        const h = rows[0] ?? [];
        const acct = accounts.find((a) => a.id === accountId);
        const saved = layouts.find((l) => acct?.institution && l.institution.toLowerCase() === acct.institution.toLowerCase());
        if (saved) applySaved(saved);
        else {
          setLayout({
            ...EMPTY,
            date_column: guess(h, ["date", "posted"]),
            description_column: guess(h, ["description", "payee", "merchant", "name", "memo"]),
            amount_column: guess(h, ["amount"]),
            debit_column: guess(h, ["debit", "withdrawal"]),
            credit_column: guess(h, ["credit", "deposit"]),
          });
          setInstitution(acct?.institution ?? "");
          setLayoutName(acct?.institution ? `${acct.institution} CSV` : "");
        }
      },
      error: (e) => setError(`The file could not be read: ${e.message}`),
    });
  }

  function applySaved(l: SavedLayout) {
    setLayout({
      has_header: l.has_header,
      date_column: l.date_column,
      description_column: l.description_column,
      amount_column: l.amount_column ?? "",
      debit_column: l.debit_column ?? "",
      credit_column: l.credit_column ?? "",
      external_id_column: l.external_id_column ?? "",
      amount_sign: l.amount_sign,
      date_format: l.date_format,
    });
    setLayoutName(l.name);
    setInstitution(l.institution);
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
    if (!layout.date_column || !layout.description_column || (!layout.amount_column && !layout.debit_column && !layout.credit_column)) {
      setError("Choose the date, description, and amount columns.");
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
      const res = await commitImport({ accountId, fileName, institution, layoutName, layout: { ...cleanLayout(), has_header: layout.has_header }, rows: objects, includeDuplicates: [...includeDup] });
      if (res.error) setError(res.error);
      setResult(res);
      setPreview(null);
    });
  }

  const counts = preview ? { new: preview.filter((r) => r.status === "new").length, dup: preview.filter((r) => r.status === "duplicate").length, err: preview.filter((r) => r.status === "error").length } : null;
  const colSelect = (key: keyof ImportLayout, label: string, optional = false) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="field-label flex items-end text-sm font-medium">{label}</span>
      <NativeSelect value={(layout[key] as string) ?? ""} onChange={(e) => setLayout({ ...layout, [key]: e.target.value })}>
        <option value="">{optional ? "Not used" : "Choose a column"}</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </NativeSelect>
    </label>
  );

  if (!accounts.length) {
    return <Notice tone="warn">Add an account first (Finance, Accounts and Cash). Each CSV file is imported into one account.</Notice>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <Notice tone="success">
          Imported {result.imported} transactions. Skipped {result.duplicates} duplicates{result.errors ? ` and ${result.errors} rows that could not be read` : ""}. Category rules were applied and recurring charges were checked.{" "}
          <Link href="/finance/expenses" className="font-medium underline">
            Open Expenses
          </Link>
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Account and file</CardTitle>
            <CardDescription>Simplifi by Quicken data can be brought in through its CSV export.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Account
              <NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.institution ? ` (${a.institution})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              CSV file
              <Input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            {fileName ? (
              <p className="text-xs text-muted-foreground">
                {fileName}: {objects.length} rows found.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. Column layout</CardTitle>
            <CardDescription>Saved per bank or card, so the next file from the same place needs no setup.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {layouts.length ? (
              <label className="flex flex-col gap-1 text-sm font-medium">
                Use a saved layout
                <NativeSelect
                  value=""
                  onChange={(e) => {
                    const l = layouts.find((x) => x.id === e.target.value);
                    if (l) applySaved(l);
                  }}
                >
                  <option value="">Choose a saved layout</option>
                  {layouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
            {headers.length ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={layout.has_header} onChange={(e) => setLayout({ ...layout, has_header: e.target.checked })} className="h-4 w-4 accent-teal-700" />
                  The first row has column names
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {colSelect("date_column", "Date")}
                  {colSelect("description_column", "Description")}
                  {colSelect("amount_column", "Amount (one column for money in and out)", true)}
                  {colSelect("external_id_column", "Bank transaction ID", true)}
                  {!layout.amount_column ? colSelect("debit_column", "Money out column", true) : null}
                  {!layout.amount_column ? colSelect("credit_column", "Money in column", true) : null}
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="field-label flex items-end text-sm font-medium">Amount sign</span>
                    <NativeSelect value={layout.amount_sign} onChange={(e) => setLayout({ ...layout, amount_sign: e.target.value as ImportLayout["amount_sign"] })}>
                      <option value="negative_is_outflow">Negative = money out</option>
                      <option value="positive_is_outflow">Positive = money out</option>
                    </NativeSelect>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="field-label flex items-end text-sm font-medium">Date format</span>
                    <NativeSelect value={layout.date_format} onChange={(e) => setLayout({ ...layout, date_format: e.target.value as ImportLayout["date_format"] })}>
                      <option value="auto">Detect automatically</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </NativeSelect>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="field-label flex items-end text-sm font-medium">Bank or card</span>
                    <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Example: Chase" />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="field-label flex items-end text-sm font-medium">Save layout as</span>
                    <Input value={layoutName} onChange={(e) => setLayoutName(e.target.value)} placeholder="Example: Chase checking CSV" />
                  </label>
                </div>
                <Button onClick={runPreview} disabled={pending || !objects.length} className="self-start">
                  {pending ? "Checking..." : "3. Review rows"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Choose a file to map its columns.</p>
            )}
          </CardContent>
        </Card>
      </div>
      {preview && counts ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>3. Review</CardTitle>
              <CardDescription>
                {counts.new} new, {counts.dup} duplicates (already imported, not added unless you tick them), {counts.err} rows that cannot be read.
              </CardDescription>
            </div>
            <Button onClick={runCommit} disabled={pending || counts.new + includeDup.size === 0}>
              {pending ? "Importing..." : `Import ${counts.new + includeDup.size} transactions`}
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
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
                    <TD className={`tabular text-right ${r.amount !== null && r.amount < 0 ? "" : "text-emerald-700"}`}>{r.amount !== null ? r.amount.toFixed(2) : ""}</TD>
                    <TD className="text-xs">{r.category ?? <span className="text-muted-foreground">None</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {preview.length > 500 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first 500 rows. All rows are imported.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
