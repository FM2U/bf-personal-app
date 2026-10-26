"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthState } from "@/app/actions/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/app/submit-button";
import { Notice } from "@/components/app/page-header";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(signIn, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Email and password, then a code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          {notice ? <Notice tone="warn">{notice}</Notice> : null}
          {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <SubmitButton pendingText="Signing in...">Sign in</SubmitButton>
          <p className="text-center text-xs text-muted-foreground">
            First time? <Link href="/signup" className="underline">Create the owner account</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function SignupForm() {
  const [state, action] = useActionState<AuthState, FormData>(signUp, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create the owner account</CardTitle>
        <CardDescription>Only the owner email set on the server can create an account. One account is allowed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
          {state?.message ? <Notice tone="success">{state.message}</Notice> : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="password">Password (at least 12 characters)</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
          </div>
          <SubmitButton pendingText="Creating...">Create account</SubmitButton>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/login" className="underline">Back to sign in</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
