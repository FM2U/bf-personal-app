import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { DetailGrid, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { saveProfile } from "@/app/actions/settings";
import { dateTime } from "@/lib/format";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Profile and security" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ProfilePage() {
  const { supabase, user } = await requireOwner();
  const [{ data: profile }, { data: factors }] = await Promise.all([supabase.from("owner_profile").select("*").maybeSingle(), supabase.auth.mfa.listFactors()]);
  const totp = factors?.totp ?? [];
  return (
    <div>
      <PageHeader title="Profile and security" description="Time zone and review schedule, and the sign-in second step." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Used for &quot;today&quot;, calendar events, and which day the weekly review is drafted.</CardDescription>
          </CardHeader>
          <CardContent>
            <GuardedForm action={saveProfile} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="field-label"><span>Name shown in the app</span></span>
                <Input name="display_name" defaultValue={profile?.display_name ?? ""} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="field-label"><span>Time zone</span></span>
                <Input name="timezone" defaultValue={profile?.timezone ?? "America/New_York"} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="field-label"><span>Morning hour (time blocks start 2 hours later)</span></span>
                <Input name="morning_hour" type="number" min={0} max={23} defaultValue={profile?.morning_hour ?? 7} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="field-label"><span>Daily close hour (evening)</span></span>
                <Input name="evening_hour" type="number" min={0} max={23} defaultValue={profile?.evening_hour ?? 20} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="field-label"><span>Weekly review day</span></span>
                <NativeSelect name="weekly_review_weekday" defaultValue={String(profile?.weekly_review_weekday ?? 0)}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <div className="flex items-end">
                <SubmitButton>Save</SubmitButton>
              </div>
            </GuardedForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sign-in security</CardTitle>
            <CardDescription>Email and password plus a code from an authenticator app. Only this one account can sign in.</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailGrid
              items={[
                { label: "Owner email", value: user.email ?? "" },
                { label: "Authenticator apps", value: totp.length ? totp.map((f) => `${f.friendly_name ?? "Authenticator"} (added ${dateTime(f.created_at)})`).join("; ") : "None" },
                { label: "Last sign-in", value: dateTime(user.last_sign_in_at ?? null) },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
