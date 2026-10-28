"use client";

import { useEffect, useRef, useState } from "react";
import { previewDocument } from "@/lib/email-signature";
import { cn } from "@/lib/utils";

/**
 * Shows email HTML exactly as an email app would (its own page, so the app's styles do not change it).
 * The frame runs no scripts (sandbox without allow-scripts) and grows to the height of its content.
 */
export function EmailHtmlPreview({ html, className, testId, title = "Email preview" }: { html: string; className?: string; testId?: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      setHeight(Math.max(48, Math.ceil(doc.documentElement.scrollHeight)));
    };
    const onLoad = () => {
      measure();
      const doc = frame.contentDocument;
      observer?.disconnect();
      if (doc?.body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(doc.body);
      }
      doc?.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    };
    frame.addEventListener("load", onLoad);
    onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin"
      srcDoc={previewDocument(html)}
      style={{ height }}
      className={cn("block w-full rounded-md border border-slate-200 bg-white", className)}
      data-testid={testId}
    />
  );
}
