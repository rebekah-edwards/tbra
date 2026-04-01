"use client";

import { useActionState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signup } from "@/lib/actions/auth";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, {});
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") || "";

  // Client-side redirect after successful signup — gives Safari's
  // password manager a chance to prompt "Save Password?" on navigation
  useEffect(() => {
    if (state.success && state.redirectTo) {
      window.location.href = state.redirectTo;
    }
  }, [state.success, state.redirectTo]);

  return (
    <div className="flex flex-col items-center py-16">
      <h1
        className="text-foreground text-3xl font-bold tracking-tight"
       
      >
        Create an account
      </h1>
      <p className="mt-2 text-sm text-muted">
        Track your reading and build your shelves.
      </p>

      <form action={action} className="mt-8 w-full max-w-sm space-y-4">
        {referralCode && (
          <>
            <input type="hidden" name="referralCode" value={referralCode} />
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-center text-sm text-primary font-medium">
              You were invited to tbr*a!
            </div>
          </>
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
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium mb-1"
          >
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-neon-blue focus:outline-none focus:ring-1 focus:ring-neon-blue"
            placeholder="Confirm your password"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {state.success ? "Redirecting..." : pending ? "Creating account..." : "Sign up"}
        </button>

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-link hover:text-link/80">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
