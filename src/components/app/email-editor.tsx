"use client";

/**
 * The formatted email message box (Email button compose box, Outreach Queue Draft message). The label is shown at
 * once; the editor code (TipTap) is loaded only when a box opens, so pages stay fast. Until it arrives, an empty box
 * of the same size reads "Loading the editor...".
 */

import { useId, useRef } from "react";
import dynamic from "next/dynamic";

export type EmailEditorApi = { focus: () => void };

export type EmailEditorProps = {
  /** The editor HTML ("" when empty). Text from the AI goes through textToEditorHtml first. */
  value: string;
  onChange: (html: string) => void;
  label: string;
  labelClassName?: string;
  /** data-testid of the editable area. */
  testId?: string;
  /** Set by the editor: focus() puts the cursor at the end of the message (used by Edit in "Send this email?"). */
  apiRef?: React.RefObject<EmailEditorApi | null>;
  placeholder?: string;
};

export type EmailEditorBoxProps = Omit<EmailEditorProps, "label" | "labelClassName" | "apiRef"> & {
  labelId: string;
  apiRef: React.RefObject<EmailEditorApi | null>;
};

const EditorBox = dynamic(() => import("@/components/app/email-editor-impl"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col overflow-hidden rounded-md border border-input bg-background shadow-xs" data-testid="email-editor-loading">
      <div className="h-[41px] border-b border-slate-200 bg-slate-50" />
      <p className="email-editor-height px-3 py-2 text-sm text-muted-foreground">Loading the editor...</p>
    </div>
  ),
});

export function EmailEditor({ label, labelClassName, apiRef, ...rest }: EmailEditorProps) {
  const labelId = `${useId()}-label`;
  const ownApi = useRef<EmailEditorApi | null>(null);
  const api = apiRef ?? ownApi;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="email-editor">
      <label id={labelId} className={labelClassName} onClick={() => api.current?.focus()}>
        {label}
      </label>
      <EditorBox {...rest} labelId={labelId} apiRef={api} />
    </div>
  );
}
