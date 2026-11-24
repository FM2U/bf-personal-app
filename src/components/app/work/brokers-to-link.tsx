"use client";

/**
 * "Brokers to link" (push K, Bram 2026-11-24; claude/2026-11-24-broker-links-build-plan.md): a line at the top of Deals
 * while any open deal has its broker typed as text and not linked, and the window the line opens. Each row shows the
 * deal, the typed text, and what the app proposes: a person on Contacts or a new one, a brokerage on file or a new one.
 * Both boxes can be changed. Nothing is linked until Confirm (one row) or Confirm all. On Confirm, the deal's calls and
 * meetings logged with no person are attached to the broker.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { brokersToLink, confirmBrokerLinks } from "@/app/actions/broker-links";
import { LargeWindow } from "@/components/app/work/large-window";
import { NamePicker } from "@/components/app/work/name-picker";
import { RowButton } from "@/components/app/work/ui";
import type { BrokerChoices, BrokerMatch, BrokerPick, BrokerProposal } from "@/lib/work/broker-links";

type RowState = BrokerProposal & { pickBroker: BrokerPick; pickBrokerage: BrokerPick };
const toPick = (m: BrokerMatch | null): BrokerPick => (m ? { id: m.id, name: m.name } : null);

export function BrokersToLinkLine({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [choices, setChoices] = useState<BrokerChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!count && !open) return null;

  const load = () =>
    start(async () => {
      setError(null);
      const r = await brokersToLink();
      if (!r.ok) return setError(r.error);
      setChoices(r.choices);
      setRows(r.rows.map((x) => ({ ...x, pickBroker: toPick(x.broker), pickBrokerage: toPick(x.brokerage) })));
    });
  const show = () => {
    setOpen(true);
    setNote(null);
    load();
  };
  const confirm = (list: RowState[]) =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await confirmBrokerLinks(list.map((x) => ({ dealId: x.dealId, broker: x.pickBroker, brokerage: x.pickBrokerage })));
      if (!r.ok) setError(r.error);
      else setNote(`${r.linked === 1 ? "1 deal linked" : `${r.linked} deals linked`}${r.attached ? `; ${r.attached === 1 ? "1 earlier call or meeting now names the broker" : `${r.attached} earlier calls and meetings now name the broker`}` : ""}.`);
      // The list is read again: a broker or brokerage added by one row is on file for the next.
      const again = await brokersToLink();
      if (again.ok) {
        setChoices(again.choices);
        // Rows not confirmed keep what was picked in them.
        const kept = new Map((rows ?? []).map((x) => [x.dealId, x]));
        setRows(again.rows.map((x) => ({ ...x, pickBroker: kept.get(x.dealId)?.pickBroker ?? toPick(x.broker), pickBrokerage: kept.get(x.dealId)?.pickBrokerage ?? toPick(x.brokerage) })));
      }
      router.refresh();
    });
  const set = (dealId: string, patch: Partial<RowState>) => setRows((list) => (list ?? []).map((x) => (x.dealId === dealId ? { ...x, ...patch } : x)));
  const people = (choices?.people ?? []).map((p) => ({ id: p.id, name: p.name, sub: [p.role, p.organization].filter(Boolean).join(" · ") || null }));
  const orgs = (choices?.organizations ?? []).map((o) => ({ id: o.id, name: o.name, sub: o.kind === "broker" ? "Brokerage" : null }));
  const ready = (rows ?? []).filter((x) => x.pickBroker || x.pickBrokerage);
  const mark = (pick: BrokerPick, proposed: BrokerMatch | null) =>
    !pick ? null : !pick.id ? (
      <span className="rounded-full bg-status-met-bg px-2 py-0.5 text-[11.5px] whitespace-nowrap text-status-met">new</span>
    ) : proposed?.guess && proposed.id === pick.id ? (
      <span className="rounded-full bg-status-soon-bg px-2 py-0.5 text-[11.5px] whitespace-nowrap text-status-soon">check this match</span>
    ) : (
      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11.5px] whitespace-nowrap text-primary-strong">on file</span>
    );

  return (
    <>
      {count ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-status-soon-border bg-status-soon-bg px-4 py-2.5 text-[13px] text-slate-800" data-testid="brokers-to-link-line">
          <span>
            {count === 1 ? "1 deal has its broker typed as text, not linked to a person on Contacts." : `${count} deals have their broker typed as text, not linked to a person on Contacts.`} Calls on {count === 1 ? "that deal" : "those deals"} do not count as brokers contacted until the broker is linked.
          </span>
          <button type="button" onClick={show} className="ml-auto text-[13px] font-medium text-primary-strong hover:underline" data-testid="brokers-to-link-open">
            Link brokers
          </button>
        </div>
      ) : null}
      <LargeWindow
        open={open}
        onOpenChange={setOpen}
        title={rows ? `Brokers to link · ${rows.length === 1 ? "1 deal" : `${rows.length} deals`}` : "Brokers to link"}
        sub="Each deal's typed broker, and the person and brokerage the app proposes. Change either box, then Confirm. Nothing is linked until you confirm."
        actions={
          ready.length > 1 ? (
            <RowButton tone="primary" disabled={pending} onClick={() => confirm(ready)} data-testid="brokers-confirm-all">
              {pending ? "Saving..." : `Confirm all ${ready.length}`}
            </RowButton>
          ) : null
        }
        testId="brokers-to-link"
      >
        {error ? (
          <p className="mb-3 text-[13px] text-status-missed" role="alert" data-testid="brokers-error">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="mb-3 text-[13px] font-medium text-status-met" role="status" data-testid="brokers-note">
            {note}
          </p>
        ) : null}
        {!rows ? (
          <p className="text-[13px] text-muted-foreground">Reading the deals...</p>
        ) : !rows.length ? (
          <p className="text-[13px] text-muted-foreground" data-testid="brokers-none">
            Every open deal&apos;s broker is linked.
          </p>
        ) : (
          <div data-testid="brokers-rows">
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_88px] gap-x-4 pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase md:grid">
              <span>Deal</span>
              <span>Typed today</span>
              <span>Broker</span>
              <span>Brokerage</span>
              <span />
            </div>
            {rows.map((x) => (
              <div key={x.dealId} className="grid grid-cols-1 items-start gap-x-4 gap-y-2 border-t border-slate-100 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_88px]" data-testid="brokers-row" data-deal={x.dealId}>
                <span className="pt-2 text-[13.5px] font-medium text-slate-900">{x.deal}</span>
                <span className="pt-2 text-[13.5px] text-muted-foreground" data-testid="brokers-typed">
                  {x.typed}
                </span>
                <div className="min-w-0">
                  <NamePicker value={x.pickBroker} onChange={(v) => set(x.dealId, { pickBroker: v })} options={people} loading={!choices} addLabel={(t) => `Add "${t}" as a new broker`} placeholder="No person typed" testId="brokers-broker" newNote={false} />
                  <div className="mt-1 min-h-[18px]">{mark(x.pickBroker, x.broker)}</div>
                </div>
                <div className="min-w-0">
                  <NamePicker value={x.pickBrokerage} onChange={(v) => set(x.dealId, { pickBrokerage: v })} options={orgs} loading={!choices} addLabel={(t) => `Add "${t}" as a new brokerage`} placeholder="No brokerage typed" testId="brokers-brokerage" newNote={false} />
                  <div className="mt-1 min-h-[18px]">{mark(x.pickBrokerage, x.brokerage)}</div>
                </div>
                <RowButton tone="primary" disabled={pending || (!x.pickBroker && !x.pickBrokerage)} onClick={() => confirm([x])} className="h-9 justify-center" data-testid="brokers-confirm">
                  Confirm
                </RowButton>
              </div>
            ))}
            <p className="mt-3 border-t border-slate-100 pt-3 text-[12.5px] leading-5 text-muted-foreground">On Confirm, calls and meetings already logged on that deal with no person are attached to the broker, so the counts of those days catch up. Reports already sent do not change.</p>
          </div>
        )}
      </LargeWindow>
    </>
  );
}
