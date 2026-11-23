"use client";

/**
 * The report's opening box with Bold and Bulleted list (Bram, 2026-11-23; claude/2026-11-23-report-fixes-build-plan.md):
 * the Email window's editor with only those two tools. The value going in and out is the saved opening (text with "**"
 * for bold and "- " for bullets, src/lib/accountability/opening-format.ts); the editor's own HTML stays inside this box,
 * so typing never moves the cursor. A new value from outside (Redraft, another save) replaces what the box shows.
 */

import { useState } from "react";
import { EmailEditor } from "@/components/app/email-editor";
import { editorHtmlToOpening, openingToEditorHtml } from "@/lib/accountability/opening-format";

export function OpeningEditor({ value, onChange, onLeave, label, placeholder, testId = "opening-input" }: { value: string; onChange: (text: string) => void; /** The cursor left the box (the place to save). */ onLeave?: (text: string) => void; label: string; placeholder?: string; testId?: string }) {
  const [html, setHtml] = useState(() => openingToEditorHtml(value));
  // The text the box last gave out: a value that differs from it came from outside.
  const [given, setGiven] = useState(value);
  if (value !== given) {
    setGiven(value);
    setHtml(openingToEditorHtml(value));
  }
  return (
    <div
      onBlur={(e) => {
        // Focus moving to the Bold or Bulleted list button stays inside the box.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onLeave?.(given);
      }}
      data-testid="opening-editor"
    >
      <EmailEditor
        label={label}
        labelClassName="sr-only"
        tools="basic"
        testId={testId}
        placeholder={placeholder}
        value={html}
        onChange={(next) => {
          const text = editorHtmlToOpening(next);
          setHtml(next);
          setGiven(text);
          onChange(text);
        }}
      />
    </div>
  );
}

/** The saved opening shown with its bold and bullets, not editable (a closed day). */
export function OpeningShown({ value, testId = "opening-input" }: { value: string; testId?: string }) {
  return <div className="email-editor-content rounded-[7px] border border-input bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-600" data-testid={testId} dangerouslySetInnerHTML={{ __html: openingToEditorHtml(value) || '<p class="text-slate-400">(no opening)</p>' }} />;
}
