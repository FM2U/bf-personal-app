"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AiText } from "@/components/app/ai-text";

type Msg = { role: "user" | "assistant" | "error"; content: string; proposals?: string[] };

/** AI chat panel, available on every screen. The AI reads app data and can only propose changes. */
export function ChatPanel({ aiReady }: { aiReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const path = usePathname();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId, pagePath: path }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      if (!res.ok) setMessages((m) => [...m, { role: "error", content: data.error ?? "The request failed." }]);
      else setMessages((m) => [...m, { role: "assistant", content: data.reply, proposals: data.proposals }]);
    } catch {
      setMessages((m) => [...m, { role: "error", content: "The request failed. Check the connection and try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print">
      {!open ? (
        <Button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 h-12 rounded-full px-5 shadow-lg" aria-label="Open AI chat">
          <MessageSquare /> Ask the AI
        </Button>
      ) : null}
      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[80vh] flex-col border-t border-border bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:h-[600px] sm:w-[400px] sm:rounded-xl sm:border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">AI teammate</p>
              <p className="text-xs text-muted-foreground">Reads your data. Proposes changes; you approve them.</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => { setMessages([]); setConversationId(null); }}>
                New chat
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close AI chat">
                <X />
              </Button>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {!aiReady ? (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel (see docs/SETUP-CHECKLIST.md).</p>
            ) : null}
            {!messages.length ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Examples:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>What changed in my runway this month, and why?</li>
                  <li>Which debt should I pay first? Show the tradeoffs.</li>
                  <li>Draft a follow-up email to the broker on this deal.</li>
                  <li>Does this deal fit my acquisition criteria?</li>
                </ul>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-8 rounded-lg bg-teal-700 px-3 py-2 text-sm text-white"
                    : m.role === "error"
                      ? "mr-8 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"
                      : "mr-8 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900"
                }
              >
                {m.role === "assistant" ? <AiText text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                {m.proposals?.length ? (
                  <Link href="/proposals" className="mt-2 inline-block text-xs font-medium text-teal-800 underline">
                    {m.proposals.length} proposal(s) waiting for your approval
                  </Link>
                ) : null}
              </div>
            ))}
            {busy ? <p className="text-xs text-muted-foreground">The AI is reading your data...</p> : null}
            <div ref={endRef} />
          </div>
          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Ask about this screen or any record"
              className="min-h-0 resize-none"
              aria-label="Message"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
              <Send />
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
