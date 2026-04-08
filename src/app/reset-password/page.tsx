"use client";

import { useActionState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "@/lib/actions/auth";
import { PasswordInput } from "@/components/ui/password-input";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, action, pending] = useActionState(resetPassword, {});

  useEffect(() => {
    if (state.success && state.redirectTo) {
      window.location.href = state.redirectTo;
    }
  }, [state.success, state.redirectTo]);

  if (!token) {
    return (
      <div className="flex flex-col items-center py-16">
        <h1 className="text-foreground text-3xl font-bold tracking-tight">
          Invalid link
        </h1>
        <p className="mt-2 text-sm text-muted">
          This password reset link is invalid or missing.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 text-sm text-link hover:text-link/80"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-16">
      <h1 className="text-foreground text-3xl font-bold tracking-tight">
        Set new password
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your new password below.
      </p>

      <form action={action} className="mt-8 w-full max-w-sm space-y-4">
        <input type="hidden" name="token" value={token} />

        {state.error && (
          <div className="rounded-lg border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            New password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium mb-1"
          >
            Confirm new password
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Confirm your password"
          />
        </div>

        <button
          type="submit"
          disabled={pending || state.success}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {state.success
            ? "Redirecting..."
            : pending
              ? "Resetting..."
              : "Reset password"}
        </button>

        <p className="text-center text-sm text-muted">
          <Link href="/login" className="text-link hover:text-link/80">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
