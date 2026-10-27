"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarCheck, Check, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { approveAllBlocks, approveBlock, deleteBlock, editBlock, suggestBlocksNow } from "@/app/actions/time-blocks";
import { BLOCK_LENGTHS, clock } from "@/lib/time-blocks";
import { cn } from "@/lib/utils";

export type BlockRow = { id: string; title: string; taskId: string | null; startMin: number; endMin: number };

type Msg = { tone: "ok" | "error"; text: string } | null;

function MessageLine({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role="status" className={cn("rounded-md px-3 py-2 text-sm", msg.tone === "ok" ? "bg-status-met-bg text-status-met" : "bg-status-missed-bg text-status-missed")} data-testid="time-block-message">
      {msg.text}
    </p>
  );
}

/** "Suggest blocks now" in the page header: replaces today's waiting suggestions with a fresh set. */
export function SuggestBlocksButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        data-testid="suggest-blocks"
        onClick={() =>
          start(async () => {
            const r = await suggestBlocksNow();
            setMsg(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error });
          })
        }
      >
        <RefreshCw /> {pending ? "Suggesting..." : "Suggest blocks now"}
      </Button>
      {msg ? <span className={cn("text-xs", msg.tone === "ok" ? "text-status-met" : "text-status-missed")}>{msg.text}</span> : null}
    </span>
  );
}

/** Today's suggested blocks, each with Approve, Edit, and Delete, and Approve all. */
export function TimeBlockSuggestions({ rows, connected }: { rows: BlockRow[]; connected: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "ok", text: r.message } : { tone: "error", text: r.error });
      if (r.ok) setEditing(null);
    });
  return (
    <div className="flex flex-col gap-3" data-testid="time-block-suggestions">
      <MessageLine msg={msg} />
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-slate-100">
          {rows.map((b) =>
            editing === b.id ? (
              <EditRow key={b.id} b={b} pending={pending} onCancel={() => setEditing(null)} onSave={(s, m) => run(() => editBlock(b.id, s, m))} />
            ) : (
              <li key={b.id} className="grid grid-cols-1 items-center gap-2 py-2.5 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto]" data-testid="time-block-row">
                <span className="tabular text-sm font-medium text-slate-900">
                  {clock(b.startMin)} <span className="font-normal text-muted-foreground">({b.endMin - b.startMin} min)</span>
                </span>
                {b.taskId ? (
                  <Link href={`/records/tasks/${b.taskId}`} className="clamp-2 min-w-0 text-sm text-slate-900 hover:text-primary-strong hover:underline" data-testid="time-block-title">
                    {b.title.replace(/^Focus: /, "")}
                  </Link>
                ) : (
                  <span className="clamp-2 text-sm text-slate-900" data-testid="time-block-title">{b.title}</span>
                )}
                <span className="flex flex-wrap gap-1.5 sm:justify-end">
                  <Button size="sm" disabled={pending || !connected} onClick={() => run(() => approveBlock(b.id))} data-testid="time-block-approve">
                    <Check /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(b.id)} data-testid="time-block-edit">
                    <Pencil /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteBlock(b.id))} aria-label={`Delete the block for ${b.title}`} data-testid="time-block-delete">
                    <Trash2 /> Delete
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="time-block-none">
          No suggestions waiting. Press Suggest blocks now to suggest blocks for today&apos;s priority tasks.
        </p>
      )}
      {rows.length > 1 ? (
        <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
          <Button size="sm" disabled={pending || !connected} onClick={() => run(() => approveAllBlocks())} data-testid="time-block-approve-all">
            <CalendarCheck /> Approve all ({rows.length})
          </Button>
          <span className="text-xs text-muted-foreground">Each approved block is added to Google Calendar.</span>
        </div>
      ) : null}
    </div>
  );
}

function EditRow({ b, pending, onCancel, onSave }: { b: BlockRow; pending: boolean; onCancel: () => void; onSave: (startMin: number, minutes: number) => void }) {
  const [time, setTime] = useState(`${String(Math.floor(b.startMin / 60)).padStart(2, "0")}:${String(b.startMin % 60).padStart(2, "0")}`);
  const [len, setLen] = useState(String(b.endMin - b.startMin));
  const lengths = BLOCK_LENGTHS.includes(b.endMin - b.startMin) ? BLOCK_LENGTHS : [...BLOCK_LENGTHS, b.endMin - b.startMin].sort((x, y) => x - y);
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-slate-50 px-3 py-3" data-testid="time-block-edit-row">
      <span className="clamp-1 text-sm font-medium text-slate-900">{b.title.replace(/^Focus: /, "")}</span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Starts
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" step={900} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Length
          <NativeSelect value={len} onChange={(e) => setLen(e.target.value)} className="w-32">
            {lengths.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          size="sm"
          className="h-9"
          disabled={pending || !/^\d{2}:\d{2}$/.test(time)}
          onClick={() => {
            const [h, m] = time.split(":").map(Number);
            onSave(h * 60 + m, Number(len));
          }}
          data-testid="time-block-save"
        >
          Save
        </Button>
        <Button size="sm" variant="outline" className="h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </li>
  );
}
