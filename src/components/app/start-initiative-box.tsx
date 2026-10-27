"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { MicButton } from "@/components/app/mic-button";
import { startInitiative } from "@/app/actions/initiatives";

export const MEAL_PLAN_EXAMPLE =
  "Weekly meal plan: shop once a week, cook on Sunday for the week's lunches and dinners, a separate breakfast plan, and cut food spending.";

/**
 * "Start an initiative": type or speak one or a few sentences. The AI drafts the initiative (goals, milestones,
 * recurring tasks, target, budget change, plan, checklists); the review screen opens; nothing is saved before approval.
 */
export function StartInitiativeBox({ back = "/plan/start", aiReady, compact = false }: { back?: string; aiReady: boolean; compact?: boolean }) {
  const [text, setText] = useState("");
  return (
    <GuardedForm action={startInitiative} className="flex flex-col gap-3" data-testid="start-initiative-form">
      <input type="hidden" name="back" value={back} />
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
      <p className="text-xs text-muted-foreground">
        {aiReady
          ? "The AI proposes; you review every item on the next screen and approve the ones you want. Spoken words appear in the box for you to check before you press Draft the plan."
          : "The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel (see docs/SETUP-CHECKLIST.md)."}
      </p>
      <p className="text-xs text-muted-foreground">
        Prefer to fill in a form?{" "}
        <Link href="/records/initiatives/new" className="font-medium text-primary-strong underline-offset-2 hover:underline" data-testid="add-initiative-manually">
          Add manually
        </Link>
      </p>
    </GuardedForm>
  );
}
