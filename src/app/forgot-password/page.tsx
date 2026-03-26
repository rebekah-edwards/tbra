"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/actions/auth";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, {});

  return (
    <div className="flex flex-col items-center py-16">
      <h1 className="text-foreground text-3xl font-bold tracking-tight">
        Reset password
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      <form action={action} className="mt-8 w-full max-w-sm space-y-4">
        {state.error && (
          <div className="rounded-lg border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        {state.success ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            If that email exists in our system, we&apos;ve sent a password reset link.
            Check your inbox.
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send reset link"}
            </button>
          </>
        )}

        <p className="text-center text-sm text-muted">
          Remember your password?{" "}
          <Link href="/login" className="text-link hover:text-link/80">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
