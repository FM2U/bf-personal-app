"use client";

import { CONFIRM_SHORT_MS } from "@/lib/confirm-timing";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import type { ComposeSetup } from "@/lib/compose-email";
import type { PersonRow } from "@/lib/work/outreach-data";

/**
 * Email, Log a call and Log a meeting for the people due on Home (the Contacts tile, and since 2026-11-17 the Contacts
 * due today window): which person's email or log is open, the line shown on the row after a save ("Email sent and
 * logged", "Call logged, 15 min"), and the email window and the log drawer themselves (render `dialogs` once).
 */
export function useContactActions({ composes, today, tz }: { composes: Record<string, ComposeSetup>; today: string; tz: string }) {
  const router = useRouter();
  const [email, setEmail] = useState<PersonRow | null>(null);
  const [call, setCall] = useState<PersonRow | null>(null);
  const [kind, setKind] = useState<"call" | "meeting">("call");
  const [logged, setLogged] = useState<Record<string, string>>({});
  const dialogs = (
    <>
      {email && composes[email.id] ? (
        <ComposeEmailDialog
          key={`p-${email.id}`}
          setup={composes[email.id]}
          open
          ask={{ page: "person", recordId: email.id, label: email.name }}
          onOpenChange={(o) => {
            if (!o) setEmail(null);
          }}
          onSent={() => {
            setLogged((m) => ({ ...m, [email.id]: "Email sent and logged" }));
            router.refresh();
          }}
        />
      ) : null}
      {call ? (
        <LogCallDrawer
          key={`${call.id}-${kind}`}
          kind={kind}
          target={{ contactId: call.id, dealId: null, who: call.name, from: "From Home", currentDate: call.nextFollowUp }}
          today={today}
          tz={tz}
          open
          onOpenChange={(o) => {
            if (!o) setCall(null);
          }}
          onSaved={(r) => {
            setLogged((m) => ({ ...m, [call.id]: `${kind === "meeting" ? "Meeting" : "Call"} logged, ${r.minutes} min` }));
            setTimeout(() => router.refresh(), CONFIRM_SHORT_MS);
          }}
        />
      ) : null}
    </>
  );
  return {
    logged,
    onEmail: (p: PersonRow) => setEmail(p),
    onCall: (p: PersonRow) => {
      setKind("call");
      setCall(p);
    },
    onMeeting: (p: PersonRow) => {
      setKind("meeting");
      setCall(p);
    },
    dialogs,
  };
}
