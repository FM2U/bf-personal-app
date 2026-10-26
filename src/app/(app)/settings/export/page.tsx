import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { EXPORT_TABLES } from "@/lib/resources";

export const metadata = { title: "Export" };

export default async function ExportPage() {
  await requireOwner();
  return (
    <div>
      <PageHeader title="Export" description="The Supabase free plan has limited backups. Download a full export at least monthly (the monthly review includes this task)." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Full data export</CardTitle>
            <CardDescription>A zip file with data.json (every table) and one CSV file per table. Encrypted connection tokens are left out. Downloading marks this month&apos;s export task done.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              {/* A file download, not a page: a plain link is correct here. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/export/full">Download full export</a>
            </Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>One table as CSV</CardTitle>
            <CardDescription>For a spreadsheet or for sharing one list.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 md:grid-cols-3">
              {EXPORT_TABLES.map((t) => (
                <li key={t}>
                  <a href={`/api/export/${t}`} className="text-teal-800 hover:underline">
                    {t.replace(/_/g, " ")}.csv
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
