import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Grid of form fields. Each field takes three rows of the grid (label, input, help), shared across the row,
 * so labels sit directly above their inputs (6px) and inputs stay aligned when a label in the row wraps.
 * Labels are held to 2 lines, help text to 3 lines. Space between one field and the next label: 16px.
 */
export function FieldGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</div>
  );
}

export function FormField({
  label,
  htmlFor,
  required,
  help,
  wide,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  help?: React.ReactNode;
  /** Spans the full row (long text, checklists). */
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("row-span-3 grid min-w-0 grid-rows-subgrid", wide && "sm:col-span-full", className)}>
      <label htmlFor={htmlFor} className="self-end pb-1.5 text-sm font-medium leading-5 text-slate-800">
        <span className="clamp-2">
          {label}
          {required ? <span className="text-red-600"> *</span> : null}
        </span>
      </label>
      <div className="min-w-0">{children}</div>
      <div className="pb-4">{help ? <p className="clamp-3 mt-1 text-xs text-muted-foreground">{help}</p> : null}</div>
    </div>
  );
}
