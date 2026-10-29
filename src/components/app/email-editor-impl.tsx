"use client";

/**
 * The formatted email message editor (loaded only when an email box opens: see email-editor.tsx).
 * TipTap (ProseMirror) with only what an email needs: paragraphs (one per line, Enter starts a new line), bold,
 * italic, bulleted and numbered lists, links, line breaks (Shift+Enter), undo and redo.
 * - Toolbar: Bold, Italic, Bulleted list, Numbered list, Link. Shortcuts: Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+K (link).
 * - Typing "- " or "* " at the start of a line starts a bulleted list; "1. " starts a numbered list.
 * - Paste: HTML (Gmail, Google Docs) is cleaned with the email sanitizer, then only the formatting above is kept;
 *   plain text with "- " or "1. " lines becomes lists.
 * The value is the editor HTML ("" when empty). The email is made from it by src/lib/email-body.ts.
 */

import { useEffect, useId, useRef, useState } from "react";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Bold as BoldIcon, Italic as ItalicIcon, Link2, List, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeHref } from "@/lib/email-signature";
import { sanitizeEmailBodyHtml, textToEditorHtml } from "@/lib/email-body";
import { cn } from "@/lib/utils";
import type { EmailEditorBoxProps } from "@/components/app/email-editor";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "Cmd" : "Ctrl";

/** The editor HTML for the value: "" when there is no text. */
function valueOf(editor: Editor): string {
  return editor.isEmpty ? "" : editor.getHTML();
}

/** A typed address as a link address: an email address gets mailto:, anything without a scheme gets https://. */
export function linkAddress(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return `mailto:${v}`;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  return safeHref(withScheme) && !/\s/.test(withScheme) ? withScheme : null;
}

export default function EmailEditorImpl({ value, onChange, labelId, testId = "email-body", apiRef, placeholder }: EmailEditorBoxProps) {
  const ids = useId();
  const lastValue = useRef(value);
  const openLinkRef = useRef<() => void>(() => {});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      HardBreak,
      BulletList,
      OrderedList,
      ListItem,
      ListKeymap,
      UndoRedo,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        protocols: ["mailto", "tel"],
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && !!safeHref(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`),
        HTMLAttributes: { target: null, rel: null, class: null },
      }),
      Extension.create({
        name: "emailShortcuts",
        addKeyboardShortcuts() {
          return {
            "Mod-k": () => {
              openLinkRef.current();
              return true;
            },
          };
        },
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        "data-testid": testId,
        class: "email-editor-content email-editor-height px-3 py-2 text-sm leading-6 text-slate-900 focus:outline-none",
      },
      // Pasted HTML: the email sanitizer first (same rules as the signature), then the editor keeps only its formatting.
      transformPastedHTML: (html) => sanitizeEmailBodyHtml(html),
      handlePaste: (view, event) => {
        const dt = event.clipboardData;
        if (!dt || dt.types.includes("text/html")) return false;
        const text = dt.getData("text/plain");
        // Plain text with several lines or a list line: read it the same way as an AI draft.
        if (!text || (!text.includes("\n") && !/^\s*([-*•]|\d{1,3}[.)])\s/.test(text))) return false;
        const ed = editorRef.current;
        if (!ed) return false;
        ed.chain().focus().insertContent(textToEditorHtml(text)).run();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = valueOf(ed);
      lastValue.current = html;
      onChangeRef.current(html);
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // A new value from outside (Write with AI, Draft message): replaces the content without counting as typing.
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { focus: () => editor?.commands.focus("end") };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      bullets: ed.isActive("bulletList"),
      numbers: ed.isActive("orderedList"),
      link: ed.isActive("link"),
    }),
  });

  function openLink() {
    if (!editor) return;
    const current = String(editor.getAttributes("link").href ?? "");
    setLinkValue(current.replace(/^mailto:/i, ""));
    setLinkError(null);
    setLinkOpen(true);
  }
  useEffect(() => {
    openLinkRef.current = openLink;
  });

  function closeLink() {
    setLinkOpen(false);
    setLinkError(null);
    editor?.commands.focus();
  }

  function saveLink() {
    if (!editor) return;
    const href = linkAddress(linkValue);
    if (!href) {
      setLinkError("Type a web address (example.com or https://...) or an email address.");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      const shown = linkValue.trim();
      chain.insertContent({ type: "text", text: shown, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
    closeLink();
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLink();
  }

  const tool = (active: boolean | undefined, name: string, shortcut: string | null, onClick: () => void, icon: React.ReactNode, id: string) => (
    <button
      type="button"
      aria-label={name}
      aria-pressed={!!active}
      title={shortcut ? `${name} (${shortcut})` : name}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      data-testid={id}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-primary-soft hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
        active && "bg-primary-soft text-primary-strong ring-1 ring-primary-border",
      )}
    >
      {icon}
    </button>
  );

  return (
      <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-input bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1.5 py-1">
          {tool(state?.bold, "Bold", `${MOD}+B`, () => editor?.chain().focus().toggleBold().run(), <BoldIcon />, "editor-bold")}
          {tool(state?.italic, "Italic", `${MOD}+I`, () => editor?.chain().focus().toggleItalic().run(), <ItalicIcon />, "editor-italic")}
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          {tool(state?.bullets, "Bulleted list", null, () => editor?.chain().focus().toggleBulletList().run(), <List />, "editor-bullets")}
          {tool(state?.numbers, "Numbered list", null, () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered />, "editor-numbers")}
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          {tool(state?.link || linkOpen, state?.link ? "Edit link" : "Add link", `${MOD}+K`, openLink, <Link2 />, "editor-link")}
        </div>
        {linkOpen ? (
          <div className="flex flex-col gap-2 border-b border-slate-200 bg-primary-soft/40 px-3 py-2" data-testid="editor-link-form">
            <label htmlFor={`${ids}-link`} className="text-xs font-medium text-slate-700">
              Link address
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id={`${ids}-link`}
                autoFocus
                value={linkValue}
                onChange={(e) => {
                  setLinkValue(e.target.value);
                  setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveLink();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    closeLink();
                  }
                }}
                placeholder="example.com or name@example.com"
                autoComplete="off"
                className="h-8 min-w-0 flex-1"
                data-testid="editor-link-input"
              />
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" onClick={saveLink} data-testid="editor-link-save">
                  Save link
                </Button>
                {state?.link ? (
                  <Button type="button" size="sm" variant="outline" onClick={removeLink} data-testid="editor-link-remove">
                    Remove link
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="ghost" onClick={closeLink}>
                  Cancel
                </Button>
              </div>
            </div>
            {linkError ? <p className="text-xs font-medium text-status-missed">{linkError}</p> : null}
          </div>
        ) : null}
        <div className="max-h-[24rem] overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
  );
}
