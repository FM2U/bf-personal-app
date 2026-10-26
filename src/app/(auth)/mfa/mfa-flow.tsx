"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/app/page-header";

/** Second sign-in step: enroll an authenticator app the first time, then enter its 6-digit code. */
export function MfaFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "enroll" | "verify">("loading");
  const [factorId, setFactorId] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error: e } = await supabase.auth.mfa.listFactors();
      if (e) {
        setError(e.message);
        return;
      }
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("verify");
        return;
      }
      for (const f of data.all.filter((x) => x.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error: enErr } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
      if (enErr || !en) {
        setError(enErr?.message ?? "Could not start authenticator setup.");
        return;
      }
      setFactorId(en.id);
      setQr(en.totp.qr_code);
      setSecret(en.totp.secret);
      setMode("enroll");
    })();
  }, []);

  async function verify() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (e) {
      setError("That code is not correct. Enter the current 6-digit code from the authenticator app.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "enroll" ? "Set up your authenticator app" : "Enter your authenticator code"}</CardTitle>
        <CardDescription>
          {mode === "enroll"
            ? "Scan the code with an authenticator app (for example Google Authenticator or 1Password), then enter the 6-digit code it shows."
            : "Open your authenticator app and enter the 6-digit code for BF Personal App."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {mode === "loading" ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
        {mode === "enroll" && qr ? (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Authenticator setup code" className="h-44 w-44" />
            <p className="break-all text-center font-mono text-xs text-muted-foreground">Manual setup key: {secret}</p>
          </div>
        ) : null}
        {mode !== "loading" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} aria-label="6-digit code" required />
            <Button type="submit" disabled={busy || code.trim().length !== 6}>
              {busy ? "Checking..." : "Verify"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
