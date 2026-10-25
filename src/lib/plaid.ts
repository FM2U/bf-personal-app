import "server-only";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products, type Transaction } from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import { env, isPlaidConfigured } from "@/lib/env";
import { dedupeHash, merchantFromDescription, plaidMergeTarget, type ExistingTxn } from "@/lib/calc/csv";
import { fetchAll } from "@/lib/data";
import type { Row } from "@/lib/types";

export function plaidClient(): PlaidApi {
  const config = new Configuration({
    basePath: PlaidEnvironments[env.plaidEnv] ?? PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": env.plaidClientId, "PLAID-SECRET": env.plaidSecret } },
  });
  return new PlaidApi(config);
}

export async function createLinkToken(ownerId: string): Promise<string> {
  if (!isPlaidConfigured()) throw new Error("Plaid is not set up yet.");
  const res = await plaidClient().linkTokenCreate({
    user: { client_user_id: ownerId },
    client_name: "BF Personal App",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return res.data.link_token;
}

const KIND_MAP: Record<string, string> = {
  checking: "checking",
  savings: "savings",
  "cd": "savings",
  "money market": "savings",
  "credit card": "credit_card",
  mortgage: "loan",
  student: "loan",
  loan: "loan",
  "401k": "retirement",
  ira: "retirement",
  roth: "retirement",
  brokerage: "investment",
};

/** Exchange the one-time token from Plaid Link, store the encrypted access token, and create matching accounts. */
export async function exchangePublicToken(sb: SupabaseClient, ownerId: string, publicToken: string, institutionName: string | null) {
  const client = plaidClient();
  const ex = await client.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;
  const { error } = await sb.from("plaid_items").insert({
    owner_id: ownerId,
    item_id: itemId,
    institution_name: institutionName,
    access_token_enc: encrypt(accessToken),
    status: "connected",
  });
  if (error) throw new Error(error.message);
  const { data: personal } = await sb.from("entities").select("id").eq("owner_id", ownerId).eq("kind", "personal").limit(1).maybeSingle();
  const accounts = await client.accountsGet({ access_token: accessToken });
  for (const a of accounts.data.accounts) {
    const kind = KIND_MAP[(a.subtype ?? "").toLowerCase()] ?? (a.type === "credit" ? "credit_card" : a.type === "loan" ? "loan" : a.type === "investment" ? "investment" : "checking");
    const { data: existing } = await sb.from("accounts").select("id").eq("owner_id", ownerId).eq("plaid_account_id", a.account_id).maybeSingle();
    let accountId = existing?.id as string | undefined;
    if (!accountId) {
      const { data: created } = await sb
        .from("accounts")
        .insert({
          owner_id: ownerId,
          name: a.official_name || a.name,
          institution: institutionName,
          kind,
          last4: a.mask,
          entity_id: personal?.id ?? null,
          plaid_item_id: itemId,
          plaid_account_id: a.account_id,
        })
        .select("id")
        .single();
      accountId = created?.id;
    }
    if (accountId && a.balances.current !== null && a.balances.current !== undefined) {
      await sb.from("account_balances").insert({ owner_id: ownerId, account_id: accountId, balance: a.balances.current, source: "plaid" });
    }
  }
  return itemId;
}

/**
 * /transactions/sync with a saved cursor. New Plaid rows are merged into matching CSV rows (same account, date,
 * amount, and description) instead of being added twice. Plaid amounts are positive for money out, so the sign is flipped.
 */
export async function syncPlaidItem(sb: SupabaseClient, ownerId: string, item: Row): Promise<{ added: number; merged: number; updated: number; removed: number }> {
  const client = plaidClient();
  const accessToken = decrypt(item.access_token_enc);
  const { data: accRows } = await sb.from("accounts").select("id,plaid_account_id").eq("owner_id", ownerId).eq("plaid_item_id", item.item_id);
  const accountMap = Object.fromEntries(((accRows ?? []) as Row[]).map((a) => [a.plaid_account_id, a.id]));
  let cursor: string | undefined = item.sync_cursor ?? undefined;
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: string[] = [];
  let hasMore = true;
  let pages = 0;
  while (hasMore && pages < 50) {
    const res = await client.transactionsSync({ access_token: accessToken, cursor, count: 500 });
    added.push(...res.data.added);
    modified.push(...res.data.modified);
    removed.push(...res.data.removed.map((r) => r.transaction_id).filter((x): x is string => !!x));
    hasMore = res.data.has_more;
    cursor = res.data.next_cursor;
    pages++;
  }
  const accountIds = Object.values(accountMap);
  const existing: ExistingTxn[] = accountIds.length
    ? ((await fetchAll((from, to) =>
        sb.from("transactions").select("id,external_id,dedupe_hash,source").eq("owner_id", ownerId).in("account_id", accountIds).range(from, to),
      )) as ExistingTxn[])
    : [];
  let addedCount = 0;
  let merged = 0;
  let updated = 0;
  for (const t of [...added, ...modified]) {
    const accountId = accountMap[t.account_id];
    if (!accountId) continue;
    const amount = -Number(t.amount);
    const description = t.name ?? t.merchant_name ?? "";
    const hash = dedupeHash(accountId, t.date, amount, description);
    const target = plaidMergeTarget(t.transaction_id, hash, existing);
    const fields = {
      date: t.date,
      amount,
      description,
      merchant_name: t.merchant_name ?? merchantFromDescription(description),
      pending: t.pending,
      external_id: t.transaction_id,
      dedupe_hash: hash,
    };
    if (target.action === "insert") {
      const { data } = await sb.from("transactions").insert({ owner_id: ownerId, account_id: accountId, source: "plaid", ...fields }).select("id").single();
      if (data) existing.push({ id: data.id, external_id: t.transaction_id, dedupe_hash: hash, source: "plaid" });
      addedCount++;
    } else {
      await sb.from("transactions").update(fields).eq("id", target.id);
      const e = existing.find((x) => x.id === target.id);
      if (e) e.external_id = t.transaction_id;
      if (target.action === "merge") merged++;
      else updated++;
    }
  }
  if (removed.length) await sb.from("transactions").delete().eq("owner_id", ownerId).eq("source", "plaid").in("external_id", removed);
  // balances
  try {
    const bal = await client.accountsGet({ access_token: accessToken });
    for (const a of bal.data.accounts) {
      const id = accountMap[a.account_id];
      if (id && a.balances.current !== null && a.balances.current !== undefined) {
        await sb.from("account_balances").insert({ owner_id: ownerId, account_id: id, balance: a.balances.current, source: "plaid" });
      }
    }
  } catch {
    // balance refresh is optional
  }
  await sb.from("plaid_items").update({ sync_cursor: cursor, last_synced_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", item.id);
  return { added: addedCount, merged, updated, removed: removed.length };
}

export async function checkPlaidItem(item: Row): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await plaidClient().itemGet({ access_token: decrypt(item.access_token_enc) });
    if (res.data.item.error) return { ok: false, error: res.data.item.error.error_message ?? "Plaid reported an error" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
