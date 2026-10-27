import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { revokePartnerLink } from "@/app/actions/domain";
import { dateTime } from "@/lib/format";
import { env } from "@/lib/env";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Partner access" };

export default async function PartnerAccessPage({ searchParams }: { searchParams: Promise<{ new_link?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const [{ data: links }, { data: partners }] = await Promise.all([supabase.from("partner_links").select("*").order("created_at", { ascending: false }), supabase.from("partners").select("id,name")]);
  const pn = Object.fromEntries(((partners ?? []) as Row[]).map((p) => [p.id, p.name]));
  const now = new Date().toISOString();
  return (
    <div>
      <PageHeader title="Partner access" description="Every private report link. Links are stored in hashed form; each shows only the sections assigned to that accountability partner. Create links on a partner's page." />
      {sp.new_link ? (
        <div className="mb-4">
          <Notice tone="success">New link: <span className="break-all font-mono">{`${env.appUrl}/report/${sp.new_link}`}</span></Notice>
        </div>
      ) : null}
      <Card>
        <CardContent className="pt-5">
          {(links ?? []).length ? (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Accountability partner</TH>
                  <TH>Label</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH>Last viewed</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {((links ?? []) as Row[]).map((l) => {
                  const active = !l.revoked_at && (!l.expires_at || l.expires_at > now);
                  return (
                    <TR key={l.id}>
                      <TD>
                        <Link href={`/records/partners/${l.partner_id}`} className="font-medium hover:underline">
                          {pn[l.partner_id] ?? "Partner"}
                        </Link>
                      </TD>
                      <TD>{l.label ?? ""}</TD>
                      <TD>
                        <Badge variant={active ? "success" : "neutral"}>{active ? (l.expires_at ? `Active until ${dateTime(l.expires_at)}` : "Active") : l.revoked_at ? "Revoked" : "Expired"}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap">{dateTime(l.created_at)}</TD>
                      <TD className="whitespace-nowrap">{l.last_viewed_at ? dateTime(l.last_viewed_at) : "Not viewed"}</TD>
                      <TD>
                        {active ? (
                          <GuardedForm action={revokePartnerLink}>
                            <input type="hidden" name="id" value={l.id} />
                            <SubmitButton size="sm" variant="outline">
                              Revoke
                            </SubmitButton>
                          </GuardedForm>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EmptyState compact title="No partner links yet." body="Open an accountability partner and press Create link." action={<Link href="/accountability/partners" className="text-sm text-primary-strong underline">Open accountability partners</Link>} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
