"use client";

import { useActionState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signup } from "@/lib/actions/auth";
import { PasswordInput } from "@/components/ui/password-input";
import { GoogleButton } from "@/components/auth/google-button";

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

      <form action={action} className="card-hairline mt-8 w-full max-w-[26rem] space-y-4 p-5 sm:p-7">
        {referralCode && (
          <>
            <input type="hidden" name="referralCode" value={referralCode} />
            <div className="rounded-full border border-accent/30 bg-accent/10 px-4 py-2.5 text-center text-sm font-medium text-foreground">
              You were invited to tbr*a!
            </div>
          </>
        )}
        {state.error && (
          <div className="rounded-2xl border border-intensity-4/30 bg-intensity-4/10 px-4 py-3 text-sm text-intensity-4">
            {state.error}
          </div>
        )}

        <GoogleButton label="Sign up with Google" />
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

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

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
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
            Confirm password
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
          disabled={pending}
          className="btn-lime w-full px-4 py-3 text-sm"
        >
          {state.success ? "Redirecting..." : pending ? "Creating account..." : "Sign up"}
        </button>

        {/* Required by App Review 1.2 for an app with user-generated
            content: people agree to the terms when they create an account. */}
        <p className="text-center text-xs text-muted">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="text-neon-blue hover:text-neon-blue/80">Terms of Use</Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-neon-blue hover:text-neon-blue/80">Privacy Policy</Link>.
        </p>

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-neon-blue hover:text-neon-blue/80">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
