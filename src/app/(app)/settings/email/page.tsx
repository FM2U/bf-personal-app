import { requireOwner } from "@/lib/auth";
import { isGoogleConfigured } from "@/lib/env";
import { getGoogleConnection } from "@/lib/google";
import { signaturePermission } from "@/lib/google-scopes";
import { readSignatureRow } from "@/lib/signature-store";
import { DB_UPDATE_NOTICE_0015 } from "@/lib/schema-guard";
import { dateTime } from "@/lib/format";
import { Notice, PageHeader } from "@/components/app/page-header";
import { SignatureEditor } from "@/components/app/signature-editor";

export const metadata = { title: "Email signature" };

export default async function EmailSignaturePage() {
  const { supabase, ownerId } = await requireOwner();
  const [row, google] = await Promise.all([readSignatureRow(supabase, ownerId), getGoogleConnection(supabase, ownerId)]);
  const googleState = isGoogleConfigured() ? signaturePermission(google) : "not_connected";
  return (
    <div>
      <PageHeader title="Email signature" description="Your Gmail signature, added below emails sent or drafted from the app (Email button, Outreach Queue, partner reports)." />
      {!row.available ? (
        <div className="mb-4" data-testid="signature-db-update">
          <Notice tone="warn">{DB_UPDATE_NOTICE_0015} Until then, emails are sent without a signature.</Notice>
        </div>
      ) : null}
      <SignatureEditor
        initialHtml={row.html}
        initialEnabled={row.enabled !== false}
        available={row.available}
        googleState={googleState}
        savedAtText={row.html && row.updatedAt ? dateTime(row.updatedAt) : null}
      />
    </div>
  );
}
