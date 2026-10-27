"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** The browser's built-in speech recognition (Chrome, Edge, and Safari as webkitSpeechRecognition). No paid service. */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

/** Joins the text already in the box and the spoken words with one space. */
export function joinSpoken(before: string, spoken: string): string {
  const a = before.replace(/\s+$/, "");
  const b = spoken.trim();
  if (!b) return before;
  return a ? `${a} ${b}` : b;
}

/**
 * Microphone button: press, speak, and the words appear in the box (`onText`) for review. It never sends or submits.
 * Hidden when the browser has no speech recognition.
 */
export function MicButton({ value, onText, className, label = "Speak instead of typing", iconOnly = false }: { value: string; onText: (text: string) => void; className?: string; label?: string; iconOnly?: boolean }) {
  // False on the server and in the first render, so both agree; then whether the browser has speech recognition.
  const supported = useSyncExternalStore(noSubscribe, () => !!recognitionCtor(), () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const base = useRef("");
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => rec.current?.abort(), []);

  if (!supported) return null;

  const stop = () => {
    rec.current?.stop();
  };

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    base.current = valueRef.current;
    r.onresult = (e) => {
      let spoken = "";
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
      onText(joinSpoken(base.current, spoken));
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "The browser did not allow the microphone. Allow it in the address bar, or type instead." : e.error === "no-speech" ? "No speech was heard. Press the microphone and speak again." : "Speech could not be turned into text. Type instead.");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("Speech could not start. Type instead.");
    }
  };

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        aria-label={listening ? "Stop listening" : label}
        title={listening ? "Stop listening" : label}
        data-testid="mic-button"
        className={cn(
          "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          listening ? "border-teal-600 bg-teal-50 text-teal-800" : "border-input bg-background text-slate-700 hover:bg-accent",
          iconOnly && !listening && "w-9 px-0",
        )}
      >
        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {listening ? (
          <span className="inline-flex items-center gap-1.5" data-testid="mic-listening">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-teal-600" />
            Listening
          </span>
        ) : iconOnly ? null : (
          <span className="sr-only sm:not-sr-only">Speak</span>
        )}
      </button>
      {error ? <span className="max-w-xs text-xs text-status-soon">{error}</span> : null}
    </span>
  );
}
