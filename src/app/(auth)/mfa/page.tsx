import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaFlow } from "./mfa-flow";

export default async function MfaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/");
  return <MfaFlow />;
}
