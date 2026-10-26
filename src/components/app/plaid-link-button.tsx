"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { Button } from "@/components/ui/button";

/** Opens Plaid Link to connect a bank or card. Bank login details go to Plaid, never to this app. */
export function PlaidLinkButton() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plaid/link-token", { method: "POST" })
      .then((r) => r.json())
      .then((d) => (d.link_token ? setToken(d.link_token) : setStatus(d.error ?? "Plaid is not available.")))
      .catch(() => setStatus("Plaid is not available."));
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!publicToken) return;
      setStatus("Connecting and importing transactions...");
      const res = await fetch("/api/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token: publicToken, institution: metadata.institution?.name ?? null }),
      });
      const d = await res.json();
      setStatus(res.ok ? "Connected. Transactions imported." : d.error ?? "Connection failed.");
      router.refresh();
    },
    [router],
  );

  const { open, ready } = usePlaidLink({ token: token ?? "", onSuccess: (t, m) => void onSuccess(t, m) });
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" onClick={() => open()} disabled={!ready || !token} className="self-start">
        Connect a bank or card
      </Button>
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
    </div>
  );
}
