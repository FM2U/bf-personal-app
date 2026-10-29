"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWindowParam } from "@/lib/window-url";
import { MessageSquare, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AiText } from "@/components/app/ai-text";
import { MicButton } from "@/components/app/mic-button";
import { OPEN_CHAT_EVENT, chatState, openChat, type ChatContext, type OpenChatDetail } from "@/components/app/chat-bus";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant" | "error"; content: string; proposals?: string[]; link?: { href: string; label: string } };

/**
 * "Ask the AI" in the desktop sidebar. On desktop the button sits in the sidebar instead of floating,
 * so it never covers page content. On phones the floating button is used (the page has bottom padding for it).
 */
export function AskAiSidebarButton() {
  return (
    <Button type="button" onClick={() => openChat({ context: null })} className="mb-2 w-full justify-start" aria-label="Open AI chat">
      <MessageSquare /> Ask the AI
    </Button>
  );
}

const sameContext = (a: ChatContext | null, b: ChatContext | null) => (a?.table ?? "") === (b?.table ?? "") && (a?.id ?? "") === (b?.id ?? "") && (a?.label ?? "") === (b?.label ?? "");

const CONTEXT_EXAMPLES = ["What should I do next on this?", "Summarize where this stands.", "What is missing or at risk here?"];

/**
 * AI chat panel, available on every screen. The AI reads app data and can only propose changes.
 * "Ask AI about this" opens it about a page or a record (shown as "About: ..."); the record's fields, linked records,
 * open tasks, and recent activity are sent with each question. Opened from a window, it opens inside that window.
 */
export function ChatPanel({ aiReady }: { aiReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [target, setTarget] = useState<Element | null>(null);
  const path = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A window opening or moving on (for example from the chat's "Open the setup" link) closes the chat, so it never
  // covers the window and never answers about a record that is no longer on screen.
  const win = useWindowParam();
  const [lastWin, setLastWin] = useState(win);
  if (lastWin !== win) {
    setLastWin(win);
    if (open && (win || target)) {
      setOpen(false);
      setTarget(null);
    }
  }

  // Inside a window, a question makes the window taller (about 85% of the screen height, see WindowShell) so the
  // answer has room; the conversation scrolls inside the chat.
  const asked = messages.length > 0 || busy;
  useEffect(() => {
    if (!open || !target) return;
    if (asked) target.setAttribute("data-chat-tall", "");
    else target.removeAttribute("data-chat-tall");
    return () => target.removeAttribute("data-chat-tall");
  }, [open, target, asked]);

  // The latest message stays in view: a new answer shows from its first line, anything else scrolls to the end.
  // Run again after the window has grown (the height change takes 300 ms).
  useEffect(() => {
    const show = () => {
      const box = scrollRef.current;
      if (!box) return;
      const all = box.querySelectorAll<HTMLElement>("[data-chat-msg]");
      const last = all[all.length - 1];
      // The box is positioned, so offsetTop is measured from its top.
      if (last && last.dataset.chatMsg === "assistant" && !busy) box.scrollTo({ top: Math.max(0, last.offsetTop - 8), behavior: "smooth" });
      else box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    };
    show();
    const t = setTimeout(show, 360);
    return () => clearTimeout(t);
  }, [messages, open, busy]);

  useEffect(() => {
    chatState.openInWindow = open && !!target;
    chatState.close = () => {
      setOpen(false);
      setTarget(null);
    };
  }, [open, target]);

  const send = useCallback(
    async (raw: string, about: ChatContext | null, conv: string | null) => {
      const text = raw.trim();
      if (!text) return;
      setInput("");
      setMessages((m) => [...m, { role: "user", content: text }]);
      setBusy(true);
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, conversationId: conv, pagePath: path, context: about }),
        });
        const data = await res.json();
        if (data.conversationId) setConversationId(data.conversationId);
        if (!res.ok) setMessages((m) => [...m, { role: "error", content: data.error ?? "The request failed." }]);
        else setMessages((m) => [...m, { role: "assistant", content: data.reply, proposals: data.proposals, link: data.link }]);
      } catch {
        setMessages((m) => [...m, { role: "error", content: "The request failed. Check the connection and try again." }]);
      } finally {
        setBusy(false);
      }
    },
    [path],
  );

  // "Ask the AI" (sidebar), "Ask AI about this" (headers), and suggestion lines open this panel.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = ((e as CustomEvent<OpenChatDetail>).detail ?? {}) as OpenChatDetail;
      const next = d.context === undefined ? context : d.context;
      const fresh = !sameContext(next, context);
      if (fresh) {
        setMessages([]);
        setConversationId(null);
      }
      setContext(next ?? null);
      setTarget(d.inWindow ? document.querySelector("[data-app-window]") : null);
      setOpen(true);
      if (d.prompt && aiReady) void send(d.prompt, next ?? null, fresh ? null : conversationId);
      else requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, [context, conversationId, send, aiReady]);

  const close = () => {
    setOpen(false);
    setTarget(null);
  };

  const panel = (
    <div
      className={cn(
        "flex flex-col border-border bg-white shadow-2xl",
        target
          ? "absolute inset-0 z-30 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[400px] sm:border-l"
          : "fixed inset-x-0 bottom-0 z-50 h-[80vh] border-t sm:inset-x-auto sm:right-4 sm:bottom-4 sm:h-[600px] sm:w-[400px] sm:rounded-xl sm:border",
      )}
      data-testid="ai-chat"
      role="complementary"
      aria-label="AI chat"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">AI teammate</p>
          <p className="text-xs text-muted-foreground">Reads your data. Proposes changes; you approve them.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMessages([]);
              setConversationId(null);
            }}
          >
            New chat
          </Button>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close AI chat" data-testid="ai-chat-close">
            <X />
          </Button>
        </div>
      </div>
      {context ? (
        <div className="flex items-center gap-2 border-b border-border bg-primary-soft/60 px-4 py-2 text-xs" data-testid="ai-chat-context">
          <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 text-gold" />
          <span className="clamp-1 min-w-0 flex-1 text-slate-800">
            About: <span className="font-medium">{context.label}</span>
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 font-medium text-primary-strong hover:bg-white"
            onClick={() => {
              setContext(null);
              setMessages([]);
              setConversationId(null);
            }}
          >
            Ask about anything
          </button>
        </div>
      ) : null}
      <div ref={scrollRef} className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="ai-chat-scroll">
        {!aiReady ? <p className="rounded-md bg-status-soon-bg p-3 text-sm text-status-soon">The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel (see docs/SETUP-CHECKLIST.md).</p> : null}
        {!messages.length ? (
          context ? (
            <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
              <p>Ask about {context.label}. Examples:</p>
              {CONTEXT_EXAMPLES.map((q) => (
                <button key={q} type="button" disabled={!aiReady || busy} onClick={() => void send(q, context, conversationId)} className="rounded-full border border-primary-border bg-white px-3 py-1 text-left text-xs font-medium text-primary-strong hover:bg-primary-soft disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Examples:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>What changed in my runway this month, and why?</li>
                <li>Which debt should I pay first? Show the tradeoffs.</li>
                <li>Draft a follow-up email to the broker on this deal.</li>
                <li>Does this deal fit my acquisition criteria?</li>
                <li>Start an initiative: weekly meal plan, shop once a week, cook on Sunday.</li>
              </ul>
            </div>
          )
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-white"
                : m.role === "error"
                  ? "mr-8 rounded-lg bg-status-missed-bg px-3 py-2 text-sm text-status-missed"
                  : "mr-8 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900"
            }
            data-testid={`ai-chat-${m.role}`}
            data-chat-msg={m.role}
          >
            {m.role === "assistant" ? <AiText text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
            {m.link ? (
              <Link href={m.link.href} className="mt-2 inline-block text-xs font-medium text-primary-strong underline" data-testid="chat-draft-link">
                {m.link.label}
              </Link>
            ) : null}
            {m.proposals?.length ? (
              <Link href="/proposals" className="mt-2 inline-block text-xs font-medium text-primary-strong underline">
                {m.proposals.length} proposal(s) waiting for your approval
              </Link>
            ) : null}
          </div>
        ))}
        {busy ? <p className="text-xs text-muted-foreground">The AI is reading your data...</p> : null}
      </div>
      <form
        data-unsaved="off"
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void send(input, context, conversationId);
        }}
      >
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void send(input, context, conversationId);
            }
          }}
          rows={2}
          placeholder={context ? `Ask about ${context.label}` : "Ask about this screen or any record"}
          className="min-h-0 resize-none"
          aria-label="Message"
        />
        <div className="flex flex-col gap-1">
          <MicButton value={input} onText={setInput} label="Speak your message (it appears in the box; press Send yourself)" iconOnly />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
            <Send />
          </Button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="no-print">
      {!open ? (
        <Button onClick={() => openChat({ context: null })} className="fixed bottom-4 right-4 z-40 h-12 rounded-full px-5 shadow-lg lg:hidden" aria-label="Open AI chat">
          <MessageSquare /> Ask the AI
        </Button>
      ) : null}
      {open ? (target && target.isConnected ? createPortal(panel, target) : panel) : null}
    </div>
  );
}
