"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { MicButton } from "@/components/app/mic-button";
import { openWindowView } from "@/components/app/window-host";
import { startSetupDraft } from "@/app/actions/window";

export const MEAL_PLAN_EXAMPLE =
  "Weekly meal plan: shop once a week, cook on Sunday for the week's lunches and dinners, a separate breakfast plan, and cut food spending.";

/**
 * "Start an initiative", step 1 (Describe): type or speak one or a few sentences. The AI drafts the initiative (goals,
 * milestones, recurring tasks, target, budget change, plan, checklists) and the step-by-step setup opens in the window
 * at Name and purpose. Nothing is saved but the draft until it is approved. "Add manually" opens the same steps with
 * no AI. `onDrafted` (inside the window) moves the window on instead of opening it.
 */
export function StartInitiativeBox({ aiReady, compact = false, onDrafted }: { aiReady: boolean; compact?: boolean; onDrafted?: (draftId: string) => void; back?: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <GuardedForm
      action={async (fd: FormData) => {
        setError(null);
        const r = await startSetupDraft(String(fd.get("description") ?? ""));
        if (!r.ok) {
          setError(r.error);
          return r;
        }
        setText("");
        if (onDrafted) onDrafted(r.id);
        else openWindowView({ kind: "setup", draftId: r.id, step: "name" });
        return r;
      }}
      className="flex flex-col gap-3"
      data-testid="start-initiative-form"
    >
      <label htmlFor="initiative-description" className="text-sm font-medium text-slate-800">
        What do you want to start? One or a few sentences.
      </label>
      <Textarea
        id="initiative-description"
        name="description"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={compact ? 3 : 4}
        maxLength={2000}
        placeholder={`Example: ${MEAL_PLAN_EXAMPLE}`}
        className="resize-y"
      />
      <div className="flex flex-wrap items-start gap-2">
        <SubmitButton disabled={!aiReady || text.trim().length < 8} pendingText="The AI is drafting the plan...">
          <Sparkles /> Draft the plan
        </SubmitButton>
        <MicButton value={text} onText={setText} label="Speak the initiative instead of typing" />
        <button type="button" onClick={() => setText(MEAL_PLAN_EXAMPLE)} className="h-9 rounded-md px-2 text-sm text-primary-strong hover:underline">
          Use the meal plan example
        </button>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-status-missed-bg px-3 py-2 text-sm text-status-missed" data-testid="start-initiative-error">
          {error} You can also add it manually.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {aiReady
          ? "The AI proposes; you check each step in the window and approve the items you want. Spoken words appear in the box for you to check before you press Draft the plan."
          : "The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel (see docs/SETUP-CHECKLIST.md), or add the initiative manually."}
      </p>
      <p className="text-xs text-muted-foreground">
        Prefer to fill it in yourself?{" "}
        <Link href="/records/initiatives/new" data-window="setup/manual" className="font-medium text-primary-strong underline-offset-2 hover:underline" data-testid="add-initiative-manually">
          Add manually
        </Link>
      </p>
    </GuardedForm>
  );
}
