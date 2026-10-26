"use client";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useGuardedPending } from "@/components/app/unsaved-changes";

export function SubmitButton({ children, pendingText = "Saving...", ...props }: ButtonProps & { pendingText?: string }) {
  const status = useFormStatus();
  const guarded = useGuardedPending();
  const pending = status.pending || guarded;
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function ConfirmSubmit({ children, message, ...props }: ButtonProps & { message: string }) {
  const status = useFormStatus();
  const guarded = useGuardedPending();
  const pending = status.pending || guarded;
  return (
    <Button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
