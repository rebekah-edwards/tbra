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

      <form action={action} className="card-hairline mt-8 w-full max-w-[26rem] space-y-4 p-5 sm:p-7">
        {state.error && (
          <div className="rounded-2xl border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        {state.success ? (
          <div className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-foreground">
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
                className="field-glass w-full"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="btn-lime w-full px-4 py-3 text-sm"
            >
              {pending ? "Sending..." : "Send reset link"}
            </button>
          </>
        )}

        <p className="text-center text-sm text-muted">
          Remember your password?{" "}
          <Link href="/login" className="text-neon-blue hover:text-neon-blue/80">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
