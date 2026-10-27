import * as React from "react";
import { fixDashes, parseMarkdown, type Inline, type MdBlock, type MdList } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Shows AI text (and the plain drafts built from numbers) as aligned bullets, bold lead-ins, and short bold labels.
 * Every piece is a React text node, so nothing is injected as HTML and no raw ** or # characters appear.
 */
export function AiText({ text, className }: { text: string | null | undefined; className?: string }) {
  const blocks = parseMarkdown(fixDashes(text ?? ""));
  if (!blocks.length) return null;
  return <div className={cn("flex max-w-[75ch] flex-col gap-2 text-sm leading-relaxed text-slate-800", className)}>{blocks.map((b, i) => renderBlock(b, i))}</div>;
}

function renderInline(inline: Inline): React.ReactNode {
  return inline.map((p, i) =>
    p.bold ? (
      <strong key={i} className="font-semibold text-slate-900">
        {p.text}
      </strong>
    ) : (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    ),
  );
}

function renderList(list: MdList, depth: number, key: React.Key): React.ReactNode {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag
      key={key}
      className={cn(
        "flex flex-col gap-1 pl-5",
        list.ordered ? "list-decimal" : depth === 0 ? "list-disc" : "list-[circle]",
        depth > 0 && "mt-1",
        "marker:text-slate-400",
      )}
    >
      {list.items.map((it, i) => (
        <li key={i} className="pl-0.5">
          {renderInline(it.inline)}
          {it.children.map((c, j) => renderList(c, depth + 1, j))}
        </li>
      ))}
    </Tag>
  );
}

function renderBlock(b: MdBlock, key: number): React.ReactNode {
  if (b.kind === "label") {
    return (
      <p key={key} className="mt-1 text-sm font-semibold text-slate-900 first:mt-0">
        {b.inline.map((p) => p.text).join("")}
      </p>
    );
  }
  if (b.kind === "paragraph") {
    return (
      <p key={key}>
        {b.lines.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <br /> : null}
            {renderInline(l)}
          </React.Fragment>
        ))}
      </p>
    );
  }
  return renderList(b, 0, key);
}
