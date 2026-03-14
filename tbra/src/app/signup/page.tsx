"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "@/lib/actions/auth";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, {});

  return (
    <div className="flex flex-col items-center py-16">
      <h1
        className="neon-heading text-3xl font-bold tracking-tight"
        style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}
      >
        Create an account
      </h1>
      <p className="mt-2 text-sm text-muted">
        Track your reading and build your shelves.
      </p>

      <form action={action} className="mt-8 w-full max-w-sm space-y-4">
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
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Confirm your password"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "Creating account..." : "Sign up"}
        </button>

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:text-primary-dark">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
