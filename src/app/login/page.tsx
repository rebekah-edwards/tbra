"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { login } from "@/lib/actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, {});
  const searchParams = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";

  return (
    <div className="flex flex-col items-center py-16">
      <h1
        className="text-foreground text-3xl font-bold tracking-tight"

      >
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-muted">
        Sign in to your account.
      </p>

      <form action={action} className="mt-8 w-full max-w-sm space-y-4">
        {resetSuccess && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            Password reset successfully. Sign in with your new password.
          </div>
        )}

        {state.error && (
          <div className="rounded-lg border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

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

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
            placeholder="Your password"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>

        <div className="text-center space-y-2">
          <p className="text-xs text-muted">
            <Link href="/forgot-password" className="text-link hover:text-link/80">
              Forgot password?
            </Link>
          </p>
          <p className="text-sm text-muted">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-link hover:text-link/80">
              Sign up
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
